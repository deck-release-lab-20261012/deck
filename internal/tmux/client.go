package tmux

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// DefaultTimeout bounds every tmux invocation. tmux commands are local and
// fast; a hang means the server is wedged, and blocking forever would turn
// that into a hung reconciler with no diagnostic.
const DefaultTimeout = 10 * time.Second

const (
	spawnTransitionPoll  = 5 * time.Millisecond
	spawnTransitionLimit = 500 * time.Millisecond
	spawnStabilityWindow = 50 * time.Millisecond
)

// serverConfig is applied when the tmux server starts, via `-f`.
//
// remain-on-exit MUST be established this way rather than with a set-option
// call after new-session. Measured on tmux 3.6a: creating a session whose
// command exits immediately and then setting the option loses the session 8
// times out of 10 — the pane is gone before the option lands, taking the
// recorded exit evidence with it. Applied as server config it is set before
// any pane runs: 0 losses in the same test.
//
// exit-empty off keeps the server alive once its last session is killed, so
// the global option survives rather than being silently lost with the server.
//
// status off removes tmux's default status line. The provider CLI draws its
// own UI; the green bar is redundant chrome whose right edge truncates
// mid-content and reads as a rendering defect.
//
// history-limit is the pane scrollback depth copy-mode scrolls through
// (NOISEDECK_TMUX_SCROLLBACK_LINES). It must be in force BEFORE a pane is created:
// tmux reads it at pane creation and never re-reads it, so setting it later
// leaves existing panes at the 2000-line default.
//
// terminal-features adds `sync` for the attaching client, whose TERM is
// screen-256color. tmux already batches one pane redraw between
// synchronized-update markers, but only for a client whose terminal claims the
// capability, and tmux's own defaults grant screen* nothing but `title`.
// Measured both ways on this config: with the feature the attached client
// receives the markers around a resize repaint; without it, none are sent at
// all. Unbatched, the browser renders every intermediate state of a provider's
// full-screen repaint — the whole-screen redraw operators report against
// inline CLIs like omp and pi, which rewrite their entire transcript rather
// than one alternate screen. The markers are DEC private mode 2026 from tmux
// 3.4; older tmux emits an iTerm2 DCS form that a browser ignores.
const serverConfigFormat = `set-option -g remain-on-exit on
set-option -g exit-empty off
set-option -g status off
set-option -g history-limit %d
set-option -as terminal-features ",screen*:sync"
`

// DefaultScrollbackLines is the pane history depth used when the caller does
// not configure one. It matches the browser terminal's own scrollback
// (web/src/terminal/term.ts).
const DefaultScrollbackLines = 2000

// Option keys carrying Deck's pane identity. They are tmux user
// options, which is why they begin with '@'.
const (
	OptGeneration = "@noisedeck_generation"
	OptMarker     = "@noisedeck_marker"
)

// Config parameterizes NewClient.
type Config struct {
	// SocketPath is the dedicated Deck tmux namespace. It must not be
	// the user's default tmux socket: this client kills and respawns panes.
	SocketPath string
	Timeout    time.Duration
	// ScrollbackLines is the tmux history-limit for panes in this namespace
	// (NOISEDECK_TMUX_SCROLLBACK_LINES). Zero or negative selects
	// DefaultScrollbackLines.
	ScrollbackLines int
}

// Client runs tmux against one dedicated socket.
//
// Every invocation is a fixed executable plus argv — never a shell — so no
// caller-supplied string is ever evaluated.
type Client struct {
	socketPath      string
	configPath      string
	timeout         time.Duration
	scrollbackLines int

	writeObserverMu  sync.RWMutex
	writeObserver    func(WriteObservation)
	attachObserverMu sync.RWMutex
	attachObserver   func(AttachObservation)
	testHooks        *clientTestHooks
}

type clientTestHooks struct {
	afterSpawn         func(string) error
	afterSpawnCommand  func(string) error
	afterMarkers       func(string) error
	spawnArgs          func(string, []string) []string
	spawnRunResult     func(string, string, error) (string, error)
	beforeMarkerWrite  func(string) error
	beforeIdentityKill func()
}

// SetSpawnFailureForTest injects an error after tmux has physically created
// or respawned a pane. It exercises the partial-spawn rollback contract.
func (c *Client) SetSpawnFailureForTest(inject func(string) error) {
	if c.testHooks == nil {
		c.testHooks = &clientTestHooks{}
	}
	c.testHooks.afterSpawn = inject
}

// SetFinalSpawnFailureForTest injects an error after both identity options are
// durable but before CreateSession's final observation. It exercises the
// boundary where another backend can already converge the candidate.
func (c *Client) SetFinalSpawnFailureForTest(inject func(string) error) {
	if c.testHooks == nil {
		c.testHooks = &clientTestHooks{}
	}
	c.testHooks.afterMarkers = inject
}

// WriteObservation is test evidence emitted immediately before a terminal
// write attempt crosses into tmux. Production never installs an observer; the
// acceptance gate uses it to count exactly which keystrokes invoke the
// physical writer, including attempts whose acknowledgement is lost or times
// out.
type WriteObservation struct {
	PaneID string
	Data   []byte
	Key    string
}

// SetWriteObserverForTest installs the acceptance suite's write-boundary
// observer. Passing nil removes it. The callback runs synchronously before a
// physical write attempt and must return quickly.
func (c *Client) SetWriteObserverForTest(observer func(WriteObservation)) {
	c.writeObserverMu.Lock()
	c.writeObserver = observer
	c.writeObserverMu.Unlock()
}

func (c *Client) observeWrite(observation WriteObservation) {
	c.writeObserverMu.RLock()
	observer := c.writeObserver
	c.writeObserverMu.RUnlock()
	if observer != nil {
		observer(observation)
	}
}

// AttachObservation describes one physical tmux client attachment.
type AttachObservation struct {
	SessionName string
	Cols        uint16
	Rows        uint16
}

// SetAttachObserverForTest installs a test-only observation at the physical
// tmux attach boundary. Production never installs one.
func (c *Client) SetAttachObserverForTest(observer func(AttachObservation)) {
	c.attachObserverMu.Lock()
	c.attachObserver = observer
	c.attachObserverMu.Unlock()
}

func (c *Client) observeAttach(observation AttachObservation) {
	c.attachObserverMu.RLock()
	observer := c.attachObserver
	c.attachObserverMu.RUnlock()
	if observer != nil {
		observer(observation)
	}
}

// SessionSpec describes a session to create.
type SessionSpec struct {
	Name    string
	WorkDir string
	// Argv[0] is the executable, run directly as the pane command. tmux
	// must not launch a shell and type the command into it.
	Argv []string
	Env  []string
	// Generation and Marker are written as pane options so a pane can later
	// be proven to be the one we launched.
	Generation int
	Marker     string
	// Cols and Rows size the detached window at creation. Zero leaves the
	// tmux default (80x24) — a size the pane keeps until a client attaches,
	// which lays out every headless line at a width no operator is viewing.
	Cols uint16
	Rows uint16
	// RetainPartialOnError transfers rollback ownership to a caller that has a
	// durable action fence. Ordinary launches leave this false and retain the
	// tmux client's immediate rollback behavior.
	RetainPartialOnError bool
}

// PaneInfo is the observed runtime identity of a session's pane.
//
// This is the tuple reconciliation compares. A session name, or a PID, or a
// command line alone is explicitly insufficient.
type PaneInfo struct {
	SessionID      string
	SessionName    string
	PaneID         string
	PID            int
	ProcessGroupID int
	StartTicks     int64
	Executable     string
	// Spawn* preserves the first complete physical tuple returned by the
	// new-session command. Later observations may describe the same pane after
	// an out-of-band respawn; controller publication must reject that drift.
	SpawnPID            int
	SpawnProcessGroupID int
	SpawnStartTicks     int64
	CurrentCommand      string
	Dead                bool
	ExitStatus          *int
	ExitSignal          *int
	Generation          int
	Marker              string
	// LaunchMarker is stamped in the tmux session environment by
	// CreateSession. It identifies a newly created pane before its ordinary
	// pane options have been written, so a partial launch can be rolled back
	// without trusting reusable tmux IDs alone.
	LaunchMarker string
	// InMode is tmux's own pane_in_mode flag: the pane is showing a tmux
	// view (copy-mode) instead of the application. While set, tmux routes
	// every key — send-keys and attached-client input alike — to the mode's
	// key table, so bytes written "to the pane" never reach the CLI. The hot
	// input path reads the same tmux flag through PaneInputState before operator
	// input rather than silently losing keystrokes. It is tmux-owned
	// mode state, not provider output.
	InMode bool
}

// PaneInputState is the tmux-owned state that decides whether an attachment
// can truthfully report a write as sent. It deliberately excludes session and
// process identity: the hot input path needs the pane's current state, not a
// second reconciliation pass.
type PaneInputState struct {
	Dead   bool
	InMode bool
}

// PaneIdentity is the tmux-owned identity required for an atomic pane kill.
// Generation and Marker may both be zero only when LaunchMarker is present,
// which is the partial-Create state before pane options are written.
type PaneIdentity struct {
	SessionID    string
	PaneID       string
	PanePID      int
	Generation   int
	Marker       string
	LaunchMarker string
}

// SessionInfo is one entry from ListSessions.
type SessionInfo struct {
	Name    string
	ID      string
	Created int64
}

// ErrNoSession reports that the named session or pane does not exist on a
// server we successfully reached.
var ErrNoSession = errors.New("tmux: no such session")

// ErrNoServer reports that the tmux server itself is unreachable — not
// running, or its socket is gone.
//
// This is deliberately NOT the same as ErrNoSession. A missing pane on a live
// server proves the process behind it is gone; an unreachable server proves
// nothing about any process, because tmux dying does not kill the panes'
// children. Conflating the two lets "we cannot see it" be reported as "it
// exited", which is precisely the kind of unverified claim this product must
// never make.
var ErrNoServer = errors.New("tmux: no server running")

// ErrPartialSpawnCleaned accompanies a CreateSession failure only when the
// exact process group first returned by new-session is proven gone and its
// exact pane is killed or positively absent. Callers may use it to revoke
// launch-scoped capabilities; its absence means cleanup was uncertain.
var ErrPartialSpawnCleaned = errors.New("tmux: partial spawn cleanup complete")

// NewClient validates the socket location and prepares the server config.
//
// It does not start a tmux server: tmux exits a server with no sessions, so
// there is nothing to start until the first session is created.
func NewClient(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.SocketPath) == "" {
		return nil, errors.New("tmux: Config.SocketPath is required")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}
	if cfg.ScrollbackLines <= 0 {
		cfg.ScrollbackLines = DefaultScrollbackLines
	}

	socketPath, err := filepath.Abs(cfg.SocketPath)
	if err != nil {
		return nil, fmt.Errorf("tmux: resolve socket path: %w", err)
	}
	dir := filepath.Dir(socketPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("tmux: create socket directory: %w", err)
	}
	if err := verifySocketDir(dir); err != nil {
		return nil, err
	}

	configPath := filepath.Join(dir, "noisedeck.tmux.conf")
	serverConfig := fmt.Sprintf(serverConfigFormat, cfg.ScrollbackLines)
	if err := os.WriteFile(configPath, []byte(serverConfig), 0o600); err != nil {
		return nil, fmt.Errorf("tmux: write server config: %w", err)
	}

	return &Client{socketPath: socketPath, configPath: configPath,
		timeout: cfg.Timeout, scrollbackLines: cfg.ScrollbackLines}, nil
}

// verifySocketDir requires the directory to be owned by the runtime user
// with mode 0700. Startup fails on mismatch rather than proceeding, because
// a group- or world-accessible socket lets any local process drive the
// operator's agent sessions.
//
// Ownership is checked as well as mode. A 0700 directory owned by somebody
// else is not protection — its owner can still read, traverse, and replace the
// socket inside it, so mode alone satisfies the letter of the requirement
// while leaving the threat it names wide open.
func verifySocketDir(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("tmux: stat socket directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("tmux: %q is not a directory", dir)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		return fmt.Errorf(
			"tmux: socket directory %q has mode %04o, want 0700: a group- or "+
				"world-accessible tmux socket lets other local processes control "+
				"agent sessions", dir, perm)
	}
	return verifyOwnedByRuntimeUser(dir, info)
}

// VerifySocket checks the socket file itself once it exists. The directory
// check alone is not sufficient — the socket's own mode and owner govern who
// may connect to a running server.
func (c *Client) VerifySocket() error {
	info, err := os.Stat(c.socketPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil // no server yet; nothing to verify
	}
	if err != nil {
		return fmt.Errorf("tmux: stat socket: %w", err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		return fmt.Errorf(
			"tmux: socket %q has mode %04o, want no group or other access",
			c.socketPath, perm)
	}
	return verifyOwnedByRuntimeUser(c.socketPath, info)
}

// VerifySecurity re-checks the socket directory and the socket. It is the
// call readiness should make, since permissions can change after startup.
func (c *Client) VerifySecurity() error {
	if err := verifySocketDir(filepath.Dir(c.socketPath)); err != nil {
		return err
	}
	return c.VerifySocket()
}

// SocketPath reports the socket this client drives.
func (c *Client) SocketPath() string { return c.socketPath }

// run executes tmux with the given arguments and returns trimmed stdout.
func (c *Client) run(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	full := append([]string{"-S", c.socketPath, "-f", c.configPath}, args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	out := strings.TrimRight(stdout.String(), "\n")
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if isServerUnreachable(msg) {
			return out, fmt.Errorf("%w: %s", ErrNoServer, msg)
		}
		if isMissingTarget(msg) {
			return out, fmt.Errorf("%w: %s", ErrNoSession, msg)
		}
		return out, fmt.Errorf("tmux %s: %s", strings.Join(args, " "), msg)
	}
	return out, nil
}

// isServerUnreachable matches failures that mean the tmux server is not there,
// as opposed to a target being absent from a server we did reach.
//
// The socket-missing case is narrowed to not-found deliberately: "error
// connecting to" also covers permission-denied, and treating THAT as an
// absent server would turn a socket-permission violation into a silent
// empty result.
func isServerUnreachable(msg string) bool {
	m := strings.ToLower(msg)
	return strings.Contains(m, "no server running") ||
		strings.Contains(m, "server exited unexpectedly") ||
		(strings.Contains(m, "error connecting to") &&
			strings.Contains(m, "no such file or directory"))
}

func isMissingTarget(msg string) bool {
	m := strings.ToLower(msg)
	return strings.Contains(m, "no such session") ||
		strings.Contains(m, "no such pane") ||
		strings.Contains(m, "can't find session") ||
		strings.Contains(m, "can't find pane") ||
		// A reachable server holding zero sessions. `exit-empty off` keeps such
		// a server alive, so this is a normal steady state for this namespace,
		// not a failure — tmux just has nothing to resolve a target against.
		strings.Contains(m, "no current target")
}

// target builds an exact-match target usable for both session-scoped and
// pane-scoped tmux commands.
//
// The trailing ':' is required, not decorative. Measured on tmux 3.6a:
//
//	set-option -p -t =ac        -> "no such pane: =ac"
//	display-message -t =ac      -> succeeds, resolves to NOTHING (empty output)
//	display-message -t =ac:     -> resolves to session "ac"
//
// The middle case is the dangerous one: a bare '=name' pane target does not
// error, it silently resolves to no pane, so a caller would read empty fields
// and conclude the session had no identity rather than that it had asked the
// wrong question. The ':' anchors the target to that session's current window
// and pane, and the '=' keeps the name match exact rather than a prefix.
func target(name string) string { return "=" + name + ":" }

// paneIDPattern matches tmux pane ids, which are always '%' followed by
// digits.
var (
	paneIDPattern       = regexp.MustCompile(`^%\d+$`)
	sessionIDPattern    = regexp.MustCompile(`^\$\d+$`)
	identityTextPattern = regexp.MustCompile(`^[A-Za-z0-9-]*$`)
)

const launchMarkerEnv = "NOISEDECK_TMUX_LAUNCH_MARKER"

// paneTarget builds a target for a specific pane.
//
// A session-scoped target such as "=name:" resolves the session's CURRENT
// window and pane, which is mutable: if the provider opens a window, or the
// active pane changes, that target silently moves. Every operation that
// reads or writes the provider's pane must therefore address the pane id
// captured at launch — which is also the pane id that forms part of session
// identity.
func paneTarget(paneID string) string { return paneID }

// ValidatePaneID rejects anything that is not a tmux pane id.
func ValidatePaneID(paneID string) error {
	if !paneIDPattern.MatchString(paneID) {
		return fmt.Errorf("tmux: %q is not a pane id (expected %%N)", paneID)
	}
	return nil
}

// ValidateSessionName rejects names tmux would interpret as something other
// than a plain session name.
//
// ':' and '.' separate session, window, and pane in a tmux target, and
// '$', '%', '@', '=' introduce IDs or exact-match syntax. A name containing
// any of them could redirect an operation to a different target — which for
// this client means killing or writing into the wrong pane.
func ValidateSessionName(name string) error {
	if name == "" {
		return errors.New("tmux: session name is empty")
	}
	if len(name) > 200 {
		return errors.New("tmux: session name is too long")
	}
	if strings.ContainsAny(name, ":.$%@={}\n\t ") {
		return fmt.Errorf(
			"tmux: session name %q contains a character tmux treats as target "+
				"syntax (one of `:.$%%@={} `, whitespace, or newline)", name)
	}
	return nil
}

// verifyServerOptions reads back the options that must be in force.
//
// The `-f` config alone is not enough: tmux applies a config file ONLY when it
// starts a server, and silently ignores it otherwise. Measured on tmux 3.6a —
// against a server started without our config, passing `-f` had no effect
// (remain-on-exit stayed off) and an immediately-exiting session vanished,
// exactly the failure the config exists to prevent. That server can exist for
// mundane reasons: a previous Deck build, a crashed run, or a
// leftover socket.
//
// So the options are set explicitly when a server is already up, and then read
// back. Setting without verifying would leave the same silent failure one typo
// away.
// serverOptions is the global option list this client requires, in one
// place so the -f config, the inline set-option prefixes, and the read-back
// verification cannot drift apart.
//
// The three application points are NOT equivalent for history-limit: tmux
// sizes a pane's history once, at pane creation, so the option governs
// panes created AFTER it is in force. An existing pane keeps the depth it
// was born with — including across respawn-pane, which reuses the pane
// (measured on tmux 3.6a; see RespawnPane).
func (c *Client) serverOptions() [][2]string {
	return [][2]string{
		{"remain-on-exit", "on"},
		{"exit-empty", "off"},
		{"status", "off"},
		{"history-limit", strconv.Itoa(c.scrollbackLines)},
	}
}

// setOptionArgs renders serverOptions as an ordered set-option command
// prefix for a compound tmux invocation.
func (c *Client) setOptionArgs() []string {
	var args []string
	for _, opt := range c.serverOptions() {
		args = append(args, "set-option", "-g", opt[0], opt[1], ";")
	}
	return args
}

func (c *Client) verifyServerOptions(ctx context.Context) error {
	for _, opt := range c.serverOptions() {
		if opt[0] == "status" {
			// status is cosmetic chrome, not exit-evidence correctness; a
			// mismatch would not lose data, so it is set but not fatal here.
			continue
		}
		got, err := c.run(ctx, "show-options", "-g", "-v", opt[0])
		if err != nil {
			return fmt.Errorf("tmux: read back global %s: %w", opt[0], err)
		}
		if got != opt[1] {
			return fmt.Errorf(
				"tmux: global %s is %q, want %q: a server running without the "+
					"required options loses exit evidence (remain-on-exit, "+
					"exit-empty) or scrollback depth (history-limit)",
				opt[0], got, opt[1])
		}
	}
	return nil
}

// CreateSession launches a detached session whose pane command is the given
// executable, run directly, and records its identity markers.
func (c *Client) CreateSession(ctx context.Context, spec SessionSpec) (*PaneInfo, error) {
	if err := ValidateSessionName(spec.Name); err != nil {
		return nil, err
	}
	if len(spec.Argv) == 0 {
		return nil, errors.New("tmux: SessionSpec.Argv is required")
	}
	if spec.WorkDir == "" {
		return nil, errors.New("tmux: SessionSpec.WorkDir is required")
	}
	if spec.Generation < 1 {
		return nil, errors.New("tmux: SessionSpec.Generation must be >= 1")
	}
	if spec.Marker == "" {
		return nil, errors.New("tmux: SessionSpec.Marker is required")
	}
	if info, err := os.Stat(spec.WorkDir); err != nil {
		return nil, fmt.Errorf("tmux: working directory %q: %w", spec.WorkDir, err)
	} else if !info.IsDir() {
		return nil, fmt.Errorf("tmux: working directory %q is not a directory", spec.WorkDir)
	}

	// Options and creation go in ONE tmux invocation, as an ordered command
	// list. Two invocations leave a window in which a server can appear
	// between them — and a server that already exists ignores `-f`, so the
	// second call would create a session on an unconfigured server. Measured
	// on tmux 3.6a, this form works on a cold socket (tmux starts the server
	// for the list, applying `-f`) and on a warm unconfigured one.
	//
	// `-P -F` returns the created session and pane ids from new-session itself.
	// Resolving them afterwards through a session target would let the provider
	// open a window first and hand us the wrong pane. The launch marker is also
	// stamped in the new session's environment by this physical command, so a
	// later setup failure can identify the pane before its user options exist.
	args := append(c.setOptionArgs(),
		"new-session", "-d", "-P", "-F", "#{session_id}\t#{pane_id}\t#{pane_pid}",
		"-s", spec.Name, "-c", spec.WorkDir,
	)
	if spec.Cols > 0 && spec.Rows > 0 {
		args = append(args, "-x", strconv.Itoa(int(spec.Cols)), "-y", strconv.Itoa(int(spec.Rows)))
	}
	for _, kv := range spec.Env {
		args = append(args, "-e", kv)
	}
	args = append(args, "-e", launchMarkerEnv+"="+spec.Marker)
	// Everything after "--" is the command and its arguments. tmux execs it
	// directly; no shell parses any of it.
	args = append(args, "--")
	args = append(args, spec.Argv...)

	created, runErr := c.run(ctx, args...)
	commandAccepted := runErr == nil
	if commandAccepted && c.testHooks != nil && c.testHooks.afterSpawnCommand != nil {
		runErr = c.testHooks.afterSpawnCommand("create")
	}
	partial, parseErr := createdPaneInfo(created, spec)
	if runErr == nil && parseErr != nil {
		runErr = parseErr
	}
	if runErr != nil {
		partial, observeErr := c.recoverCreatedPane(ctx, spec, partial)
		if partial == nil {
			return nil, errors.Join(runErr, observeErr)
		}
		if spec.RetainPartialOnError {
			return partial, errors.Join(runErr, observeErr)
		}
		return partial, c.rollbackPartialSpawn(ctx, partial, errors.Join(runErr, observeErr))
	}
	paneID := partial.PaneID
	fail := func(cause error) (*PaneInfo, error) {
		if spec.RetainPartialOnError {
			return partial, cause
		}
		return partial, c.rollbackPartialSpawn(ctx, partial, cause)
	}
	if observed, observeErr := c.observeSpawnedPane(ctx, paneID); observeErr == nil {
		partial = preserveSpawnOriginObservation(partial, observed)
	} else {
		return fail(fmt.Errorf("tmux: observe newly created pane: %w", observeErr))
	}
	if c.testHooks != nil && c.testHooks.afterSpawn != nil {
		if err := c.testHooks.afterSpawn("create"); err != nil {
			return fail(err)
		}
	}
	if err := c.verifyServerOptions(ctx); err != nil {
		return fail(err)
	}

	// Markers are set immediately after creation. Unlike remain-on-exit, this
	// is safe against an instantly-exiting command: remain-on-exit is already
	// active, so the pane persists as dead and still accepts option writes.
	if err := c.SetPaneOption(ctx, paneID, OptGeneration, strconv.Itoa(spec.Generation)); err != nil {
		return fail(fmt.Errorf("tmux: record generation marker: %w", err))
	}
	if c.testHooks != nil && c.testHooks.beforeMarkerWrite != nil {
		if err := c.testHooks.beforeMarkerWrite("create"); err != nil {
			return fail(err)
		}
	}
	if err := c.SetPaneOption(ctx, paneID, OptMarker, spec.Marker); err != nil {
		return fail(fmt.Errorf("tmux: record identity marker: %w", err))
	}
	partial.Generation = spec.Generation
	partial.Marker = spec.Marker
	if c.testHooks != nil && c.testHooks.afterMarkers != nil {
		if err := c.testHooks.afterMarkers("create"); err != nil {
			return fail(err)
		}
	}
	info, err := c.observeSpawnedPane(ctx, paneID)
	if err != nil {
		return fail(err)
	}
	return preserveSpawnOriginObservation(partial, info), nil
}

func createdPaneInfo(out string, spec SessionSpec) (*PaneInfo, error) {
	parts := strings.Split(out, "\t")
	if len(parts) != 3 || !sessionIDPattern.MatchString(parts[0]) {
		return nil, fmt.Errorf("tmux: new-session returned invalid identity %q", out)
	}
	if err := ValidatePaneID(parts[1]); err != nil {
		return nil, fmt.Errorf("tmux: new-session returned invalid identity %q: %w", out, err)
	}
	pid, err := strconv.Atoi(parts[2])
	if err != nil || pid <= 0 {
		return nil, fmt.Errorf("tmux: new-session returned invalid pane pid %q", parts[2])
	}
	info := &PaneInfo{
		SessionID: parts[0], SessionName: spec.Name, PaneID: parts[1], PID: pid,
		LaunchMarker: spec.Marker,
	}
	if pgid, ticks, exe, err := processIdentity(pid); err == nil {
		info.ProcessGroupID, info.StartTicks, info.Executable = pgid, ticks, exe
	}
	return markSpawnOrigin(info), nil
}

func (c *Client) recoverCreatedPane(ctx context.Context, spec SessionSpec, partial *PaneInfo) (*PaneInfo, error) {
	observeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout)
	defer cancel()
	var (
		observed *PaneInfo
		err      error
	)
	if partial != nil {
		observed, err = c.PaneInfoByID(observeCtx, partial.PaneID)
	} else {
		observed, err = c.PaneInfoForSession(observeCtx, spec.Name)
	}
	if err != nil {
		if partial != nil && errors.Is(err, ErrNoSession) {
			return partial, nil
		}
		if partial == nil && errors.Is(err, ErrNoSession) {
			return nil, nil
		}
		return partial, fmt.Errorf("tmux: recover created pane identity: %w", err)
	}
	if observed.SessionName != spec.Name || observed.LaunchMarker != spec.Marker {
		return nil, errors.New("tmux: session found after create error did not match its launch identity")
	}
	if partial != nil && (observed.SessionID != partial.SessionID || observed.PaneID != partial.PaneID) {
		return partial, errors.New("tmux: created pane identity changed before rollback")
	}
	return preserveProcessIdentity(partial, observed), nil
}

// HasSession reports whether the named session exists.
func (c *Client) HasSession(ctx context.Context, name string) (bool, error) {
	if err := ValidateSessionName(name); err != nil {
		return false, err
	}
	_, err := c.run(ctx, "has-session", "-t", target(name))
	if err == nil {
		return true, nil
	}
	if errors.Is(err, ErrNoSession) {
		return false, nil
	}
	// ErrNoServer propagates: "absent from a server we reached" and "we could
	// not reach the server" are different facts, and only the first is an
	// answer to the question asked.
	return false, err
}

// ListSessions returns every session on this socket.
func (c *Client) ListSessions(ctx context.Context) ([]SessionInfo, error) {
	out, err := c.run(ctx, "list-sessions", "-F",
		"#{session_name}\t#{session_id}\t#{session_created}")
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			return nil, nil // a reachable server with no sessions
		}
		// ErrNoServer is deliberately NOT flattened into an empty slice.
		// Reconciliation has to distinguish "the inventory is authoritatively
		// empty" from "we could not take an inventory": the first means every
		// recorded session is gone, the second means we know nothing. Returning
		// nil, nil for both would let a transient server outage look like every
		// session having exited.
		return nil, err
	}
	if out == "" {
		return nil, nil
	}

	var sessions []SessionInfo
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) != 3 {
			return nil, fmt.Errorf("tmux: unparseable list-sessions line %q", line)
		}
		created, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("tmux: unparseable session_created in %q: %w", line, err)
		}
		sessions = append(sessions, SessionInfo{Name: parts[0], ID: parts[1], Created: created})
	}
	return sessions, nil
}

// PaneRecord is one entry of the pane inventory.
type PaneRecord struct {
	SessionName string
	SessionID   string
	PaneID      string
	PID         int
	Dead        bool
	Generation  int
	Marker      string
	// ActivityAt is tmux's content-free window activity timestamp. Deck
	// creates one pane in one window per managed session, so the window stamp
	// is the pane's last observed PTY activity without reading its bytes.
	ActivityAt time.Time
}

// ListPanes enumerates every pane on this socket, across all sessions and
// windows.
//
// Unknown managed panes must be audited and left untouched. Per-session
// lookups only find panes already known to Deck, so reconciliation needs
// the whole inventory to find panes no recorded session claims.
//
// Like ListSessions, an unreachable server is an error rather than an empty
// inventory.
func (c *Client) ListPanes(ctx context.Context) ([]PaneRecord, error) {
	out, err := c.run(ctx, "list-panes", "-a", "-F",
		"#{session_name}\t#{session_id}\t#{pane_id}\t#{pane_pid}\t#{pane_dead}\t"+
			"#{@noisedeck_generation}\t#{@noisedeck_marker}\t#{window_activity}")
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			return nil, nil
		}
		return nil, err
	}
	if out == "" {
		return nil, nil
	}

	var panes []PaneRecord
	for _, line := range strings.Split(out, "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) != 8 {
			return nil, fmt.Errorf("tmux: unparseable list-panes line %q", line)
		}
		rec := PaneRecord{
			SessionName: parts[0],
			SessionID:   parts[1],
			PaneID:      parts[2],
			Dead:        parts[4] == "1",
			Marker:      parts[6],
		}
		if parts[3] != "" {
			if rec.PID, err = strconv.Atoi(parts[3]); err != nil {
				return nil, fmt.Errorf("tmux: unparseable pane_pid in %q: %w", line, err)
			}
		}
		if parts[5] != "" {
			if rec.Generation, err = strconv.Atoi(parts[5]); err != nil {
				return nil, fmt.Errorf("tmux: unparseable generation in %q: %w", line, err)
			}
		}
		if parts[7] != "" {
			seconds, parseErr := strconv.ParseInt(parts[7], 10, 64)
			if parseErr != nil {
				return nil, fmt.Errorf("tmux: unparseable window_activity in %q: %w", line, parseErr)
			}
			rec.ActivityAt = time.Unix(seconds, 0).UTC()
		}
		panes = append(panes, rec)
	}
	return panes, nil
}

// KillSession removes a tmux session. That is ALL it does.
//
// It does not stop the provider: a process ignoring SIGHUP/SIGTERM survives
// it (measured on tmux 3.6a). Worse, it destroys the dead pane and with it
// the exit evidence — a pane reporting `dead=1 status= signal=15` becomes
// unreadable immediately afterwards. That cause must be recorded, and
// native resume needs the dead pane itself, so this must NOT be called on
// the normal stop or exit path.
//
// Terminating a provider is session-lifecycle policy, not a tmux mechanism:
// it needs recorded identity, provider-specific behavior, explicit force
// authorization, and reconciliation to establish the outcome. That belongs in
// internal/session, which is why it does not live here.
func (c *Client) KillSession(ctx context.Context, name string) error {
	if err := ValidateSessionName(name); err != nil {
		return err
	}
	_, err := c.run(ctx, "kill-session", "-t", target(name))
	return err
}

// KillPaneIfIdentity compares the complete pane identity and kills it in one
// tmux server command. A mismatch is a clean applied=false result; no caller
// may turn a prior observation into authority for a later kill.
func (c *Client) KillPaneIfIdentity(ctx context.Context, identity PaneIdentity) (bool, error) {
	if err := ValidatePaneID(identity.PaneID); err != nil {
		return false, err
	}
	if !sessionIDPattern.MatchString(identity.SessionID) {
		return false, fmt.Errorf("tmux: %q is not a session id (expected $N)", identity.SessionID)
	}
	if !identityTextPattern.MatchString(identity.Marker) ||
		!identityTextPattern.MatchString(identity.LaunchMarker) {
		return false, errors.New("tmux: pane identity contains unsafe format syntax")
	}
	checks := []string{
		"#{==:#{session_id}," + identity.SessionID + "}",
		"#{==:#{pane_id}," + identity.PaneID + "}",
	}
	if identity.PanePID != 0 {
		if identity.PanePID <= 1 {
			return false, errors.New("tmux: pane identity contains an invalid pid")
		}
		checks = append(checks,
			"#{==:#{pane_pid},"+strconv.Itoa(identity.PanePID)+"}")
	}
	if identity.Generation != 0 || identity.Marker != "" {
		if identity.Generation < 1 || identity.Marker == "" {
			return false, errors.New("tmux: pane generation and marker must be supplied together")
		}
		checks = append(checks,
			"#{==:#{@noisedeck_generation},"+strconv.Itoa(identity.Generation)+"}",
			"#{==:#{@noisedeck_marker},"+identity.Marker+"}")
	}
	if identity.LaunchMarker != "" {
		checks = append(checks,
			"#{==:#{E:"+launchMarkerEnv+"},"+identity.LaunchMarker+"}")
	}
	if len(checks) == 2 {
		return false, errors.New("tmux: pane identity requires pane options or a launch marker")
	}
	if c.testHooks != nil && c.testHooks.beforeIdentityKill != nil {
		c.testHooks.beforeIdentityKill()
	}
	condition := checks[len(checks)-1]
	for i := len(checks) - 2; i >= 0; i-- {
		condition = "#{&&:" + checks[i] + "," + condition + "}"
	}
	thenCommand := "display-message -p killed ; kill-pane -t " + identity.PaneID
	out, err := c.run(ctx, "if-shell", "-F", "-t", identity.PaneID,
		condition, thenCommand, "display-message -p mismatch")
	if err != nil {
		return false, err
	}
	switch out {
	case "killed":
		return true, nil
	case "mismatch":
		return false, nil
	default:
		return false, fmt.Errorf("tmux: conditional pane kill returned %q", out)
	}
}

func paneIdentity(info *PaneInfo) PaneIdentity {
	return PaneIdentity{
		SessionID: info.SessionID, PaneID: info.PaneID,
		PanePID:    info.PID,
		Generation: info.Generation, Marker: info.Marker,
		LaunchMarker: info.LaunchMarker,
	}
}

func (c *Client) rollbackPartialSpawn(ctx context.Context, info *PaneInfo, cause error) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout)
	defer cancel()
	observed, observeErr := c.PaneInfoByID(cleanupCtx, info.PaneID)
	if observeErr != nil {
		return errors.Join(cause,
			fmt.Errorf("tmux: partial spawn identity unavailable before rollback: %w", observeErr))
	}
	info = preserveProcessIdentity(info, observed)
	if !info.MatchesSpawnOrigin() {
		return errors.Join(cause,
			errors.New("tmux: partial spawn physical identity changed before rollback"))
	}

	// Stop the process group while the complete physical pane identity still
	// verifies. Removing the pane first would discard the final identity fence
	// and turn a later process-group signal into an effect on an unverifiable
	// runtime.
	processErr := terminatePartialProcess(cleanupCtx, info)
	if processErr != nil {
		return errors.Join(cause, processErr)
	}

	var paneErr error
	applied, err := c.KillPaneIfIdentity(cleanupCtx, paneIdentity(info))
	if err != nil && !errors.Is(err, ErrNoSession) {
		paneErr = fmt.Errorf("tmux: roll back partial pane: %w", err)
	} else if err == nil && !applied {
		paneErr = errors.New("tmux: partial spawn identity changed before rollback")
	}
	if paneErr != nil {
		return errors.Join(cause, paneErr)
	}
	return errors.Join(cause, ErrPartialSpawnCleaned)
}

func terminatePartialProcess(ctx context.Context, info *PaneInfo) error {
	pgid := info.ProcessGroupID
	if info.Dead {
		if info.PID <= 1 {
			return errors.New("tmux: dead partial spawn has no pane process group")
		}
		if pgid > 1 && pgid != info.PID {
			return fmt.Errorf("tmux: dead pane pid %d disagrees with verified process group %d",
				info.PID, pgid)
		}
		// tmux creates the pane leader as its process-group leader and retains
		// pane_pid after reaping it. Children that did not escape with setsid
		// therefore remain enumerable in this group after a rapid leader exit.
		pgid = info.PID
	} else {
		if info.PID <= 0 || info.StartTicks <= 0 || pgid <= 1 {
			return errors.New("tmux: partial spawn process identity is incomplete")
		}
		alive, err := ProcAlive(info.PID, info.StartTicks)
		if err != nil {
			return fmt.Errorf("tmux: verify partial spawn process: %w", err)
		}
		if alive {
			gotPGID, err := ProcGroup(info.PID, info.StartTicks)
			if err != nil {
				return fmt.Errorf("tmux: resolve partial spawn process group: %w", err)
			}
			if gotPGID != info.ProcessGroupID {
				return fmt.Errorf("tmux: partial spawn process moved from group %d to %d",
					info.ProcessGroupID, gotPGID)
			}
		}
	}
	members, err := GroupMembers(pgid)
	if err != nil {
		return fmt.Errorf("tmux: enumerate partial spawn process group: %w", err)
	}
	if len(members) == 0 {
		return nil
	}
	if err := syscall.Kill(-pgid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
		return fmt.Errorf("tmux: kill partial spawn process group: %w", err)
	}
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		members, err = GroupMembers(pgid)
		if err != nil {
			return fmt.Errorf("tmux: verify partial spawn process group exit: %w", err)
		}
		if len(members) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("tmux: partial spawn process survived cleanup: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func preserveProcessIdentity(prior, observed *PaneInfo) *PaneInfo {
	if prior == nil || observed == nil {
		return observed
	}
	if (observed.Generation == 0) != (observed.Marker == "") {
		observed.Generation = prior.Generation
		observed.Marker = prior.Marker
	}
	observed.SpawnPID = prior.SpawnPID
	observed.SpawnProcessGroupID = prior.SpawnProcessGroupID
	observed.SpawnStartTicks = prior.SpawnStartTicks
	if observed.SessionID == prior.SessionID && observed.PaneID == prior.PaneID &&
		observed.PID == prior.PID && observed.StartTicks == 0 && prior.StartTicks > 0 {
		observed.ProcessGroupID = prior.ProcessGroupID
		observed.StartTicks = prior.StartTicks
	}
	return observed
}

// preserveSpawnOriginObservation keeps the recorded spawn origin across an
// observation, repairing an origin that creation could not complete. A pane
// child can lose the race with its own exec: new-session has returned its
// pid, but the process-table read at creation time fails and the origin is
// stamped without a process group or start time. An observation of the same
// pid carrying a complete tuple still describes the process new-session
// returned, so it anchors the origin rather than being mistaken for a
// replacement of it.
func preserveSpawnOriginObservation(prior, observed *PaneInfo) *PaneInfo {
	if prior != nil && observed != nil &&
		prior.SpawnPID == observed.PID &&
		prior.SpawnProcessGroupID == 0 && prior.SpawnStartTicks == 0 &&
		observed.ProcessGroupID > 1 && observed.StartTicks > 0 {
		return markSpawnOrigin(observed)
	}
	// The child can also lose the race with its own setsid: new-session
	// replies with the pane pid while the child still sits in the tmux
	// server's process group, and a creation-time process-table read in
	// that window stamps the server's group as the origin. A pane leader
	// settles as its own group leader, so an observation of the same
	// process — pid and start ticks both matching — whose group has
	// settled to itself anchors the origin rather than reading as a
	// replacement.
	if prior != nil && observed != nil &&
		prior.SpawnPID == observed.PID &&
		prior.SpawnStartTicks == observed.StartTicks &&
		observed.StartTicks > 0 &&
		observed.ProcessGroupID == observed.PID &&
		prior.SpawnProcessGroupID != observed.PID {
		return markSpawnOrigin(observed)
	}
	return preserveProcessIdentity(prior, observed)
}

func markSpawnOrigin(info *PaneInfo) *PaneInfo {
	if info != nil {
		info.SpawnPID = info.PID
		info.SpawnProcessGroupID = info.ProcessGroupID
		info.SpawnStartTicks = info.StartTicks
	}
	return info
}

// MatchesSpawnOrigin reports whether an observation still describes the
// process first returned by new-session. A dead pane retains only its leader
// PID; a live process must retain the full PID/start/PGID tuple.
func (p *PaneInfo) MatchesSpawnOrigin() bool {
	if p == nil || p.SpawnPID <= 1 || p.PID != p.SpawnPID {
		return false
	}
	if p.Dead {
		return true
	}
	return p.SpawnProcessGroupID > 1 && p.SpawnStartTicks > 0 &&
		p.ProcessGroupID == p.SpawnProcessGroupID && p.StartTicks == p.SpawnStartTicks
}

// paneObservationPending reports whether an observation error means the pane
// leader is mid-transition rather than the answer being wrong: the process
// table answers ENOENT once the leader is reaped, ESRCH while its exit is
// still being published (proc_alive_linux.go treats the same pair as
// positively absent), and EACCES for the window where the kernel has begun
// tearing the task down but /proc still lists it — the pane leader is a child
// of the tmux server rather than of this process, so its exe link is read
// through a ptrace access check that a dying task fails. All three call for
// re-asking tmux, the authority on whether the preserved pane has become dead.
//
// Retrying EACCES cannot mask a genuine denial. The retry is bounded by
// spawnTransitionLimit, so a permission error that is real rather than
// transient still fails the observation carrying that same error. Any other
// error — malformed output, a truncated stat line — fails immediately.
func paneObservationPending(err error) bool {
	return err != nil && (errors.Is(err, os.ErrNotExist) ||
		errors.Is(err, syscall.ESRCH) || errors.Is(err, syscall.EACCES))
}

// observeSpawnedPane resolves the narrow transition where tmux still reports
// a pane live after its process has already left /proc. That observation is
// incomplete, not an identity mismatch: tmux is the authority for whether the
// preserved pane has become dead, so retry until it publishes the exit state.
// Every other observation error remains fatal.
func (c *Client) observeSpawnedPane(ctx context.Context, paneID string) (*PaneInfo, error) {
	info, err := c.PaneInfoByID(ctx, paneID)
	if err == nil || !paneObservationPending(err) {
		return info, err
	}

	observeCtx, cancel := context.WithTimeout(ctx, spawnTransitionLimit)
	defer cancel()
	ticker := time.NewTicker(spawnTransitionPoll)
	defer ticker.Stop()
	for {
		info, err = c.PaneInfoByID(observeCtx, paneID)
		if err == nil || !paneObservationPending(err) {
			return info, err
		}
		select {
		case <-observeCtx.Done():
			return nil, errors.Join(err, observeCtx.Err())
		case <-ticker.C:
		}
	}
}

// PaneInfoAfterSpawn waits through the immediate-exit window before reading a
// newly spawned pane. The previously captured live tuple is retained only
// when the session, pane, and PID still match, so cleanup can prove whether
// children survived after tmux publishes the leader's death.
func (c *Client) PaneInfoAfterSpawn(ctx context.Context, spawned *PaneInfo) (*PaneInfo, error) {
	if spawned == nil {
		return nil, errors.New("tmux: spawned pane identity is required")
	}
	if err := ValidatePaneID(spawned.PaneID); err != nil {
		return nil, err
	}
	timer := time.NewTimer(spawnStabilityWindow)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	observed, err := c.observeSpawnedPane(ctx, spawned.PaneID)
	if err != nil {
		return nil, err
	}
	return preserveProcessIdentity(spawned, observed), nil
}

// paneFormat is one tab-separated record. pane_start_time is deliberately
// absent: tmux 3.6a does not provide it (it renders empty), so process start
// time comes from the host process table, which is also the value
// reconciliation needs for identity comparison.
const paneFormat = "#{session_id}\t#{session_name}\t#{pane_id}\t#{pane_pid}\t" +
	"#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}\t#{pane_current_command}\t" +
	"#{@noisedeck_generation}\t#{@noisedeck_marker}\t#{pane_in_mode}\t" +
	"#{E:" + launchMarkerEnv + "}"

// paneFieldCount is the number of tab-separated fields in paneFormat.
const paneFieldCount = 12

// PaneInfoForSession reads the identity tuple via a session-scoped target.
//
// This resolves the session's CURRENT pane, so it is for discovery only —
// finding the pane of a session whose pane id is not yet known, such as during
// startup reconciliation. Once a pane id is known, use PaneInfoByID: a
// session-scoped target silently follows the active pane if the provider opens
// another one.
func (c *Client) PaneInfoForSession(ctx context.Context, name string) (*PaneInfo, error) {
	if err := ValidateSessionName(name); err != nil {
		return nil, err
	}
	return c.paneInfo(ctx, target(name))
}

// PaneInfoByID reads the identity tuple for one exact pane.
func (c *Client) PaneInfoByID(ctx context.Context, paneID string) (*PaneInfo, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return nil, err
	}
	return c.paneInfo(ctx, paneTarget(paneID))
}

// PaneInputState reads only the exact pane's current dead/view flags. Unlike
// PaneInfoByID it does not inspect the process table or rebuild the pane's
// identity tuple, so it is suitable for the input hot path.
func (c *Client) PaneInputState(ctx context.Context, paneID string) (PaneInputState, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return PaneInputState{}, err
	}
	out, err := c.run(ctx, "display-message", "-p", "-t", paneTarget(paneID),
		"-F", "#{pane_dead}\t#{pane_in_mode}")
	if err != nil {
		return PaneInputState{}, err
	}
	parts := strings.Split(out, "\t")
	if len(parts) != 2 || (parts[0] != "0" && parts[0] != "1") ||
		(parts[1] != "0" && parts[1] != "1") {
		return PaneInputState{}, fmt.Errorf("tmux: unexpected pane input state %q", out)
	}
	return PaneInputState{Dead: parts[0] == "1", InMode: parts[1] == "1"}, nil
}

func (c *Client) paneInfo(ctx context.Context, tgt string) (*PaneInfo, error) {
	out, err := c.run(ctx, "display-message", "-p", "-t", tgt, "-F", paneFormat)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(out, "\t")
	if len(parts) != paneFieldCount {
		return nil, fmt.Errorf("tmux: expected %d pane fields, got %d in %q",
			paneFieldCount, len(parts), out)
	}

	// display-message does not fail for a target that matches nothing — it
	// succeeds and renders every format as empty. Without this guard the empty
	// record would be parsed as a real pane with pid 0, which is both a wrong
	// answer and, for anything that signals a process group, a dangerous one.
	if parts[0] == "" || parts[2] == "" {
		return nil, fmt.Errorf("%w: target %q resolved to no pane", ErrNoSession, tgt)
	}

	info := &PaneInfo{
		SessionID:      parts[0],
		SessionName:    parts[1],
		PaneID:         parts[2],
		Dead:           parts[4] == "1",
		CurrentCommand: parts[7],
		Marker:         parts[9],
		InMode:         parts[10] == "1",
		LaunchMarker:   parts[11],
	}
	if info.PID, err = strconv.Atoi(parts[3]); err != nil {
		return nil, fmt.Errorf("tmux: unparseable pane_pid %q: %w", parts[3], err)
	}
	// A dead pane reports either an exit status or a signal, never both —
	// observed on tmux 3.6a and relied on by the sessions table's
	// exit-code-xor-signal constraint.
	if parts[5] != "" {
		status, err := strconv.Atoi(parts[5])
		if err != nil {
			return nil, fmt.Errorf("tmux: unparseable pane_dead_status %q: %w", parts[5], err)
		}
		info.ExitStatus = &status
	}
	if parts[6] != "" {
		signal, err := strconv.Atoi(parts[6])
		if err != nil {
			return nil, fmt.Errorf("tmux: unparseable pane_dead_signal %q: %w", parts[6], err)
		}
		info.ExitSignal = &signal
	}
	if parts[8] != "" {
		gen, err := strconv.Atoi(parts[8])
		if err != nil {
			return nil, fmt.Errorf("tmux: unparseable generation marker %q: %w", parts[8], err)
		}
		info.Generation = gen
	}

	// A live pane's process details come from the host kernel. A dead pane has
	// no process, so these stay zero rather than being invented.
	if !info.Dead {
		pgid, ticks, exe, err := processIdentity(info.PID)
		if err != nil {
			// Do NOT return a partial tuple with a nil error. A name or PID
			// alone is insufficient identity, so handing a caller an
			// incomplete tuple that looks successful is the precise failure
			// this package exists to prevent — and it would also swallow
			// the deliberate off-Linux error from processIdentity.
			//
			// The process may genuinely have exited between the tmux query and
			// this read. That is a real state, but it is one only tmux can
			// confirm, so it is reported as an error for the caller to resolve
			// by re-reading rather than guessed at here.
			return nil, fmt.Errorf(
				"tmux: pane %s reports pid %d but its process identity could not be "+
					"read (it may have just exited): %w", info.PaneID, info.PID, err)
		}
		info.ProcessGroupID = pgid
		info.StartTicks = ticks
		info.Executable = exe
	}
	return info, nil
}

// SetPaneOption writes a tmux pane option.
func (c *Client) SetPaneOption(ctx context.Context, paneID, key, value string) error {
	if err := ValidatePaneID(paneID); err != nil {
		return err
	}
	if !strings.HasPrefix(key, "@") {
		return fmt.Errorf("tmux: %q is not a user option; it must begin with '@'", key)
	}
	_, err := c.run(ctx, "set-option", "-p", "-t", paneTarget(paneID), key, value)
	return err
}

// GetPaneOption reads a tmux pane option. A missing option reads as "".
func (c *Client) GetPaneOption(ctx context.Context, paneID, key string) (string, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return "", err
	}
	if !strings.HasPrefix(key, "@") {
		return "", fmt.Errorf("tmux: %q is not a user option; it must begin with '@'", key)
	}
	return c.run(ctx, "display-message", "-p", "-t", paneTarget(paneID), "-F", "#{"+key+"}")
}

// DefaultTerminal reports the server's default-terminal option — the TERM
// value tmux gives every pane process. A caller constructing a pane
// environment from scratch must use THIS value, never the service's own
// TERM: the service may run under `dumb` or nothing at all, and a TUI
// launched with that loses the colours, alternate screen, and control-key
// handling it needs.
func (c *Client) DefaultTerminal(ctx context.Context) (string, error) {
	// show-options alone will not start a server, and callers need this
	// value BEFORE the first session exists. start-server on a cold socket
	// applies the server config (run passes -f on every invocation) and
	// exit-empty off keeps the empty server alive; on a warm socket it is a
	// no-op.
	v, err := c.run(ctx, "start-server", ";", "show-options", "-g", "-v", "default-terminal")
	if err != nil {
		return "", fmt.Errorf("tmux: read default-terminal: %w", err)
	}
	if v == "" {
		return "", errors.New("tmux: default-terminal read back empty")
	}
	return v, nil
}

// RespawnPane restarts a dead pane with a new command, and records the new
// generation and marker.
//
// Native resume creates a NEW generation and new identity markers, which
// invalidates every outstanding controller and release fencing token. This
// function records them; enforcing the invalidation is the session layer's
// job.
//
// The setOptionArgs prefix below configures a warm server exactly as
// CreateSession does, but its history-limit element CANNOT change THIS
// pane's scrollback depth: respawn-pane reuses the existing pane, and tmux
// sizes a pane's history once at pane creation (measured on tmux 3.6a — a
// pane born at limit 2000 read 2000 after a respawn under limit 4321). A
// respawned pane keeps its original depth; the option in the prefix governs
// only panes created later on this server.
func (c *Client) RespawnPane(ctx context.Context, paneID string, spec SessionSpec) (*PaneInfo, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return nil, err
	}
	if len(spec.Argv) == 0 {
		return nil, errors.New("tmux: SessionSpec.Argv is required")
	}
	if spec.Generation < 1 {
		return nil, errors.New("tmux: SessionSpec.Generation must be >= 1")
	}
	if spec.Marker == "" {
		return nil, errors.New("tmux: SessionSpec.Marker is required")
	}
	partial, err := c.PaneInfoByID(ctx, paneID)
	if err != nil {
		return nil, fmt.Errorf("tmux: observe pane before respawn: %w", err)
	}
	if partial.Generation == spec.Generation || partial.Marker == spec.Marker {
		return nil, errors.New("tmux: respawn requires a new generation and marker")
	}
	fail := func(cause error) (*PaneInfo, error) {
		return partial, c.rollbackPartialSpawn(ctx, partial, cause)
	}
	// The launch marker travels with the process, not the pane it occupies.
	// It is read back through #{E:...}, which resolves in the SESSION
	// environment, so respawn-pane's own -e cannot republish it: that flag
	// reaches only the spawned process. Without the explicit set-environment a
	// respawned pane answers identity probes with its predecessor's marker.
	args := append(c.setOptionArgs(),
		"set-environment", "-t", partial.SessionName, launchMarkerEnv, spec.Marker,
		";", "respawn-pane", "-t", paneTarget(paneID))
	if spec.WorkDir != "" {
		args = append(args, "-c", spec.WorkDir)
	}
	for _, kv := range spec.Env {
		args = append(args, "-e", kv)
	}
	args = append(args, "-e", launchMarkerEnv+"="+spec.Marker)
	args = append(args, "--")
	args = append(args, spec.Argv...)
	args = append(args,
		";", "set-option", "-p", "-t", paneTarget(paneID), OptMarker, spec.Marker,
		";", "set-option", "-p", "-t", paneTarget(paneID), OptGeneration, strconv.Itoa(spec.Generation),
	)
	if c.testHooks != nil && c.testHooks.spawnArgs != nil {
		args = c.testHooks.spawnArgs("respawn", args)
	}

	out, runErr := c.run(ctx, args...)
	if c.testHooks != nil && c.testHooks.spawnRunResult != nil {
		_, runErr = c.testHooks.spawnRunResult("respawn", out, runErr)
	}
	if runErr == nil && c.testHooks != nil && c.testHooks.afterSpawnCommand != nil {
		runErr = c.testHooks.afterSpawnCommand("respawn")
	}
	if runErr != nil {
		observeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.timeout)
		observed, observeErr := c.PaneInfoByID(observeCtx, paneID)
		cancel()
		if observeErr != nil {
			return nil, errors.Join(runErr,
				fmt.Errorf("tmux: observe pane after respawn error: %w", observeErr))
		}
		observed = preserveProcessIdentity(partial, observed)
		if observed.SessionID != partial.SessionID || observed.PaneID != partial.PaneID {
			return nil, errors.Join(runErr, errors.New("tmux: pane changed while classifying respawn error"))
		}
		if observed.Marker == spec.Marker {
			partial = markSpawnOrigin(observed)
			return fail(runErr)
		}
		if observed.Generation == partial.Generation && observed.Marker == partial.Marker {
			if samePreRespawnState(partial, observed) {
				return nil, runErr
			}
			partial = markSpawnOrigin(observed)
			return fail(errors.Join(runErr,
				errors.New("tmux: respawn changed pane state before publishing its marker")))
		}
		return nil, errors.Join(runErr, fmt.Errorf(
			"tmux: respawn error left unrecognized pane identity gen=%d marker=%q",
			observed.Generation, observed.Marker))
	}
	if observed, observeErr := c.observeSpawnedPane(ctx, paneID); observeErr == nil {
		partial = markSpawnOrigin(observed)
	} else {
		return fail(fmt.Errorf("tmux: observe newly respawned pane: %w", observeErr))
	}
	if c.testHooks != nil && c.testHooks.afterSpawn != nil {
		if err := c.testHooks.afterSpawn("respawn"); err != nil {
			return fail(err)
		}
	}
	if partial.Generation != spec.Generation || partial.Marker != spec.Marker {
		return fail(fmt.Errorf("tmux: respawn identity did not publish: got gen=%d marker=%q",
			partial.Generation, partial.Marker))
	}
	return partial, nil
}

func samePreRespawnState(a, b *PaneInfo) bool {
	return a.SessionID == b.SessionID && a.PaneID == b.PaneID &&
		a.PID == b.PID && a.ProcessGroupID == b.ProcessGroupID &&
		a.StartTicks == b.StartTicks && a.Dead == b.Dead &&
		a.Generation == b.Generation && a.Marker == b.Marker &&
		equalOptionalInt(a.ExitStatus, b.ExitStatus) && equalOptionalInt(a.ExitSignal, b.ExitSignal)
}

func equalOptionalInt(a, b *int) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// maxBytesPerSend bounds how many bytes go in one send-keys invocation, since
// each byte becomes its own argv element.
const maxBytesPerSend = 512

// SendLiteral writes text to the pane as literal input.
//
// The text is hex-encoded and delivered with `send-keys -H`, NOT passed as a
// string to `send-keys -l`. That is not defensive styling — `-l -- ";"` is
// accepted, reports success, and delivers NOTHING, because tmux treats a
// standalone ";" argument as a command-list separator even after "--"
// (measured on 3.6a; ";" inside a larger token such as "x;y" is unaffected).
// A pasted message consisting of a single semicolon would therefore be
// silently swallowed while the caller was told it succeeded — silent loss of
// operator input, which is the one thing this product must never do.
//
// Hex encoding sidesteps tmux's argument parser entirely: every byte is
// delivered as itself. Nothing expands the text — no shell, no tmux key
// parsing — so pasted content cannot become a command.
//
// Long text is split across several invocations. A split is not atomic: a
// crash between chunks leaves partial input in the pane. That partial state
// is resolved by operator inspection of the native TUI; this layer does not
// paper over it.
func (c *Client) SendLiteral(ctx context.Context, paneID, text string) error {
	if err := ValidatePaneID(paneID); err != nil {
		return err
	}
	return c.sendBytes(ctx, paneID, []byte(text))
}

// sendBytes delivers raw bytes to a pane via hex-encoded send-keys.
func (c *Client) sendBytes(ctx context.Context, paneID string, data []byte) error {
	for start := 0; start < len(data); start += maxBytesPerSend {
		end := start + maxBytesPerSend
		if end > len(data) {
			end = len(data)
		}
		args := make([]string, 0, 5+(end-start))
		args = append(args, "send-keys", "-t", paneTarget(paneID), "-H", "--")
		for _, b := range data[start:end] {
			args = append(args, fmt.Sprintf("%02x", b))
		}
		// Report every attempt before the non-transactional tmux boundary.
		// An error or timeout cannot prove that bytes were not delivered, so
		// observing only acknowledged writes would make a zero-write claim
		// unsafely optimistic.
		chunk := append([]byte(nil), data[start:end]...)
		c.observeWrite(WriteObservation{PaneID: paneID, Data: chunk})
		if _, err := c.run(ctx, args...); err != nil {
			return err
		}
	}
	return nil
}

// SendKey sends one named key (for example "Enter" or "C-c"). The name is
// validated against an allowlist so caller data can never reach tmux's key
// parser.
func (c *Client) SendKey(ctx context.Context, paneID, key string) error {
	if err := ValidatePaneID(paneID); err != nil {
		return err
	}
	if !allowedKeys[key] {
		return fmt.Errorf("tmux: key %q is not in the permitted set", key)
	}
	c.observeWrite(WriteObservation{PaneID: paneID, Key: key})
	if _, err := c.run(ctx, "send-keys", "-t", paneTarget(paneID), key); err != nil {
		return err
	}
	return nil
}

// allowedKeys is the fixed set of named keys this client will send. Input
// text always goes through SendLiteral; this is only for control keys the
// product itself decides to send.
var allowedKeys = map[string]bool{
	"Enter": true, "Escape": true, "Tab": true, "BSpace": true,
	"Up": true, "Down": true, "Left": true, "Right": true,
	"C-c": true, "C-d": true, "C-u": true,
}

// Bracketed paste markers, sent as raw bytes so tmux does not interpret them.
var (
	pasteStart = []byte{0x1b, '[', '2', '0', '0', '~'}
	pasteEnd   = []byte{0x1b, '[', '2', '0', '1', '~'}
)

// SendBracketedPaste wraps text in bracketed-paste markers and sends it.
//
// The markers tell a TUI that the enclosed bytes are pasted content rather
// than typed keys, which is what stops a multi-line message from being
// interpreted as a sequence of submissions.
//
// Paste and submit are separate, non-transactional operations and either
// may fail; this function performs only the paste. A partial failure leaves
// the native TUI partially updated and is resolved by operator
// inspection; this layer does not paper over it.
func (c *Client) SendBracketedPaste(ctx context.Context, paneID, text string) error {
	if err := ValidatePaneID(paneID); err != nil {
		return err
	}
	if err := ValidatePasteBody(text); err != nil {
		return err
	}
	if err := c.sendBytes(ctx, paneID, pasteStart); err != nil {
		return fmt.Errorf("tmux: send paste-start marker: %w", err)
	}
	if err := c.SendLiteral(ctx, paneID, text); err != nil {
		return fmt.Errorf("tmux: send paste body: %w", err)
	}
	if err := c.sendBytes(ctx, paneID, pasteEnd); err != nil {
		return fmt.Errorf("tmux: send paste-end marker: %w", err)
	}
	return nil
}

// ValidatePasteBody refuses text that could escape bracketed paste.
//
// The paste body is bounded by ESC[200~ and ESC[201~. A body containing the
// terminating sequence ends paste mode early, after which the REMAINING bytes
// arrive as ordinary typed input — so a crafted paste body could close the
// paste and then deliver keystrokes the provider treats as a real
// submission, or as an answer to whatever prompt is on screen. Paste content
// is attacker-influenced whenever the operator pastes something they did not
// write.
//
// Rather than trying to neutralise escape sequences, this refuses any C0
// control character outside the set that legitimately appears in a message:
// newline, carriage return, and tab. That is a much smaller thing to get
// right, and there is no legitimate reason for pasted text to carry ESC.
func ValidatePasteBody(text string) error {
	for i, r := range text {
		switch r {
		case '\n', '\r', '\t':
			continue
		}
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf(
				"tmux: paste body contains control character %#x at byte %d; only "+
					"newline, carriage return, and tab are permitted (an embedded "+
					"ESC could terminate bracketed paste early and turn the rest of "+
					"the message into live keystrokes)", r, i)
		}
	}
	return nil
}

// CapturePane returns the pane's visible contents. It exists for tests and
// operator diagnostics only.
//
// Product code must never parse this to infer provider state — deciding
// whether a CLI is busy, idle, or at a prompt from its output is forbidden.
func (c *Client) CapturePane(ctx context.Context, paneID string) (string, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return "", err
	}
	return c.run(ctx, "capture-pane", "-p", "-t", paneTarget(paneID))
}

// CapturePaneHistory returns the pane's full scrollback, not just the
// visible screen. It exists for managed BATCH jobs (Taskmaster generation)
// whose recorded output is the product data the operator asked for. The
// prohibition above applies unchanged to provider panes: this must never be
// used to read an agent CLI's output.
func (c *Client) CapturePaneHistory(ctx context.Context, paneID string) (string, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return "", err
	}
	return c.run(ctx, "capture-pane", "-p", "-S", "-", "-t", paneTarget(paneID))
}

// CapturePaneTail returns the last `lines` lines of a pane's output,
// scrollback included. It exists so the session API can hand a dead pane's
// final output to the operator's recovery card: what the provider printed
// before it stopped is the operator's explanation, and Deck carries those
// bytes without reading them. The prohibition above is unchanged — product
// code never decides anything from this text, and a live provider pane is
// never captured through it.
func (c *Client) CapturePaneTail(ctx context.Context, paneID string, lines int) (string, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return "", err
	}
	if lines < 1 {
		lines = 1
	}
	return c.run(ctx, "capture-pane", "-p", "-S", "-"+strconv.Itoa(lines), "-E", "-", "-t", paneTarget(paneID))
}

// MaxCopyModeScrollLines bounds one scroll command. It exists so a caller
// relaying browser events can never turn one frame into an unbounded tmux
// repeat count.
const MaxCopyModeScrollLines = 500

// clampScrollLines normalizes a requested line count into [1, max].
func clampScrollLines(lines int) int {
	if lines < 1 {
		return 1
	}
	if lines > MaxCopyModeScrollLines {
		return MaxCopyModeScrollLines
	}
	return lines
}

// CopyModeScrollUp enters tmux copy-mode on the pane (a no-op when the pane
// is already in a mode) and scrolls the view up through the pane's history.
//
// This is the authority-invariant scrollback mechanism: tmux owns the pane
// and its history, so scrolling is a tmux view command, not a parallel
// browser-side buffer. Entry uses -e, so scrolling back down to the bottom
// returns the pane to the live TUI automatically.
func (c *Client) CopyModeScrollUp(ctx context.Context, paneID string, lines int) error {
	_, err := c.CopyModeScrollUpState(ctx, paneID, lines)
	return err
}

// CopyModeScrollUpState performs CopyModeScrollUp and returns tmux's
// post-command pane_in_mode state from the same tmux invocation.
func (c *Client) CopyModeScrollUpState(ctx context.Context, paneID string, lines int) (bool, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return false, err
	}
	n := clampScrollLines(lines)
	out, err := c.run(ctx,
		"copy-mode", "-e", "-t", paneTarget(paneID), ";",
		"send-keys", "-X", "-N", strconv.Itoa(n), "-t", paneTarget(paneID), "scroll-up", ";",
		"display-message", "-p", "-t", paneTarget(paneID), "#{pane_in_mode}")
	if err != nil {
		return false, err
	}
	return parsePaneInMode(out)
}

// CopyModeScrollDown scrolls the copy-mode view down. When the pane is not
// in a mode it does nothing: scrolling down past live output has no
// meaning, and `send-keys -X` outside a mode is an error, so the command is
// guarded server-side with tmux's own pane_in_mode flag (tmux-owned state —
// reading it is not provider-output inference).
//
// Reaching the bottom exits copy-mode when entry used -e (CopyModeScrollUp
// always does), which is what hands the wheel back to the TUI.
func (c *Client) CopyModeScrollDown(ctx context.Context, paneID string, lines int) error {
	_, err := c.CopyModeScrollDownState(ctx, paneID, lines)
	return err
}

// CopyModeScrollDownState performs CopyModeScrollDown and returns tmux's
// post-command pane_in_mode state from the same tmux invocation.
func (c *Client) CopyModeScrollDownState(ctx context.Context, paneID string, lines int) (bool, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return false, err
	}
	n := clampScrollLines(lines)
	// The embedded command string is composed ONLY of a validated pane id
	// (%N) and a clamped integer — no caller-supplied text reaches tmux's
	// command parser.
	out, err := c.run(ctx,
		"if-shell", "-F", "-t", paneTarget(paneID), "#{pane_in_mode}",
		fmt.Sprintf("send-keys -X -N %d -t %s scroll-down", n, paneID), ";",
		"display-message", "-p", "-t", paneTarget(paneID), "#{pane_in_mode}")
	if err != nil {
		return false, err
	}
	return parsePaneInMode(out)
}

// ExitCopyMode leaves the pane's tmux view mode, if one is open, so
// subsequent input reaches the application instead of the mode's key table.
// It is a guarded no-op when the pane is not in a mode — `send-keys -X`
// outside a mode is an error, and racing an operator's own exit must not
// fail a write. The guard reads tmux's own pane_in_mode flag server-side,
// atomically with the cancel.
func (c *Client) ExitCopyMode(ctx context.Context, paneID string) error {
	_, err := c.ExitCopyModeState(ctx, paneID)
	return err
}

// ExitCopyModeState performs ExitCopyMode and returns tmux's post-command
// pane_in_mode state from the same tmux invocation.
func (c *Client) ExitCopyModeState(ctx context.Context, paneID string) (bool, error) {
	if err := ValidatePaneID(paneID); err != nil {
		return false, err
	}
	// The embedded command string is composed ONLY of a validated pane id
	// (%N) — no caller-supplied text reaches tmux's command parser.
	out, err := c.run(ctx,
		"if-shell", "-F", "-t", paneTarget(paneID), "#{pane_in_mode}",
		fmt.Sprintf("send-keys -X -t %s cancel", paneID), ";",
		"display-message", "-p", "-t", paneTarget(paneID), "#{pane_in_mode}")
	if err != nil {
		return false, err
	}
	return parsePaneInMode(out)
}

func parsePaneInMode(out string) (bool, error) {
	switch strings.TrimSpace(out) {
	case "0":
		return false, nil
	case "1":
		return true, nil
	default:
		return false, fmt.Errorf("tmux: unexpected pane_in_mode value %q", out)
	}
}

// KillServer terminates the tmux server on this socket, and every session with
// it. Intended for test cleanup and operator recovery.
func (c *Client) KillServer(ctx context.Context) error {
	_, err := c.run(ctx, "kill-server")
	if err != nil && (errors.Is(err, ErrNoSession) || errors.Is(err, ErrNoServer)) {
		return nil
	}
	return err
}
