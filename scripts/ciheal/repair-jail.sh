#!/usr/bin/env bash
# The jailed repairer for the CI-heal controller. JAIL_AUTH_DIR selects the
# dedicated subscription login. A trusted, empty-workspace Codex invocation
# refreshes that login before any repair content is mounted; the repair
# receives a disposable copy whose changes are never retained. The jail has
# no network at all: its only way out is the broker socket, so the model
# endpoint is its sole destination and nothing else is reachable. The one
# writable mount is the staged throwaway repository, so a stage without a
# new commit is proof the repair produced no durable effect.
#
#   repair-jail.sh            read the prompt file, repair, commit
#   repair-jail.sh --auth-probe  verify the dedicated login with no repair content
#
# Environment, all set by the workflow:
#   JAIL_IMAGE   the container image, pinned by digest
#   JAIL_NODE    a Node installation to mount at /opt/node
#   JAIL_CODEX   an npm prefix holding @openai/codex, mounted at /opt/codex
#   JAIL_GO      a Go installation to mount at /usr/local/go
#   JAIL_GOMOD   the host's Go module cache, mounted read-only at /opt/gomod
#                (the repair builds offline: GOPROXY=off)
#   JAIL_SOCKET  the broker's unix socket, mounted alone and read-only
#   JAIL_BROKER  the broker's base URL as the container sees it
#   JAIL_DIAL    the dialer's listen address
#   JAIL_MODEL   the repair model
#   JAIL_EFFORT  the repair reasoning effort (default high)
#   JAIL_TIMEOUT the per-repair execution bound in seconds (default 2700)
#   JAIL_STAGE   the staged throwaway repository, mounted writable at /work
#   JAIL_PROMPT  the repair prompt file, mounted read-only
#   JAIL_BUMP    the trusted noisedeck-harness-bump binary (its jail-dial
#                connects the network-less container to the broker socket)
#   JAIL_UID/JAIL_GID  the uid and gid that own the staged repository
#   JAIL_AUTH_DIR  the dedicated subscription login (optional for fixtures)
#   JAIL_SELINUX_LEVEL  the proxy container's SELinux level, when set
set -euo pipefail

JAIL_EFFORT="${JAIL_EFFORT:-high}"
JAIL_TIMEOUT="${JAIL_TIMEOUT:-2700}"
required=(JAIL_IMAGE JAIL_NODE JAIL_CODEX JAIL_GO JAIL_GOMOD JAIL_SOCKET JAIL_BROKER JAIL_DIAL JAIL_MODEL JAIL_BUMP)
if [ "${1:-}" != "--auth-probe" ]; then
	# The probe verifies only the subscription login; repair inputs are
	# deliberately absent in that mode.
	required+=("JAIL_STAGE" "JAIL_PROMPT")
fi
for v in "${required[@]}"; do
	[ -n "${!v:-}" ] || { echo "repair-jail: ${v} is not set" >&2; exit 2; }
done
if [ "${1:-}" = "--auth-probe" ] && [ -z "${JAIL_AUTH_DIR:-}" ]; then
	echo 'repair-jail: auth probe requires the dedicated subscription login' >&2
	exit 2
fi

jail="$(mktemp -d)"
container_name="ciheal-repair-$(basename "${jail}")"
cleanup() {
	local launcher
	for launcher in $(jobs -pr); do
		kill -KILL "${launcher}" 2>/dev/null || true
		wait "${launcher}" 2>/dev/null || true
	done
	# Every container this script launched — the repair jail and the
	# authentication refresh — must be gone before scratch is deleted or
	# the login lock is released: a registered survivor keeps a mount into
	# the scratch directory and an open subscription session.
	local inventory remaining name
	for name in "${container_name}" "${container_name}-refresh"; do
		inventory="$(docker ps -a --no-trunc --filter "name=${name}" --format '{{.ID}} {{.Names}}')" || return 1
		remaining="$(awk -v n="${name}" '$2 == n {print $1}' <<<"${inventory}")"
		if [ -n "${remaining}" ]; then
			[[ "${remaining}" =~ ^[0-9a-f]{64}$ ]] || return 1
			docker rm -f "${remaining}" >/dev/null || return 1
		fi
		inventory="$(docker ps -a --no-trunc --filter "name=${name}" --format '{{.ID}} {{.Names}}')" || return 1
		remaining="$(awk -v n="${name}" '$2 == n {print $1}' <<<"${inventory}")"
		[ -z "${remaining}" ] || return 1
	done
	rm -rf "${jail}"
}
trap 'status=$?; trap - EXIT; cleanup || exit 1; exit "${status}"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 0755 "${jail}"

if [ -n "${JAIL_AUTH_DIR:-}" ]; then
	case "${JAIL_AUTH_DIR}" in /*) ;; *) echo 'repair-jail: auth directory must be absolute' >&2; exit 2 ;; esac
	[ -d "${JAIL_AUTH_DIR}" ] && [ ! -L "${JAIL_AUTH_DIR}" ] || exit 2
	exec 9>"${JAIL_AUTH_DIR}/review.lock"
	flock -n 9 || { echo 'repair-jail: subscription login is already in use' >&2; exit 2; }
	[ -f "${JAIL_AUTH_DIR}/auth.json" ] && [ ! -L "${JAIL_AUTH_DIR}/auth.json" ] || { echo 'repair-jail: local Codex login is missing' >&2; exit 2; }
	jq -e '.auth_mode == "chatgpt" and (.tokens.refresh_token | type == "string" and length > 0) and (.tokens.access_token | type == "string" and length > 0) and (.OPENAI_API_KEY == null)' "${JAIL_AUTH_DIR}/auth.json" >/dev/null 2>&1 || { echo 'repair-jail: a ChatGPT-managed login is required' >&2; exit 2; }
	install -d -m 0700 "${jail}/codex"
	install -m 0600 "${JAIL_AUTH_DIR}/auth.json" "${jail}/codex/auth.json"
fi

uid="${JAIL_UID:-$(id -u)}"
gid="${JAIL_GID:-$(id -g)}"
dial="${JAIL_DIAL}"

run_jail() {
	local auth_args=(--env OPENAI_API_KEY=jail)
	local label_args=()
	if [ -n "${JAIL_SELINUX_LEVEL:-}" ]; then
		[[ "${JAIL_SELINUX_LEVEL}" =~ ^s0(:c[0-9]+(,c[0-9]+)*)?$ ]] || { echo 'repair-jail: invalid proxy SELinux level' >&2; return 2; }
		label_args=(--security-opt "label=level:${JAIL_SELINUX_LEVEL}")
	fi
	if [ -n "${JAIL_AUTH_DIR:-}" ]; then
		auth_args=(--volume "${jail}/codex:/home/jail/.codex:Z" --env JAIL_SUBSCRIPTION=1 --env "HTTPS_PROXY=http://${dial}" --env "HTTP_PROXY=http://${dial}")
	fi
	touch "${jail}/container.started"
	docker run --rm --interactive --name "${container_name}" --cidfile "${jail}/container.cid" \
		--label "noise.ciheal.repair=${JAIL_PROBE_ID:-none}" \
		--pids-limit 1024 --memory 6g --cpus 2 \
		--cap-drop ALL --security-opt no-new-privileges \
		"${label_args[@]}" \
		--user "${uid}:${gid}" \
		--tmpfs /tmp:rw,mode=1777 --tmpfs "/home/jail:rw,uid=${uid},gid=${gid}" \
		--env HOME=/home/jail "${auth_args[@]}" --env CODEX_HOME=/home/jail/.codex \
		--env PATH=/opt/node/bin:/opt/codex/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin \
		--env GOFLAGS=-mod=mod --env GOPATH=/home/jail/go --env GOCACHE=/home/jail/.cache/go-build \
		--env GOMODCACHE=/opt/gomod --env GOPROXY=off \
		--env GIT_AUTHOR_NAME="CI heal" --env GIT_AUTHOR_EMAIL="ciheal@noisefloor.invalid" \
		--env GIT_COMMITTER_NAME="CI heal" --env GIT_COMMITTER_EMAIL="ciheal@noisefloor.invalid" \
		--env JAIL_DIAL="${dial}" \
		--env JAIL_TIMEOUT="${JAIL_TIMEOUT}" \
		--network none \
		--volume "${JAIL_STAGE}:/work:rw,Z" \
		--volume "${JAIL_PROMPT}:/work-prompt:ro,Z" \
		--volume "${JAIL_BUMP}:/opt/broker/bump:ro,z" \
		--volume "${JAIL_SOCKET}:/run/broker/broker.sock:ro,Z" \
		--volume "${JAIL_NODE}:/opt/node:ro,z" \
		--volume "${JAIL_CODEX}:/opt/codex:ro,z" \
		--volume "${JAIL_GO}:/usr/local/go:ro,z" \
		--volume "${JAIL_GOMOD}:/opt/gomod:ro,z" \
		--workdir /work \
		"${JAIL_IMAGE}" sh -c 'mkdir -p "${CODEX_HOME}"; /opt/broker/bump jail-dial -listen "${JAIL_DIAL}" -socket /run/broker/broker.sock >/dev/null & exec "$@"' \
		sh -c 'timeout "${JAIL_TIMEOUT}" codex exec --model "$0" -c model_reasoning_effort="$1" --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check - < /work-prompt' "${JAIL_MODEL}" "${JAIL_EFFORT}" <&0 &
	wait $!
}

if [ "${1:-}" != "--auth-probe" ]; then
	[ -d "${JAIL_STAGE}/.git" ] || { echo 'repair-jail: the staged repository is missing its git directory' >&2; exit 2; }
fi

if [ -n "${JAIL_AUTH_DIR:-}" ]; then
	# No repair content is available to the refresh invocation: a fixed
	# instruction, the dedicated login, and nothing else.
	if ! docker run --rm --name "${container_name}-refresh" \
		--cap-drop ALL --security-opt no-new-privileges \
		--user "${uid}:${gid}" \
		--tmpfs /tmp:rw,mode=1777 --tmpfs "/home/jail:rw,uid=${uid},gid=${gid}" \
		--env HOME=/home/jail --env JAIL_SUBSCRIPTION=1 --env JAIL_DIAL="${dial}" \
		--env "HTTPS_PROXY=http://${dial}" --env "HTTP_PROXY=http://${dial}" \
		--env CODEX_HOME=/home/jail/.codex \
		--env PATH=/opt/node/bin:/opt/codex/bin:/usr/local/bin:/usr/bin:/bin \
		--network none \
		--volume "${jail}/codex:/home/jail/.codex:Z" \
		--volume "${JAIL_BUMP}:/opt/broker/bump:ro,z" \
		--volume "${JAIL_SOCKET}:/run/broker/broker.sock:ro,Z" \
		--volume "${JAIL_NODE}:/opt/node:ro,z" \
		--volume "${JAIL_CODEX}:/opt/codex:ro,z" \
		"${JAIL_IMAGE}" sh -c '/opt/broker/bump jail-dial -listen "${JAIL_DIAL}" -socket /run/broker/broker.sock >/dev/null & exec "$@"' \
		sh -c 'printf "%s\n" "Reply with OK. Do not use tools." | codex exec --model "$0" --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -' "${JAIL_MODEL}" >/dev/null 2>&1; then
		echo 'repair-jail: trusted Codex authentication refresh failed' >&2
		exit 3
	fi
	[ -f "${jail}/codex/auth.json" ] && [ ! -L "${jail}/codex/auth.json" ] || exit 3
	[ "$(wc -c <"${jail}/codex/auth.json")" -le 65536 ] || exit 3
	jq -e '.auth_mode == "chatgpt" and (.tokens.refresh_token | type == "string" and length > 0) and (.tokens.access_token | type == "string" and length > 0) and (.OPENAI_API_KEY == null)' "${jail}/codex/auth.json" >/dev/null 2>&1 || exit 3
	# Promote only a closed credential shape from the trusted invocation.
	jq '{auth_mode, tokens: (.tokens | {id_token, access_token, refresh_token, account_id}), last_refresh}' "${jail}/codex/auth.json" >"${JAIL_AUTH_DIR}/auth.json.next"
	chmod 600 "${JAIL_AUTH_DIR}/auth.json.next"
	mv -f "${JAIL_AUTH_DIR}/auth.json.next" "${JAIL_AUTH_DIR}/auth.json"
	if [ "${1:-}" = "--auth-probe" ]; then
		echo 'repair-jail: subscription authentication probe passed'
		exit 0
	fi
	# The repair sees a fresh disposable copy only.
	rm -rf "${jail}/codex"
	install -d -m 0700 "${jail}/codex"
	install -m 0600 "${JAIL_AUTH_DIR}/auth.json" "${jail}/codex/auth.json"
fi

run_jail
