// Package boot owns the startup sequence: the strictly ordered path from a
// validated configuration to a ready backend, and the only code permitted to
// flip readiness.
//
// Order matters and is load-bearing:
//
//  1. the exclusive backend lock — before anything touches the database or
//     the tmux namespace, because a second backend must fail fast and
//     visibly;
//  2. the control database, migrated and verified writable;
//  3. the tmux client over the dedicated socket, with the ownership and
//     permission checks that fail readiness on mismatch;
//  4. provider descriptors from configuration — an absent provider logs a
//     warning and stays unavailable, it never fails boot;
//  5. the reconciler's first pass, which resolves whatever a previous life
//     left behind: rows whose panes died with a host restart become
//     interrupted, orphan processes park, corpses record their evidence.
//
// Only after all of that does SetReady(true) run, and the readiness endpoint
// keeps re-verifying the database, the tmux socket security, and the
// reconciler's recency on every poll.
//
// Shutdown drains HTTP, releases the lock, and closes the database. It
// NEVER touches a tmux session or a provider process: killing this service
// must leave every agent session running.
package boot

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/noisefloor-oss/deck/internal/apppreview"
	"github.com/noisefloor-oss/deck/internal/audit"
	"github.com/noisefloor-oss/deck/internal/auth"
	"github.com/noisefloor-oss/deck/internal/capacity"
	"github.com/noisefloor-oss/deck/internal/chats"
	"github.com/noisefloor-oss/deck/internal/config"
	"github.com/noisefloor-oss/deck/internal/db"
	"github.com/noisefloor-oss/deck/internal/experiment"
	"github.com/noisefloor-oss/deck/internal/githubconnect"
	"github.com/noisefloor-oss/deck/internal/githubrepos"
	"github.com/noisefloor-oss/deck/internal/harnesslogin"
	"github.com/noisefloor-oss/deck/internal/hookcapture"
	"github.com/noisefloor-oss/deck/internal/inputgate"
	"github.com/noisefloor-oss/deck/internal/lease"
	"github.com/noisefloor-oss/deck/internal/lock"
	"github.com/noisefloor-oss/deck/internal/project"
	"github.com/noisefloor-oss/deck/internal/provider"
	"github.com/noisefloor-oss/deck/internal/reconciler"
	"github.com/noisefloor-oss/deck/internal/sealedstate"
	"github.com/noisefloor-oss/deck/internal/server"
	"github.com/noisefloor-oss/deck/internal/server/webassets"
	"github.com/noisefloor-oss/deck/internal/session"
	"github.com/noisefloor-oss/deck/internal/settings"
	"github.com/noisefloor-oss/deck/internal/tasks"
	"github.com/noisefloor-oss/deck/internal/terminal"
	"github.com/noisefloor-oss/deck/internal/tmux"
)

// Handles are the wired subsystems of a booted backend.
type Handles struct {
	Lock          *lock.ExclusiveLock
	DB            *db.DB
	Tmux          *tmux.Client
	Providers     map[provider.Name]provider.Descriptor
	Sessions      *session.Repository
	Manager       *session.Manager
	Reconciler    *reconciler.Reconciler
	Auth          *auth.Handler
	Leases        *lease.Manager
	Terminal      *terminal.Proxy
	Taskmaster    *tasks.Runner
	HarnessLogin  *harnesslogin.LocalServer
	GitHubConnect *githubconnect.Manager
	// Projects owns the clone jobs, which Close stops.
	Projects         *project.Handler
	Server           *server.Server
	Preview          *apppreview.Gateway
	PreviewRegistry  *apppreview.Registry
	previewMetadata  *apppreview.MetadataServer
	previewHTTP      *http.Server
	previewListeners []net.Listener

	log      zerolog.Logger
	interval time.Duration
}

type upOptions struct {
	buildID string
	// sealedFacts overrides the kernel facts the encrypted-state check reads;
	// tests use it to boot against a fixture layout.
	sealedFacts func(reportPath string) (sealedstate.Facts, error)
}

type UpOption func(*upOptions)

// WithBuildID binds the browser document and authenticated build endpoint to
// the identity of the binary serving them.
func WithBuildID(buildID string) UpOption {
	return func(options *upOptions) { options.buildID = buildID }
}

// WithSealedFacts supplies the encrypted-state check's inputs instead of
// reading them from /proc and /sys.
func WithSealedFacts(read func(reportPath string) (sealedstate.Facts, error)) UpOption {
	return func(options *upOptions) { options.sealedFacts = read }
}

// Up runs the startup sequence against an already-validated configuration
// and returns a ready backend. On any failure it unwinds what it opened and
// returns the cause; nothing half-booted stays behind.
func Up(ctx context.Context, cfg *config.Config, log zerolog.Logger, opts ...UpOption) (*Handles, error) {
	options := upOptions{buildID: "dev"}
	for _, option := range opts {
		option(&options)
	}
	h := &Handles{log: log, interval: cfg.Reconciler.Interval.Std()}
	booted := false
	defer func() {
		if !booted {
			h.Close()
		}
	}()
	var err error

	// 0. Encrypted state, before any directory is created or file written.
	// Refusing here keeps a plaintext store empty; a warning here is the
	// operator's notice that the same layout would be refused once required.
	if err := verifySealedState(cfg, options.sealedFacts, log); err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}

	// Fresh data directories are created private; existing ones are left
	// untouched — the tmux client refuses an insecure directory itself. The
	// lock path is listed separately: it defaults beside the database but is
	// independently configurable, and a boot must not fail confusingly just
	// because the operator pointed it somewhere fresh.
	for _, dir := range []string{
		filepath.Dir(cfg.Database.Path),
		filepath.Dir(cfg.Database.LockPath),
		filepath.Dir(cfg.Tmux.SocketPath),
	} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("boot: create %s: %w", dir, err)
		}
	}

	// 1. Exclusivity before any shared state is touched.
	h.Lock, err = lock.Acquire(cfg.Database.LockPath)
	if err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}
	existingInstallation, err := installationStateExists(cfg.Database.Path)
	if err != nil {
		return nil, fmt.Errorf("boot: inspect installation state: %w", err)
	}
	if err := auth.EnsureInstallationMode(auth.InstallationModePath(cfg.Database.Path), cfg.Auth.Mode, existingInstallation); err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}
	if cfg.Auth.Mode == "password" {
		statePath := filepath.Join(filepath.Dir(cfg.Database.Path), "auth-state.json")
		bootstrap, bootstrapErr := auth.EnsureBootstrapState(statePath, cfg.Auth.PasswordHash)
		if bootstrapErr != nil {
			return nil, fmt.Errorf("boot: %w", bootstrapErr)
		}
		cfg.Auth.PasswordHash = string(bootstrap.State.PasswordHash)
		cfg.Auth.SessionSecret = string(bootstrap.State.SessionSecret)
		if bootstrap.GeneratedPassword != "" {
			log.Warn().Str("bootstrap_password", bootstrap.GeneratedPassword).
				Msg("one-time bootstrap password; save it now because it will not be shown again")
		}
	}

	// 2. Control database: open migrates; then prove writability now rather
	// than at the first session write.
	h.DB, err = db.Open(ctx, db.Config{
		Path:        cfg.Database.Path,
		BusyTimeout: cfg.Database.BusyTimeout.Std(),
	})
	if err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}
	if err := h.DB.VerifyWritable(ctx); err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}

	// 3. The dedicated tmux namespace, security-verified.
	h.Tmux, err = tmux.NewClient(tmux.Config{SocketPath: cfg.Tmux.SocketPath,
		Timeout: 10 * time.Second, ScrollbackLines: cfg.Tmux.ScrollbackLines})
	if err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}
	if err := h.Tmux.VerifySecurity(); err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}

	// 4. Providers: configured and constructible means available for launch;
	// anything else is logged and unavailable, never fatal.
	h.Providers = buildProviders(cfg, log)

	h.Sessions = session.NewRepository(h.DB)
	h.Manager = session.NewManager(h.Sessions, h.Tmux, h.Providers, cfg.Tmux.SessionPrefix)
	projects := project.NewRepository(h.DB)
	// The roster registration carries the committed project scope: resolved
	// here through the projects repository, since the a2a helper never reads
	// the control database.
	h.Manager.SetProjectNameResolver(func(ctx context.Context, projectID string) (string, error) {
		p, err := projects.GetIncludingRemoved(ctx, projectID)
		if err != nil {
			return "", err
		}
		return p.Name, nil
	})
	h.Manager.SetDisplayNameRegistrar(session.A2ADisplayNameRegistrar(cfg.Chats.Executable, log))
	if err := h.Manager.SetTemporaryRoot("/tmp"); err != nil {
		return nil, fmt.Errorf("boot: provider temporary storage: %w", err)
	}
	h.Leases = lease.NewManager(h.DB)
	gate := inputgate.New()
	consoleSettings := settings.NewRepository(h.DB)
	h.Manager.SetSettings(consoleSettings)
	h.Manager.SetResumeDeps(h.Leases, gate,
		func(ctx context.Context, projectID string) (string, error) {
			p, err := projects.GetIncludingRemoved(ctx, projectID)
			if err != nil {
				return "", err
			}
			return p.CanonicalPath, nil
		})
	experimentCapability := ""
	if cfg.Experiments.UnconfinedCapacityRouting {
		var err error
		experimentCapability, err = experiment.NewControlCapability()
		if err != nil {
			return nil, fmt.Errorf("boot: create unconfined experiment capability: %w", err)
		}
		h.Manager.SetUnconfinedCapacityRouting(cfg.Server.LoopbackBase(), experimentCapability)
		log.Warn().Msg("unconfined capacity-routing experiment enabled")
	}

	// Bearer hashes and exact launch fences are durable before spawn. A service
	// restart reconstructs only this stateless envelope; a pending grant stays
	// acceptable while its generation is the live running row, and otherwise
	// until this absolute expiry - the window bounds a launch that died, not
	// the operator's first submission.
	hookCaptures, err := hookcapture.NewService(h.Sessions, time.Hour)
	if err != nil {
		return nil, fmt.Errorf("boot: identity capture: %w", err)
	}
	h.Manager.SetHookCaptureDeps(hookCaptures, cfg.Server.LoopbackBase())
	h.Manager.SetHookCaptureSocket(cfg.Server.UnixSocket)
	if err := hookCaptures.Sweep(ctx); err != nil {
		return nil, fmt.Errorf("boot: expire identity captures: %w", err)
	}
	login := h.startHarnessLogin(ctx, cfg)
	if err := h.Manager.ConvergeStopAttempts(ctx); err != nil {
		return nil, fmt.Errorf("boot: stop convergence: %w", err)
	}
	if err := h.Manager.ConvergeRemovalAttempts(ctx); err != nil {
		return nil, fmt.Errorf("boot: removal convergence: %w", err)
	}
	// A crash may have occurred after durable candidate admission or spawn.
	// Resolve those exact candidates before the generic capture-expiry and pane
	// inventories can mistake them for sources or orphans. This convergence
	// never spawns a second candidate.
	if err := h.Manager.ConvergeRecoveryCandidates(ctx); err != nil {
		return nil, fmt.Errorf("boot: recovery-candidate convergence: %w", err)
	}
	// Legacy needs_attention rows are a frozen input from earlier releases.
	// Converge them before the generic pass can restore an exact-live row while
	// preserving its obsolete retry counter. An exact live tuple restores and
	// re-arms running, a dead pane records exit evidence, and every other row
	// becomes honest interrupted metadata. This pass never launches, signals,
	// adopts, or writes to a pane (ADR-0005).
	if err := h.Manager.ConvergeLegacyRows(ctx); err != nil {
		return nil, fmt.Errorf("boot: legacy row convergence: %w", err)
	}

	// 5. The startup reconciliation pass: the moment a previous life's
	// ordinary claims meet observed reality. Capture expiry and legacy
	// convergence above are prerequisites for safe generic classification.
	h.Reconciler = reconciler.New(h.Sessions, h.Tmux, h.interval)
	report, err := h.Reconciler.RunOnce(ctx)
	if err != nil {
		return nil, fmt.Errorf("boot: startup reconciliation: %w", err)
	}
	// Legacy rows and ordinary lost generations receive their single durable
	// automatic opportunity before the backend can report ready or return the
	// first session response.
	if err := h.Manager.AutoResumeSweep(ctx); err != nil {
		return nil, fmt.Errorf("boot: startup automatic recovery: %w", err)
	}
	if err := h.Manager.SweepTemporaryDirs(ctx); err != nil {
		return nil, fmt.Errorf("boot: provider temporary-directory convergence: %w", err)
	}
	if err := h.Manager.RestoreDisplayNames(ctx); err != nil {
		log.Warn().Err(err).Msg("could not restore agent roster names")
	}
	log.Info().
		Int("sessions", report.SessionsActive).
		Int("panes", report.PanesObserved).
		Int("discrepancies", report.Discrepancies).
		Bool("server_down", report.ServerDown).
		Msg("startup reconciliation complete")

	// 6. Authentication at the web boundary. Constructed from
	// config, which already refused a partially configured OIDC login
	// fail-closed; New performs no network request (doc.go).
	h.Auth, err = auth.New(authConfig(cfg), log)
	if err != nil {
		return nil, fmt.Errorf("boot: %w", err)
	}

	// 8. The HTTP layer.
	h.Server = server.New(server.Config{
		Bind:              cfg.Server.Bind,
		UnixSocket:        cfg.Server.UnixSocket,
		GatewayUID:        cfg.Server.GatewayUID,
		AllowedOrigins:    cfg.Server.AllowedOrigins,
		ProtectBrowserAPI: cfg.ProjectPreviews.Loopback || cfg.ProjectPreviews.Bind != "" || cfg.Server.UnixSocket != "",
	}, log, h.readinessChecks())
	// The login ceremony is public; everything the API and WebSocket tasks
	// mount goes behind h.Auth.Require. Process liveness and readiness stay
	// public because a supervisor cannot authenticate.
	h.Auth.Mount(h.Server.Handle)
	if cfg.Server.UnixSocket != "" {
		h.Server.Handle("POST /api/internal/workspace/prepare-lock", h.Auth.Require(workspaceLockHandler(h.Manager.PrepareWorkspaceLock)))
	}
	loginTransport := harnesslogin.NewHandler(login, cfg.Server.AllowedOrigins)
	if cfg.Auth.Mode == "trusted_proxy" && cfg.HarnessLogin.TrustedProxyIdentity != "" {
		loginTransport.Operator = auth.ProxyPrincipal(cfg.HarnessLogin.TrustedProxyIdentity)
	}
	loginHandler := h.Auth.Require(loginTransport)
	h.Server.Handle("GET /api/harness-login", loginHandler)
	h.Server.Handle("POST /api/harness-login", loginHandler)
	h.Server.Handle("GET /api/build", h.Auth.Require(server.BuildHandler(options.buildID)))
	// What the picker may offer. Deck ships in more than one image, so the
	// browser cannot know the harness list from the bundle it was served —
	// only the process that resolved the executables knows it.
	h.Server.Handle("GET /api/providers", h.Auth.Require(server.ProvidersHandler(h.Providers)))

	// The terminal attachment: authenticated, lease-fenced, origin-checked.
	// The one serialized write gate sits in the terminal proxy.
	h.Terminal = terminal.New(h.Tmux, h.Sessions, h.Leases,
		gate, cfg.Server.AllowedOrigins, log)
	h.Server.Handle("GET /api/sessions/{id}/terminal",
		h.Auth.Require(http.HandlerFunc(h.Terminal.Handle)))
	// GitHub authentication can run before a project exists. Its fixed-purpose
	// terminal shares workspace admission while using a separate tmux namespace.
	githubTmux, err := tmux.NewClient(tmux.Config{
		SocketPath: filepath.Join(filepath.Dir(cfg.Tmux.SocketPath), "github-connect", "tmux.sock"),
		Timeout:    10 * time.Second, ScrollbackLines: cfg.Tmux.ScrollbackLines,
	})
	if err != nil {
		return nil, fmt.Errorf("initialize GitHub connection terminal: %w", err)
	}
	h.GitHubConnect = githubconnect.NewManager(githubTmux, gate, log)
	githubconnect.NewHandler(h.GitHubConnect, h.GitHubConnect.NewProxy(cfg.Server.AllowedOrigins, log), cfg.Server.AllowedOrigins).Mount(h.Server.Handle, h.Auth.Require)
	server.NewDiagnostics(h.Sessions, h.Manager, h.Reconciler, h.Leases,
		h.Terminal, log).Mount(h.Server.Handle, h.Auth.Require)

	// The retired composer API: submit/release/cancel no longer exist —
	// Deck owns no durable input surface. The routes stay mounted so stale
	// callers get a definitive 410 Gone rather than a misleading 404 or an
	// accidental fall-through; the web lane's own client is the first to
	// drop them.
	terminal.NewGoneHandler().Mount(h.Server.Handle, h.Auth.Require)

	// The project registry: registration validates against the configured
	// allowlist on every create.
	// Console settings: runtime operator choices the UI writes, read at
	// each session launch.
	settings.NewHandler(consoleSettings, log).Mount(h.Server.Handle, h.Auth.Require)

	githubRepositories := githubrepos.NewService()
	githubrepos.NewHandler(githubRepositories).Mount(h.Server.Handle, h.Auth.Require)
	projectHandler := project.NewHandler(projects, cfg.Projects.AllowedRoots, h.Manager, log)
	// A committed project rename refreshes the roster scope of the project's
	// active sessions; the refresh is best-effort and never fails the rename.
	projectHandler.OnRenamed(func(ctx context.Context, projectID string) {
		if err := h.Manager.SyncProjectRegistrations(ctx, projectID); err != nil {
			log.Warn().Err(err).Msg("could not refresh agent roster project metadata")
		}
	})
	projectHandler.SetGitHubRepositoryResolver(func(ctx context.Context, account string, id int64) (string, error) {
		result := githubRepositories.Repository(ctx, account, id)
		if result.Outcome != "ok" || result.Repository == nil {
			return "", fmt.Errorf("GitHub access could not be confirmed (%s). Refresh the repository list before importing", result.Outcome)
		}
		return result.Repository.CloneURL, nil
	})
	projectHandler.Mount(h.Server.Handle, h.Auth.Require)
	projectHandler.MountFiles(h.Server.Handle, h.Auth.Require)
	h.Projects = projectHandler
	if err := h.mountProjectPreviews(cfg, projects); err != nil {
		return nil, err
	}

	// The experiment API is outside browser authentication. It is absent by
	// default and requires the per-process capability inherited only by
	// sessions this Deck launches, so a reverse proxy cannot turn loopback
	// into remote authority.
	experiment.New(cfg.Experiments.UnconfinedCapacityRouting, experimentCapability, capacity.New(h.Providers),
		h.Providers, h.Manager, projects, log).Mount(h.Server.Handle)

	// The Taskmaster read side: canonical task state and PRD files, read
	// fresh per request from the projects' own files. The
	// generation runner rides the same handler: fixed argv in managed tmux
	// sessions, serialized per project by the database, and reconciled
	// against observed tmux state at startup so a previous life's running
	// rows reach their honest terminal state.
	taskmasterRuns := tasks.NewRunsRepository(h.DB)
	h.Taskmaster = tasks.NewRunner(taskmasterRuns, projects, h.Tmux,
		cfg.Taskmaster.Executable, cfg.Tmux.SessionPrefix, log)
	if err := h.Taskmaster.Reconcile(ctx); err != nil {
		return nil, fmt.Errorf("boot: taskmaster reconciliation: %w", err)
	}
	tasks.NewHandler(projects, cfg.Taskmaster.Executable, log).WithRunner(h.Taskmaster).
		Mount(h.Server.Handle, h.Auth.Require)

	// The audit trail: the typed taxonomy every
	// repository writes through, and the operator's ordered read of it.
	audit.NewHandler(audit.NewRepository(h.DB), log).
		Mount(h.Server.Handle, h.Auth.Require)

	// Automatic recovery runs after every later reconciliation pass. Manual
	// recovery is the explicit nonce-bound session endpoint mounted below.
	h.Reconciler.SetRecovery(h.Manager)
	// Cadence-loop pass failures (including recovery-sweep errors) are
	// logged, never silently discarded.
	h.Reconciler.SetLogger(log)
	session.NewHandler(h.Manager, h.Sessions, projects, log).
		Mount(h.Server.Handle, h.Auth.Require)

	// The chat ledger read side (ADR-0009): what the console knows about
	// the chats a session's agent is in, read through the a2a client.
	chats.NewHandler(h.Sessions, cfg.Chats.Executable, log).
		Mount(h.Server.Handle, h.Auth.Require)

	// The retrieved-identity capture: each retrieved provider launch
	// registers a per-launch, one-shot token; the provisioned SessionStart
	// hook POSTs the native id to the token URL. The route is deliberately
	// OUTSIDE the session-auth middleware — the hook carries no session
	// credential; the unguessable one-shot token IS the credential and the
	// correlation.
	//
	// An expired capture is RECORDED without changing lifecycle status
	// without consuming a recovery attempt. A live session stays usable
	// instead of being withdrawn to report something the operator cannot
	// repair. A detached row stays detached, and its next death
	// classification sees the durable loss marker rather than mistaking NULL
	// identity for proof that the session was empty.
	h.Server.Handle("POST /api/hooks/capture", hookCaptures.Handle())
	go func() {
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				sweepCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				if err := hookCaptures.Sweep(sweepCtx); err != nil {
					log.Warn().Err(err).Msg("identity capture expiry sweep failed")
				}
				if err := h.Manager.ConvergeRecoveryCandidates(sweepCtx); err != nil {
					log.Warn().Err(err).Msg("recovery candidate convergence failed")
				}
				cancel()
			}
		}
	}()

	// The compiled browser shell is public so an unauthenticated browser can
	// render its Google sign-in action. More-specific API/auth/health routes
	// stay authoritative in the shared ServeMux; unknown reserved paths are
	// explicitly rejected by StaticHandler rather than receiving index.html.
	h.Server.Handle("GET /", server.StaticHandler(webassets.FS(), options.buildID))

	// The font-substitution bench (default-off experiment): a separate page
	// in the same build, served only when the flag is on and always behind
	// the browser authentication. StaticHandler refuses bench.html
	// unconditionally, so with the flag off the path 404s like any unknown
	// one instead of hinting at a gated surface.
	if cfg.Experiments.FontBench {
		h.Server.Handle("GET /bench.html", h.Auth.Require(server.FontBenchHandler(webassets.FS())))
		log.Warn().Msg("font-bench experiment enabled")
	}

	// The dev preview (default-off experiment): a reverse proxy onto a Vite
	// dev server the operator starts by hand, so a frontend change is
	// visible on a running deployment without rebuilding the embedded
	// assets and replacing the container — which would terminate every tmux
	// session and provider. It is same-origin with the app because the
	// session cookie is host-only and Path=/; a second hostname would
	// receive neither it nor the OIDC transaction cookie. Auth.Require is
	// not optional here: the dev server serves project source and executes
	// it with the operator's authority.
	if cfg.Experiments.DevPreview {
		upstream, err := url.Parse("http://" + cfg.Experiments.DevPreviewUpstream)
		if err != nil {
			return nil, fmt.Errorf("dev-preview upstream: %w", err)
		}
		// Methods are explicit. A methodless subtree pattern next to the
		// "GET /" shell is a ServeMux conflict panic ("matches more methods
		// than GET /, but has a more specific path pattern"), so the route
		// names what a dev server actually receives: module and asset GETs,
		// the HMR upgrade (also a GET), HEADs, and the POST/OPTIONS a Vite
		// plugin middleware may add.
		preview := h.Auth.Require(server.DevPreviewHandler(upstream))
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodOptions} {
			h.Server.Handle(method+" "+server.DevPreviewPrefix, preview)
		}
		log.Warn().Str("upstream", cfg.Experiments.DevPreviewUpstream).
			Msg("dev-preview experiment enabled: /__dev/ proxies a local dev server with operator authority")
	}

	// 9. Ready — every readiness precondition above holds.
	h.Server.SetReady(true)
	booted = true
	return h, nil
}

func installationStateExists(databasePath string) (bool, error) {
	for _, path := range []string{databasePath, filepath.Join(filepath.Dir(databasePath), "auth-state.json")} {
		if _, err := os.Lstat(path); err == nil {
			return true, nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
	}
	return false, nil
}

// authConfig maps the validated application config onto the auth package's
// input. SessionSecret becomes bytes; the rest is a straight copy.
func authConfig(cfg *config.Config) auth.Config {
	return auth.Config{
		Mode:           cfg.Auth.Mode,
		ClientID:       cfg.Auth.Google.ClientID,
		ClientSecret:   cfg.Auth.Google.ClientSecret,
		RedirectURL:    cfg.Auth.Google.RedirectURL,
		AllowedEmail:   cfg.Auth.Google.AllowedEmail,
		SessionSecret:  []byte(cfg.Auth.SessionSecret),
		PasswordHash:   []byte(cfg.Auth.PasswordHash),
		SecureCookies:  cfg.Auth.SecureCookies,
		ProxyAddresses: cfg.Auth.TrustedProxy.Addresses,
		IdentityHeader: cfg.Auth.TrustedProxy.IdentityHeader,
	}
}

// Run serves HTTP and keeps the reconciler's cadence until ctx ends. It
// returns when the server has drained.
func (h *Handles) Run(ctx context.Context) error {
	rctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go h.Reconciler.Run(rctx)
	h.Taskmaster.Start(rctx)
	if h.previewHTTP == nil {
		return h.Server.Run(ctx)
	}
	errs := make(chan error, 1+len(h.previewListeners))
	go func() { errs <- h.Server.Run(rctx) }()
	for _, listener := range h.previewListeners {
		go func() { errs <- h.previewHTTP.Serve(listener) }()
	}
	var result error
	remaining := 1 + len(h.previewListeners)
	select {
	case result = <-errs:
		remaining--
	case <-ctx.Done():
	}
	cancel()
	if h.previewMetadata != nil {
		_ = h.previewMetadata.Close()
	}
	_ = h.Preview.Close()
	shutdown, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	if err := h.previewHTTP.Shutdown(shutdown); err != nil {
		_ = h.previewHTTP.Close()
		if result == nil {
			result = err
		}
	}
	for ; remaining > 0; remaining-- {
		if err := <-errs; err != nil && !errors.Is(err, http.ErrServerClosed) && result == nil {
			result = err
		}
	}
	if errors.Is(result, http.ErrServerClosed) {
		return nil
	}
	return result
}

// Close releases what Up opened, in reverse order. It never touches tmux
// sessions or provider processes.
func (h *Handles) Close() {
	if h.GitHubConnect != nil {
		h.GitHubConnect.Close()
		h.GitHubConnect = nil
	}
	if h.previewMetadata != nil {
		_ = h.previewMetadata.Close()
	}
	if h.Preview != nil {
		_ = h.Preview.Close()
	}
	if h.previewHTTP != nil {
		_ = h.previewHTTP.Close()
	}
	for _, listener := range h.previewListeners {
		_ = listener.Close()
	}
	if h.HarnessLogin != nil {
		_ = h.HarnessLogin.Close()
		h.HarnessLogin = nil
	}
	if h.Projects != nil {
		// Running clones stop with the process; what they wrote stays on
		// disk for the next start to report as it finds it.
		h.Projects.Shutdown()
		h.Projects = nil
	}
	if h.Taskmaster != nil {
		h.Taskmaster.Shutdown()
		h.Taskmaster = nil
	}
	if h.DB != nil {
		if err := h.DB.Close(); err != nil {
			h.log.Warn().Err(err).Msg("closing database")
		}
		h.DB = nil
	}
	if h.Lock != nil {
		if err := h.Lock.Release(); err != nil {
			h.log.Warn().Err(err).Msg("releasing backend lock")
		}
		h.Lock = nil
	}
}

// reconcilerRecent fails readiness when the reconciler has stopped making
// passes: a stale running record is a surfaced fault, and a wedged
// reconciler is how one would hide. Four intervals of slack
// tolerate a slow pass without masking a dead loop.
func (h *Handles) reconcilerRecent(context.Context) error {
	last := h.Reconciler.LastPass()
	if last.IsZero() {
		return fmt.Errorf("no reconciliation pass has completed")
	}
	if age := time.Since(last); age > 4*h.interval {
		return fmt.Errorf("last reconciliation pass was %s ago (interval %s)", age.Round(time.Millisecond), h.interval)
	}
	return nil
}

func (h *Handles) readinessChecks() []server.Check {
	checks := []server.Check{
		{Name: "backend-lock", Probe: func(context.Context) error {
			if !h.Lock.IsHeld() {
				return fmt.Errorf("exclusive backend lock is not held")
			}
			return nil
		}},
		{Name: "database", Probe: h.DB.VerifyWritable},
		{Name: "tmux-security", Probe: func(context.Context) error { return h.Tmux.VerifySecurity() }},
		{Name: "tmux-access", Probe: func(ctx context.Context) error {
			_, err := h.Tmux.ListSessions(ctx)
			if errors.Is(err, tmux.ErrNoServer) {
				// tmux exits normally when its last session closes. An empty
				// private namespace is therefore accessible without a server.
				return nil
			}
			return err
		}},
		{Name: "reconciler-recency", Probe: h.reconcilerRecent},
	}

	return checks
}

// buildProviders constructs a descriptor per configured provider. A
// provider that is unconfigured, unconstructible, or unavailable is logged
// and omitted — launch refuses unknown providers loudly, which is the
// availability contract, not a boot failure.
func buildProviders(cfg *config.Config, log zerolog.Logger) map[provider.Name]provider.Descriptor {
	out := make(map[provider.Name]provider.Descriptor, 16)
	add := func(name provider.Name, build func() (provider.Descriptor, error), execPath string) {
		if execPath == "" {
			log.Warn().Str("provider", string(name)).Msg("provider not configured; unavailable")
			return
		}
		d, err := build()
		if err != nil {
			log.Warn().Str("provider", string(name)).Err(err).Msg("provider not constructible; unavailable")
			return
		}
		if err := d.Availability(); err != nil {
			log.Warn().Str("provider", string(name)).Err(err).Msg("provider unavailable")
		}
		out[name] = d
	}
	add(provider.Claude, func() (provider.Descriptor, error) {
		return provider.NewClaude(cfg.Providers.Claude.Executable)
	}, cfg.Providers.Claude.Executable)
	add(provider.Cline, func() (provider.Descriptor, error) {
		return provider.NewCline(cfg.Providers.Cline.Executable)
	}, cfg.Providers.Cline.Executable)
	add(provider.CommandCode, func() (provider.Descriptor, error) {
		return provider.NewCommandCode(cfg.Providers.CommandCode.Executable, cfg.Providers.CommandCode.HookConfig, cfg.Providers.CommandCode.HookReceiver)
	}, cfg.Providers.CommandCode.Executable)
	add(provider.Codex, func() (provider.Descriptor, error) {
		return provider.NewCodex(cfg.Providers.Codex.Executable, cfg.Providers.Codex.HookConfig, cfg.Providers.Codex.HookReceiver)
	}, cfg.Providers.Codex.Executable)
	add(provider.Cursor, func() (provider.Descriptor, error) {
		return provider.NewCursor(cfg.Providers.Cursor.Executable)
	}, cfg.Providers.Cursor.Executable)
	add(provider.Devin, func() (provider.Descriptor, error) {
		return provider.NewDevin(cfg.Providers.Devin.Executable, cfg.Providers.Devin.HookConfig, cfg.Providers.Devin.HookReceiver)
	}, cfg.Providers.Devin.Executable)
	add(provider.Grok, func() (provider.Descriptor, error) {
		return provider.NewGrok(cfg.Providers.Grok.Executable)
	}, cfg.Providers.Grok.Executable)
	add(provider.Kimi, func() (provider.Descriptor, error) {
		return provider.NewKimi(cfg.Providers.Kimi.Executable, cfg.Providers.Kimi.HookConfig, cfg.Providers.Kimi.HookReceiver)
	}, cfg.Providers.Kimi.Executable)
	add(provider.Kilo, func() (provider.Descriptor, error) {
		return provider.NewKilo(cfg.Providers.Kilo.Executable, cfg.Providers.Kilo.HookConfig)
	}, cfg.Providers.Kilo.Executable)
	add(provider.Mimo, func() (provider.Descriptor, error) {
		return provider.NewMimo(cfg.Providers.Mimo.Executable)
	}, cfg.Providers.Mimo.Executable)
	add(provider.Opencode, func() (provider.Descriptor, error) {
		return provider.NewOpencode(cfg.Providers.Opencode.Executable, cfg.Providers.Opencode.HookConfig)
	}, cfg.Providers.Opencode.Executable)
	add(provider.Omp, func() (provider.Descriptor, error) {
		return provider.NewOmp(cfg.Providers.Omp.Executable, cfg.Providers.Omp.HookConfig)
	}, cfg.Providers.Omp.Executable)
	add(provider.Pi, func() (provider.Descriptor, error) {
		return provider.NewPi(cfg.Providers.Pi.Executable, cfg.Providers.Pi.HookConfig)
	}, cfg.Providers.Pi.Executable)
	add(provider.Qoder, func() (provider.Descriptor, error) {
		return provider.NewQoder(cfg.Providers.Qoder.Executable)
	}, cfg.Providers.Qoder.Executable)
	add(provider.Qwen, func() (provider.Descriptor, error) {
		return provider.NewQwen(cfg.Providers.Qwen.Executable)
	}, cfg.Providers.Qwen.Executable)
	add(provider.Shell, func() (provider.Descriptor, error) {
		return provider.NewShell(cfg.Providers.Shell.Executable)
	}, cfg.Providers.Shell.Executable)
	return out
}

// sealedStores is the store list the check runs against; tests swap it for
// fixture paths.
var sealedStores = sealedstate.DefaultStores

// SealedDestinations are the configured paths Deck persists into, resolved
// through any existing symlink prefix, keyed by what they are. The database
// file and its sidecars are listed as well as their directory, because a
// file symlink inside a sealed directory pointing at a plaintext mount is
// the same escape as a directory symlink. Each must lie inside a sealed
// store; the tmux socket is excluded because a socket holds no data and its
// directory is a tmpfs by design.
func SealedDestinations(cfg *config.Config) map[string]string {
	dest := map[string]string{
		"database":             sealedstate.ResolveExisting(filepath.Dir(cfg.Database.Path)),
		"database file":        sealedstate.ResolveExisting(cfg.Database.Path),
		"database wal":         sealedstate.ResolveExisting(cfg.Database.Path + "-wal"),
		"database shm":         sealedstate.ResolveExisting(cfg.Database.Path + "-shm"),
		"database-lock":        sealedstate.ResolveExisting(filepath.Dir(cfg.Database.LockPath)),
		"database-lock file":   sealedstate.ResolveExisting(cfg.Database.LockPath),
		"installation mode":    sealedstate.ResolveExisting(auth.InstallationModePath(cfg.Database.Path)),
		"authentication state": sealedstate.ResolveExisting(filepath.Join(filepath.Dir(cfg.Database.Path), "auth-state.json")),
	}
	if cfg.Server.UnixSocket != "" {
		dest["gateway socket directory"] = sealedstate.ResolveExisting(filepath.Dir(cfg.Server.UnixSocket))
	}
	for i, root := range cfg.Projects.AllowedRoots {
		dest[fmt.Sprintf("projects-root-%d", i)] = sealedstate.ResolveExisting(root)
	}
	return dest
}

// sealedSymlinkFailures refuses a database or lock path that is itself a
// symlink, whatever it points at: SQLite opens the configured name and
// follows the link, so a link is a destination the check did not verify.
func sealedSymlinkFailures(cfg *config.Config) []string {
	var failures []string
	for name, path := range map[string]string{
		"database file":      cfg.Database.Path,
		"database wal":       cfg.Database.Path + "-wal",
		"database shm":       cfg.Database.Path + "-shm",
		"database-lock file": cfg.Database.LockPath,
	} {
		info, err := os.Lstat(path)
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			failures = append(failures, fmt.Sprintf("configured %s (%s) is a symlink", name, path))
		}
	}
	sort.Strings(failures)
	return failures
}

// SealedCheck classifies the stores and the configured destinations. With
// required it returns an error naming every failure; without it the results
// are for logging only.
func SealedCheck(cfg *config.Config, facts sealedstate.Facts, required bool) ([]sealedstate.Result, error) {
	facts.SwapPolicy = sealedstate.SwapPolicy(cfg.Sealed.SwapPolicy)
	results, err := sealedstate.Check(facts, sealedstate.Profile(cfg.Sealed.Profile), sealedStores(), required)
	if !required {
		return results, err
	}
	failures := append(sealedSymlinkFailures(cfg), sealedstate.DestinationFailures(results, SealedDestinations(cfg))...)
	if err == nil && len(failures) == 0 {
		return results, nil
	}
	msg := "sealedstate: encrypted state is required and these checks failed: " + strings.Join(failures, "; ")
	if err != nil {
		if len(failures) == 0 {
			return results, err
		}
		msg = err.Error() + "; " + strings.Join(failures, "; ")
	}
	return results, errors.New(msg)
}

// verifySealedState runs the encrypted-state check against the live kernel
// facts, or the injected ones. With sealed.require_encrypted_state it refuses
// to boot on any plaintext or unresolved store or any destination outside
// the sealed stores; without it, every store is logged at warn level when it
// is not sealed and at info level when it is.
func verifySealedState(cfg *config.Config, read func(string) (sealedstate.Facts, error), log zerolog.Logger) error {
	if read == nil {
		read = sealedstate.KernelFacts
	}
	facts, err := read(cfg.Sealed.ReportPath)
	if err != nil {
		if cfg.Sealed.RequireEncryptedState {
			return err
		}
		log.Warn().Err(err).Msg("sealed state: could not read kernel facts; encrypted state is not required, continuing")
		return nil
	}
	results, err := SealedCheck(cfg, facts, cfg.Sealed.RequireEncryptedState)
	for _, r := range results {
		ev := log.Info()
		if !r.Sealed() {
			ev = log.Warn()
		}
		ev.Str("store", r.Store.Name).Str("path", r.Store.Path).Str("backing", string(r.Backing)).
			Str("fstype", r.Mount.FSType).Str("device", r.Mount.Device).Str("reason", r.Reason).
			Bool("nested", r.Nested).Bool("required", cfg.Sealed.RequireEncryptedState).Msg("sealed state")
	}
	return err
}
