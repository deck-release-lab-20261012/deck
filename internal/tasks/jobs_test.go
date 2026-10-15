package tasks

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/noisefloor-oss/deck/internal/db"
	"github.com/noisefloor-oss/deck/internal/project"
	"github.com/noisefloor-oss/deck/internal/tmux"
)

// jobEnv is a runner wired to a real temp tmux namespace and a real SQLite
// registry, in temporary namespaces so nothing here can touch an operator
// socket.
type jobEnv struct {
	runner   *Runner
	runs     *RunsRepository
	projects *project.Repository
	project  *project.Project
	tmux     *tmux.Client
}

func requireGenerationSupport(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("PRD generation transport is Linux-only; native refusal is tested separately")
	}
}

// newJobEnv registers a project with an initialized store marker and one PRD,
// and wires a runner whose engine executable is the given stub.
func newJobEnv(t *testing.T, stub string) *jobEnv {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	d, err := db.Open(context.Background(), db.Config{
		Path: filepath.Join(t.TempDir(), "control.db"),
	})
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	projects := project.NewRepository(d)
	root := t.TempDir()
	p, _, err := projects.Register(context.Background(), "demo", root, []string{root}, project.GitIdentity{Name: "Test Author", Email: "test@example.invalid"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	writeStore(t, root, "PRD.md")

	sockDir, err := os.MkdirTemp("", "nd-tmux-")
	if err != nil {
		t.Fatalf("tmux temp dir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	if err := os.Chmod(sockDir, 0o700); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	tc, err := tmux.NewClient(tmux.Config{
		SocketPath: filepath.Join(sockDir, "ac.sock"),
		Timeout:    10 * time.Second,
	})
	if err != nil {
		t.Fatalf("tmux.NewClient: %v", err)
	}
	t.Cleanup(func() { _ = tc.KillServer(context.Background()) })

	runs := NewRunsRepository(d)
	runner := NewRunner(runs, projects, tc, stub, "noisedeck-", zerolog.Nop())
	runner.handoffPrefix = []string{os.Args[0], "-test.run=^TestGenerationHandoffProcess$", "--"}
	t.Cleanup(runner.Shutdown)
	return &jobEnv{runner: runner, runs: runs, projects: projects, project: p, tmux: tc}
}

func removeStubStore(t *testing.T, e *jobEnv) {
	t.Helper()
	if err := os.Remove(filepath.Join(e.project.CanonicalPath, ".tasks", "tasks.sqlite")); err != nil {
		t.Fatal(err)
	}
}

// TestGenerationHandoffProcess lets the package test binary exercise the
// production descriptor-transfer code before it execs each test engine.
// A normal test run has no -- delimiter and returns without entering helper
// mode; the managed tmux invocation selects only this test and supplies it.
func TestGenerationHandoffProcess(t *testing.T) {
	separator := -1
	for i, arg := range os.Args {
		if arg == "--" {
			separator = i
			break
		}
	}
	if separator < 0 {
		return
	}
	if err := RunGenerationHandoff(os.Args[separator+1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// writeStub writes an executable shell script as the fake noise host.
// The PRODUCT runs fixed argv with no shell; the stub is the
// "binary" under test, exactly as a real preinstalled CLI would be. Its
// context contract is the engine's schema-4 shape with the store marker
// standing in for the SQLite database, and its generation contract mirrors
// the canonical argv:
//
//	<exe> tasks generate --yes <prd.md>
//
// so $1=tasks, $2=generate, $3=--yes, $4=prd path.
func writeStub(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "noise")
	contextStub := `if [ "$1" = tasks ] && [ "$2" = context ] && [ "$3" = --json ]; then
  project=${NOISE_PROJECT_DIR:-$PWD}
  initialized=false
  if [ -f "$project/.tasks/tasks.sqlite" ]; then
    initialized=true
  fi
  printf '{"schemaVersion":5,"start":"%s","projectBoundary":"%s","storePath":"%s/.tasks/tasks.sqlite","storeOwnerBoundary":"","storeSchemaVersion":0,"engineSchemaVersion":5,"docsPath":".tasks/docs/PRD.md","preferencesPath":".tasks/preferences.json","initialized":%s,"writable":true,"blocked":false,"blockedReason":""}\n' "$project" "$project" "$project" "$initialized"
  exit 0
fi
`
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+contextStub+body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

// awaitRun polls until the run leaves `running` or the deadline passes.
func (e *jobEnv) awaitRun(t *testing.T, id string) *Run {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		run, err := e.runs.GetRun(context.Background(), id)
		if err != nil {
			t.Fatalf("get run: %v", err)
		}
		if run.Status == RunExited {
			return run
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("run did not reach exited in time")
	return nil
}

func TestGenerateCapturesExitAndOutput(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "echo \"parsed: $*\"\nsleep 0.2\nexit 3")
	e := newJobEnv(t, stub)

	run, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	final := e.awaitRun(t, run.ID)
	if final.ExitCode == nil || *final.ExitCode != 3 {
		t.Fatalf("exit code = %v", final.ExitCode)
	}
	stdout := "<nil>"
	if final.Stdout != nil {
		stdout = *final.Stdout
	}
	if final.Stdout == nil || !strings.Contains(*final.Stdout, "parsed: tasks generate") ||
		!strings.Contains(*final.Stdout, "--yes") {
		t.Fatalf("stdout = %q", stdout)
	}
	if final.FinishedAt == nil || *final.FinishedAt < final.StartedAt {
		t.Fatalf("timestamps: started %s finished %v", final.StartedAt, final.FinishedAt)
	}
	// Duration is reported explicitly, not left to clients.
	if final.DurationMS == nil || *final.DurationMS < 0 {
		t.Fatalf("duration_ms = %v", final.DurationMS)
	}
	// The fixed argv is recorded exactly as executed: the
	// engine's store-backed generate contract — --yes makes the run
	// non-interactive, the PRD is the retained descriptor.
	if len(final.Argv) != 5 || final.Argv[0] != stub || final.Argv[1] != "tasks" ||
		final.Argv[2] != "generate" ||
		final.Argv[3] != "--yes" ||
		final.Argv[4] != "/proc/self/fd/10" {
		t.Fatalf("argv = %v", final.Argv)
	}
	// The corpse session is cleaned up once the evidence is recorded.
	alive, err := e.tmux.HasSession(context.Background(), *final.TmuxSessionName)
	if err != nil {
		t.Fatalf("has session: %v", err)
	}
	if alive {
		t.Fatal("corpse session left behind")
	}
}

func TestGenerateSerializesPerProject(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "sleep 30")
	e := newJobEnv(t, stub)

	if _, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md"); err != nil {
		t.Fatalf("first generate: %v", err)
	}
	_, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	if !errors.Is(err, ErrGenerationRunning) {
		t.Fatalf("second generate: %v", err)
	}
	// A second PROJECT is not serialized against the first: serialization
	// is per-project.
	root2 := t.TempDir()
	writeStore(t, root2, "PRD.md")
	p2, _, err := e.projects.Register(context.Background(), "other", root2, []string{root2}, project.GitIdentity{Name: "Test Author", Email: "test@example.invalid"})
	if err != nil {
		t.Fatalf("register second: %v", err)
	}
	if _, err := e.runner.Generate(context.Background(), p2.ID, "PRD.md"); err != nil {
		t.Fatalf("second project generate: %v", err)
	}
}

func TestGenerateRefusesUninitializedStoreBeforeCreatingRun(t *testing.T) {
	requireGenerationSupport(t)
	e := newJobEnv(t, writeStub(t, "exit 29"))
	removeStubStore(t, e)

	if _, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md"); !errors.Is(err, ErrNotTaskmasterProject) {
		t.Fatalf("generate = %v, want ErrNotTaskmasterProject", err)
	}
	runs, err := e.runs.ListRuns(context.Background(), e.project.ID, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Fatalf("uninitialized refusal created runs: %+v", runs)
	}
}

func TestGenerateRejectsIneligiblePRD(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "exit 0")
	e := newJobEnv(t, stub)
	for _, name := range []string{"missing.md", "../PRD.md", "docs/PRD.md", "PRD.txt", ""} {
		if _, err := e.runner.Generate(context.Background(), e.project.ID, name); !errors.Is(err, ErrInvalidPRD) {
			t.Fatalf("prd %q: %v", name, err)
		}
	}
}

// A LISTED prd whose file is a symlink out of the root passes eligibility
// (names only) but must be refused before launch.
func TestGenerateRefusesPRDSymlinkEscape(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "exit 0")
	e := newJobEnv(t, stub)
	outside := filepath.Join(t.TempDir(), "secret.md")
	if err := os.WriteFile(outside, []byte("# secret"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	link := filepath.Join(e.project.CanonicalPath, ".tasks", "docs", "PRD.md")
	if err := os.Remove(link); err != nil {
		t.Fatalf("remove prd: %v", err)
	}
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("symlink prd: %v", err)
	}
	if _, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md"); !errors.Is(err, ErrUnsafeTree) {
		t.Fatalf("symlinked prd: %v", err)
	}
}

// The engine writes the store it discovers from its own working directory,
// so the generation contract pins two descriptors across a hostile rename:
// the project root the handoff fchdirs into, and the already-open PRD.
func TestGenerateRetainsDescriptorsAcrossDirectorySwaps(t *testing.T) {
	requireGenerationSupport(t)
	for _, swapRoot := range []bool{false, true} {
		swapName := "descendant"
		if swapRoot {
			swapName = "project-root"
		}
		t.Run(swapName, func(t *testing.T) {
			stub := writeStub(t, "sleep 1\n"+
				"grep -q '^# inside$' \"$4\" || exit 41\n"+
				"test -f ./.tasks/tasks.sqlite || exit 42\n"+
				"printf 'generated-inside\\n' > ./.generated-marker\n")
			e := newJobEnv(t, stub)
			if err := os.WriteFile(filepath.Join(e.project.CanonicalPath, ".tasks", "docs", "PRD.md"), []byte("# inside\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			outsideRoot := t.TempDir()
			writeStore(t, outsideRoot, "PRD.md")
			if err := os.WriteFile(filepath.Join(outsideRoot, ".tasks", "docs", "PRD.md"), []byte("# outside\n"), 0o644); err != nil {
				t.Fatal(err)
			}

			root := e.project.CanonicalPath
			target := filepath.Join(root, ".tasks")
			replacement := filepath.Join(outsideRoot, ".tasks")
			saved := filepath.Join(root, ".tasks.anchored")
			insideRoot := func() string { return root }
			if swapRoot {
				target, replacement, saved = root, outsideRoot, root+".anchored"
				insideRoot = func() string { return saved }
			}
			swap := func() {
				if err := os.Rename(target, saved); err != nil {
					t.Fatalf("rename swap target: %v", err)
				}
				if err := os.Symlink(replacement, target); err != nil {
					t.Fatalf("install outside symlink: %v", err)
				}
			}
			if swapRoot {
				e.runner.accessHooks.rootAnchored = swap
			} else {
				e.runner.accessHooks.handoffReady = swap
			}

			run, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
			if err != nil {
				t.Fatalf("generate after swap: %v", err)
			}
			final := e.awaitRun(t, run.ID)
			if final.ExitCode == nil || *final.ExitCode != 0 {
				t.Fatalf("exit = %v, stdout = %v, stderr = %v", final.ExitCode, final.Stdout, final.Stderr)
			}
			assertFileBody(t, filepath.Join(insideRoot(), ".generated-marker"), "generated-inside\n")
			assertFileMissing(t, filepath.Join(outsideRoot, ".generated-marker"))
			assertFileBody(t, filepath.Join(outsideRoot, ".tasks", "docs", "PRD.md"), "# outside\n")
		})
	}
}

func TestGenerateLaunchFailureIsHonest(t *testing.T) {
	requireGenerationSupport(t)
	e := newJobEnv(t, "/nonexistent/noise")
	_, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	// Context resolution uses the same fixed engine. An unavailable engine
	// fails before the intent row or tmux process exists.
	if err == nil {
		t.Fatal("missing task engine was accepted")
	}
	runs, lerr := e.runs.ListRuns(context.Background(), e.project.ID, 5)
	if lerr != nil {
		t.Fatalf("list: %v", lerr)
	}
	if len(runs) != 0 {
		t.Fatalf("runs = %+v", runs)
	}
}

func TestReconcileFinalizesAfterWatcherLoss(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "echo done\nexit 0")
	e := newJobEnv(t, stub)

	run, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	// Simulate a service restart: watchers die, the tmux job lives on.
	e.runner.Shutdown()

	fresh := NewRunner(e.runs, e.projects, e.tmux, stub, "noisedeck-", zerolog.Nop())
	defer fresh.Shutdown()
	deadline := time.Now().Add(15 * time.Second)
	for {
		if err := fresh.Reconcile(context.Background()); err != nil {
			t.Fatalf("reconcile: %v", err)
		}
		got, gerr := e.runs.GetRun(context.Background(), run.ID)
		if gerr != nil {
			t.Fatalf("get: %v", gerr)
		}
		if got.Status == RunExited {
			if got.ExitCode != nil && *got.ExitCode != 0 {
				t.Fatalf("exit = %v", got.ExitCode)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("reconcile never finalized: %+v", got)
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// A split window changes the session's CURRENT pane; reconciliation must
// still find the ORIGINAL pane by its marker and leave the run running.
func TestReconcileIgnoresCurrentPaneConfusion(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "sleep 30")
	e := newJobEnv(t, stub)

	run, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	e.runner.Shutdown() // simulate a restart: no watchers

	// A second pane becomes the session's CURRENT pane (no -d): the
	// current pane is no longer the job's pane at all.
	split := exec.Command("tmux", "-S", e.tmux.SocketPath(),
		"split-window", "-t", "="+*run.TmuxSessionName+":")
	if out, err := split.CombinedOutput(); err != nil {
		t.Fatalf("split-window: %v: %s", err, out)
	}

	fresh := NewRunner(e.runs, e.projects, e.tmux, stub, "noisedeck-", zerolog.Nop())
	defer fresh.Shutdown()
	if err := fresh.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	got, err := e.runs.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != RunRunning {
		t.Fatalf("current-pane confusion finalized the run: %+v", got)
	}

	// And the resumed watcher still records the real outcome: kill the
	// session, the exit is honestly unobserved.
	if err := e.tmux.KillSession(context.Background(), *run.TmuxSessionName); err != nil {
		t.Fatalf("kill: %v", err)
	}
	final := e.awaitRun(t, run.ID)
	if final.ExitCode != nil {
		t.Fatalf("killed session invented an exit code: %+v", final)
	}
}

func TestReconcileGoneSessionIsUnobservedNotInvented(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "sleep 30")
	e := newJobEnv(t, stub)

	run, err := e.runner.Generate(context.Background(), e.project.ID, "PRD.md")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	e.runner.Shutdown()
	// The job vanishes without anyone observing its exit.
	if err := e.tmux.KillSession(context.Background(), *run.TmuxSessionName); err != nil {
		t.Fatalf("kill session: %v", err)
	}

	fresh := NewRunner(e.runs, e.projects, e.tmux, stub, "noisedeck-", zerolog.Nop())
	defer fresh.Shutdown()
	if err := fresh.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	got, err := e.runs.GetRun(context.Background(), run.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != RunExited || got.ExitCode != nil {
		t.Fatalf("unobserved exit recorded as: %+v", got)
	}
	if got.Stderr == nil || !strings.Contains(*got.Stderr, "gone before exit status was observed") {
		t.Fatalf("stderr note = %v", got.Stderr)
	}
}

// The endpoints: 202 on start, 409 while one runs, 400 on a bad PRD,
// slim list, full detail, no cross-project reads.
func TestJobEndpoints(t *testing.T) {
	requireGenerationSupport(t)
	stub := writeStub(t, "echo hi\nexit 0")
	e := newJobEnv(t, stub)

	h := NewHandler(e.projects, stub, zerolog.Nop()).WithRunner(e.runner)
	mux := http.NewServeMux()
	h.Mount(mux.Handle, func(next http.Handler) http.Handler { return next })

	post := func(projectID, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost,
			"/api/projects/"+projectID+"/taskmaster/generate", strings.NewReader(body))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	if rec := post(e.project.ID, `{"prd": "nope.md"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad prd: %d %s", rec.Code, rec.Body)
	}
	if rec := post("nope", `{"prd": "PRD.md"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown project: %d", rec.Code)
	}

	slow := writeStub(t, "sleep 30")
	e2 := newJobEnv(t, slow)
	h2 := NewHandler(e2.projects, slow, zerolog.Nop()).WithRunner(e2.runner)
	mux2 := http.NewServeMux()
	h2.Mount(mux2.Handle, func(next http.Handler) http.Handler { return next })
	post2 := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost,
			"/api/projects/"+e2.project.ID+"/taskmaster/generate", strings.NewReader(body))
		rec := httptest.NewRecorder()
		mux2.ServeHTTP(rec, req)
		return rec
	}
	if rec := post2(`{"prd": "PRD.md"}`); rec.Code != http.StatusAccepted {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	if rec := post2(`{"prd": "PRD.md"}`); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "generation_running") {
		t.Fatalf("conflict: %d %s", rec.Code, rec.Body)
	}

	// List is slim, detail is full, foreign ids are 404.
	req := httptest.NewRequest(http.MethodGet,
		"/api/projects/"+e2.project.ID+"/taskmaster/runs", nil)
	rec := httptest.NewRecorder()
	mux2.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "stdout") {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	req = httptest.NewRequest(http.MethodGet,
		"/api/projects/"+e2.project.ID+"/taskmaster/runs/nope", nil)
	rec = httptest.NewRecorder()
	mux2.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown run: %d", rec.Code)
	}
}
