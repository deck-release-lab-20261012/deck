#!/usr/bin/env python3
"""Isolated probe: does Claude Code's a2a Stop-hook receive path still work?

Runs the real `claude` CLI (print mode) against a loopback Anthropic Messages
server and a synthetic a2a mailbox. The Stop hook blocks the first stop with a
wake reason; the probe proves the reason reached the model automatically when a
later model request body contains the wake text `[a2a#synthetic]`.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_a2a_receive import INVITE_BODY, Probe, free_port  # noqa: E402


def make_model_server(probe: Probe) -> ThreadingHTTPServer:
    modellog = probe.root / "modellog"
    modellog.mkdir(exist_ok=True)
    counter = [0]
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):

        def log_message(self, *a):  # silence
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            with lock:
                counter[0] += 1
                n = counter[0]
                (modellog / f"{n}.json").write_bytes(body)
            wants_stream = False
            try:
                wants_stream = json.loads(body or b"{}").get("stream", False)
            except json.JSONDecodeError:
                pass
            if "/v1/messages" in self.path:
                events = [
                    ("message_start", {"type": "message", "role": "assistant",
                                       "model": "probe-loopback", "content": [],
                                       "stop_reason": None, "stop_sequence": None,
                                       "usage": {"input_tokens": 1, "output_tokens": 0}}),
                    ("content_block_start", {"type": "thinking", "thinking": "", "signature": "probe-sig"}),
                    ("content_block_delta", {"type": "thinking_delta", "thinking": "."}),
                    ("content_block_delta", {"type": "signature_delta", "signature": "probe-sig"}),
                    ("content_block_stop", {}),
                    ("content_block_start", {"type": "text", "text": ""}),
                    ("content_block_delta", {"type": "text_delta", "text": "ok"}),
                    ("content_block_stop", {}),
                    ("message_delta", {"stop_reason": "end_turn", "stop_sequence": None,
                                       "usage": {"output_tokens": 1}}),
                    ("message_stop", {}),
                ]
                if not wants_stream:
                    reply = {
                        "id": "msg_probe", "type": "message", "role": "assistant",
                        "model": "probe-loopback",
                        "content": [
                            {"type": "thinking", "thinking": ".", "signature": "probe-sig"},
                            {"type": "text", "text": "ok"},
                        ],
                        "stop_reason": "end_turn", "stop_sequence": None,
                        "usage": {"input_tokens": 1, "output_tokens": 1,
                                  "cache_creation_input_tokens": 0,
                                  "cache_read_input_tokens": 0},
                    }
                    payload = json.dumps(reply).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                chunks = [
                    f"event: {name}\ndata: {json.dumps({'type': name, **data})}\n\n".encode()
                    for name, data in events
                ]
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                for chunk in chunks:
                    self.wfile.write(chunk)
            else:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()

        def do_GET(self):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    class QuietServer(ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            pass  # connection resets from the CLI are expected

    server = QuietServer(("127.0.0.1", free_port()), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def write_claude_home(probe: Probe, extra_hooks: list[tuple[str, str, int]] | None = None) -> None:
    claude_dir = probe.root / "home" / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)

    wrapper = probe.root / "a2a-hook.sh"
    wrapper.write_text(
        "#!/bin/sh\n"
        f'exec /usr/bin/python3 "{probe.root}/mail.py" hook "$1" --harness claude\n'
    )
    wrapper.chmod(0o755)

    def add_hook(document: dict, event: str, command: str, timeout: int) -> None:
        hooks = document.setdefault("hooks", {}).setdefault(event, [])
        hooks.append(
            {
                "matcher": "*",
                "hooks": [{"type": "command", "command": command, "timeout": timeout}],
            }
        )

    settings = {
        "env": {},
        "includeCoAuthoredBy": False,
        "autoUpdates": False,
    }
    hook = str(wrapper)
    add_hook(settings, "SessionStart", f"{hook} session-start claude", 15)
    add_hook(settings, "UserPromptSubmit", f"{hook} prompt claude", 10)
    add_hook(settings, "Stop", f"{hook} stop claude", 15)
    for event, command, timeout in extra_hooks or []:
        add_hook(settings, event, command, timeout)
    add_hook(settings, "SessionEnd", f"{hook} session-end claude", 10)
    (claude_dir / "settings.json").write_text(json.dumps(settings, indent=2))

    # Trust the working directory headlessly; skip onboarding nags.
    (probe.root / "home" / ".claude.json").write_text(
        json.dumps(
            {
                "hasCompletedOnboarding": True,
                "bypassPermissionsModeAccepted": True,
                "projects": {str(probe.root / "cwd"): {"allowedTools": [], "hasTrustDialogAccepted": True}},
            }
        )
    )


def run(probe: Probe, argv: list[str], env: dict[str, str], timeout: float) -> int:
    import subprocess

    proc = probe.spawn(argv, env, cwd=probe.root / "cwd")
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        probe.stop()
        return -1
    finally:
        probe.stop()


def probe_claude() -> None:
    probe = Probe("claude")
    try:
        server = make_model_server(probe)
        write_claude_home(probe)

        env = probe.env(
            {
                "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}",
                "ANTHROPIC_API_KEY": "dummy",
                "ANTHROPIC_AUTH_TOKEN": "dummy",
                "ANTHROPIC_MODEL": "claude-sonnet-4-5",
                "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT": "1",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "DISABLE_TELEMETRY": "1",
                "DISABLE_AUTOUPDATER": "1",
                "DISABLE_BUG_COMMAND": "1",
                "DISABLE_COST_WARNINGS": "1",
                "DISABLE_ERROR_REPORTING": "1",
                "CLAUDE_CONFIG_DIR": str(probe.root / "home" / ".claude"),
            }
        )
        argv = [
            "claude", "-p", "reply with the single word ok",
            "--output-format", "text",
            "--dangerously-skip-permissions",
        ]
        rc = run(probe, argv, env, timeout=180)

        calls = probe.calls()
        hook_events = [c[1] for c in calls if c[:1] == ["hook"]]
        modellog = probe.root / "modellog"
        nreq = len(list(modellog.glob("*.json"))) if modellog.exists() else 0
        wake_seen = False
        if modellog.exists():
            for f in sorted(modellog.glob("*.json")):
                try:
                    body = json.loads(f.read_text())
                except (json.JSONDecodeError, OSError):
                    continue
                text = json.dumps(body.get("messages", []))
                if "[a2a#synthetic]" in text:
                    wake_seen = True
                    break

        problems = []
        if "stop" not in hook_events:
            problems.append(f"criterion (a) failed: no `hook stop` call recorded; hook events={hook_events}")
        if nreq < 2:
            problems.append(f"criterion (b) failed: model server saw only {nreq} request(s)")
        elif not wake_seen:
            problems.append(
                f"criterion (b) failed: wake text [a2a#synthetic] never reached the model "
                f"({nreq} requests)"
            )
        if rc == -1 or probe.process.poll() is None:
            problems.append("criterion (c) failed: claude process never exited (timeout)")
        if problems:
            stderr = (probe.root / "stderr").read_text(errors="replace") if (probe.root / "stderr").exists() else ""
            probe.fail("; ".join(problems) + f"\n  claude rc={rc}\n  stderr tail: {stderr[-2000:]}")
        print(
            f"PASS [claude]: stop hook fired, wake reason reached the model "
            f"({nreq} model requests), claude exited rc={rc}"
        )
    finally:
        try:
            server.shutdown()
        except Exception:
            pass
        probe.cleanup()

# ── Follow-up: does UserPromptSubmit STDOUT reach the model context? ────────

UPS_MARKER = "[a2a#probe] user-prompt-submit stdout marker"


def probe_ups_stdout() -> None:
    """Register a UserPromptSubmit hook echoing a marker; find it in request 1."""
    probe = Probe("claude-ups")
    try:
        server = make_model_server(probe)
        write_claude_home(
            probe,
            extra_hooks=[
                ("UserPromptSubmit", f"printf '%s\\n' '{UPS_MARKER}'", 10),
            ],
        )
        env = probe.env(
            {
                "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}",
                "ANTHROPIC_API_KEY": "dummy",
                "ANTHROPIC_AUTH_TOKEN": "dummy",
                "ANTHROPIC_MODEL": "claude-sonnet-4-5",
                "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT": "1",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                "DISABLE_TELEMETRY": "1",
                "DISABLE_AUTOUPDATER": "1",
                "DISABLE_ERROR_REPORTING": "1",
                "CLAUDE_CONFIG_DIR": str(probe.root / "home" / ".claude"),
            }
        )
        rc = run(probe, ["claude", "-p", "reply ok", "--output-format", "text"], env, timeout=180)
        first = probe.root / "modellog" / "1.json"
        if not first.exists():
            probe.fail(f"no model request recorded (claude rc={rc})")
        request = json.loads(first.read_text())

        def locate(obj, path="$"):
            hits = []
            if isinstance(obj, dict):
                for key, value in obj.items():
                    hits += locate(value, f"{path}.{key}")
            elif isinstance(obj, list):
                for i, value in enumerate(obj):
                    hits += locate(value, f"{path}[{i}]")
            elif isinstance(obj, str) and UPS_MARKER in obj:
                hits.append((path, obj))
            return hits

        hits = locate(request)
        in_messages = [h for h in hits if h[0].startswith("$.messages")]
        if not in_messages:
            probe.fail(
                "UserPromptSubmit stdout never reached the first model request's user turn; "
                "a2a's claude prompt-hook delivery depends on it"
            )
        path, text = hits[0]
        idx = text.find(UPS_MARKER)
        snippet = text[max(0, idx - 120): idx + len(UPS_MARKER) + 120]
        print(
            f"PASS [claude-ups]: UserPromptSubmit stdout is context in the FIRST model "
            f"request (path={path})\n  snippet: ...{json.dumps(snippet)}..."
        )
    finally:
        try:
            server.shutdown()
        except Exception:
            pass
        probe.cleanup()


if __name__ == "__main__":
    probe_claude()
    probe_ups_stdout()
