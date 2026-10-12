package boot

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"filippo.io/age"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/noisefloor-oss/deck/internal/db"
	"github.com/noisefloor-oss/deck/internal/lock"
	"github.com/noisefloor-oss/deck/internal/session"
	"github.com/noisefloor-oss/deck/internal/tmux"
)

// The backup round trip, end to end: back up a database holding a live
// session while the backend is running, start a SECOND workload AFTER the
// backup with no database row (the post-backup orphan), stop only the
// backend, and restore. Restore must fence the whole namespace — the orphan
// included — before installing the backup, so the next boot reconciles the
// restored `running` row to interrupted and nothing relaunches it: a
// restore never replays anything on its own.
func TestRestoreRoundTripReconcilesRestoredRows(t *testing.T) {
	cfg := testConfig(t)
	h := upOrFail(t, cfg)
	ctx := context.Background()

	now := db.FormatTime(time.Now())
	if err := h.DB.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO projects (id, name, canonical_path, git_author_name, git_author_email, created_at, last_used_at)
			VALUES ('restore-project', 'restore', ?, 'Test Author', 'test@example.invalid', ?, ?)`,
			cfg.Projects.AllowedRoots[0], now, now); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO taskmaster_runs (id, project_id, argv, status, exit_code, started_at, finished_at)
			VALUES ('restore-run', 'restore-project', '["noise","tasks","next"]', 'exited', 0, ?, ?)`,
			now, now)
		return err
	}); err != nil {
		t.Fatalf("seed project and task run: %v", err)
	}
	info, err := h.Tmux.CreateSession(ctx, tmux.SessionSpec{
		Name: "restore-live", WorkDir: cfg.Projects.AllowedRoots[0],
		Argv: []string{"/bin/sh"}, Generation: 1, Marker: "restore-marker",
	})
	if err != nil {
		t.Fatalf("create live pane: %v", err)
	}
	s := &session.Session{
		ID: "restore-live", ProjectID: "restore-project", Provider: "shell",
		TmuxSocketPath: cfg.Tmux.SocketPath, TmuxSessionName: "restore-live", Generation: 1,
		IdentityMarker: ptr("restore-marker"),
	}
	if err := h.Sessions.Create(ctx, s); err != nil {
		t.Fatalf("create session row: %v", err)
	}
	s.TmuxSessionID, s.TmuxPaneID = &info.SessionID, &info.PaneID
	s.PanePID, s.ProcessGroupID, s.StartTicks = &info.PID, &info.ProcessGroupID, &info.StartTicks
	s.BootEpoch = testBootEpoch(t)
	s.ExpectedExecutable = &info.Executable
	if err := h.Sessions.MarkRunning(ctx, s); err != nil {
		t.Fatalf("mark running: %v", err)
	}
	if _, err := h.Leases.Acquire(ctx, s.ID, "restore-controller", false); err != nil {
		t.Fatalf("seed controller lease: %v", err)
	}

	var migrations, leases, runs, audited int
	if err := h.DB.Reader().QueryRow(
		`SELECT count(*) FROM schema_migrations`).Scan(&migrations); err != nil {
		t.Fatalf("count migrations before backup: %v", err)
	}
	if err := h.DB.Reader().QueryRow(
		`SELECT count(*) FROM controller_leases`).Scan(&leases); err != nil {
		t.Fatalf("count leases before backup: %v", err)
	}
	if err := h.DB.Reader().QueryRow(
		`SELECT count(*) FROM taskmaster_runs`).Scan(&runs); err != nil {
		t.Fatalf("count task runs before backup: %v", err)
	}
	if err := h.DB.Reader().QueryRow(
		`SELECT count(*) FROM audit_events`).Scan(&audited); err != nil {
		t.Fatalf("count audit events before backup: %v", err)
	}
	if leases != 1 || runs != 1 || audited < 1 {
		t.Fatalf("pre-backup seed counts: leases=%d runs=%d audit=%d, want 1/1/>=1",
			leases, runs, audited)
	}

	// The online backup, taken while the backend and its session are live.
	// The destination is outside the data directory and every allowed root.
	backupPath := filepath.Join(t.TempDir(), "control-backup.db")
	if err := h.DB.Backup(ctx, backupPath); err != nil {
		t.Fatalf("Backup: %v", err)
	}

	// A workload started AFTER the backup with no database row: the orphan a
	// naive file-copy restore would leave running beside a restored database
	// that has no knowledge of it.
	if _, err := h.Tmux.CreateSession(ctx, tmux.SessionSpec{
		Name: "restore-orphan", WorkDir: cfg.Projects.AllowedRoots[0],
		Argv: []string{"/bin/sh"}, Generation: 1, Marker: "orphan-marker",
	}); err != nil {
		t.Fatalf("create orphan pane: %v", err)
	}
	if got, err := h.Tmux.HasSession(ctx, "restore-orphan"); err != nil || !got {
		t.Fatalf("orphan session exists before restore: got=%v err=%v", got, err)
	}

	// Stop ONLY the backend. The tmux namespace — both panes — stays alive,
	// which is the point: Restore must fence it, not the test. h.Tmux remains
	// a valid client to the now-live socket.
	h.Close()

	if err := Restore(ctx, cfg, backupPath, zerolog.Nop()); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	// The fence killed the whole namespace, orphan included.
	if _, err := h.Tmux.ListSessions(ctx); !errors.Is(err, tmux.ErrNoServer) {
		t.Fatalf("tmux namespace after restore = %v, want no server (fence did not kill it)", err)
	}

	// The restored file is in place, owner-only.
	dbStat, err := os.Stat(cfg.Database.Path)
	if err != nil {
		t.Fatalf("stat restored database: %v", err)
	}
	if perm := dbStat.Mode().Perm(); perm != 0o600 {
		t.Errorf("restored database mode = %04o, want 0600", perm)
	}

	// Boot against the restored file. Boot succeeding at all means Open's
	// fail-closed migration verification accepted the restored
	// schema_migrations; the reconciliation assertions are below.
	restarted := upOrFail(t, cfg)

	got, err := restarted.Sessions.Get(ctx, s.ID)
	if err != nil {
		t.Fatalf("Get restored session: %v", err)
	}
	if got.Status != session.StatusInterrupted {
		t.Fatalf("restored running row resolved to %s, want interrupted", got.Status)
	}
	if got.ExitCode != nil || got.ExitSignal != nil {
		t.Fatal("interruption must carry no fabricated exit evidence")
	}

	// The non-session control state rides through unchanged.
	var projects, restoredMigrations, restoredLeases, restoredRuns, restoredAudit int
	if err := restarted.DB.Reader().QueryRow(
		`SELECT count(*) FROM projects WHERE id='restore-project'`).Scan(&projects); err != nil {
		t.Fatalf("count restored projects: %v", err)
	}
	if err := restarted.DB.Reader().QueryRow(
		`SELECT count(*) FROM schema_migrations`).Scan(&restoredMigrations); err != nil {
		t.Fatalf("count restored migrations: %v", err)
	}
	if err := restarted.DB.Reader().QueryRow(
		`SELECT count(*) FROM controller_leases`).Scan(&restoredLeases); err != nil {
		t.Fatalf("count restored leases: %v", err)
	}
	if err := restarted.DB.Reader().QueryRow(
		`SELECT count(*) FROM taskmaster_runs`).Scan(&restoredRuns); err != nil {
		t.Fatalf("count restored task runs: %v", err)
	}
	if err := restarted.DB.Reader().QueryRow(
		`SELECT count(*) FROM audit_events`).Scan(&restoredAudit); err != nil {
		t.Fatalf("count restored audit events: %v", err)
	}
	if projects != 1 || restoredMigrations != migrations {
		t.Errorf("restored projects=%d migrations=%d, want 1 and %d",
			projects, restoredMigrations, migrations)
	}
	if restoredLeases != 1 || restoredRuns != 1 {
		t.Errorf("restored leases=%d taskmaster_runs=%d, want 1 and 1", restoredLeases, restoredRuns)
	}
	if restoredAudit < audited {
		t.Errorf("restored audit_events=%d, want at least %d (rode through)", restoredAudit, audited)
	}

	// No replay: the namespace holds nothing, so the restored row was
	// resolved, not relaunched.
	if _, err := restarted.Tmux.ListSessions(ctx); !errors.Is(err, tmux.ErrNoServer) {
		t.Fatalf("tmux namespace after restore = %v, want no server", err)
	}
}

// A backup whose recorded migrations do not match the binary is refused at
// boot: Open's verification is the guard that keeps an incompatible file
// from reaching service. The backup is installed through Restore — the
// supported path — and then the ledger is corrupted in place.
func TestRestoreOfIncompatibleDatabaseRefusesBoot(t *testing.T) {
	cfg := testConfig(t)
	h := upOrFail(t, cfg)
	backupPath := filepath.Join(t.TempDir(), "control-backup.db")
	if err := h.DB.Backup(context.Background(), backupPath); err != nil {
		t.Fatalf("Backup: %v", err)
	}
	h.Close()

	if err := Restore(context.Background(), cfg, backupPath, zerolog.Nop()); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	// Corrupt the ledger the way an edited or foreign database would present:
	// a recorded migration whose checksum no longer matches.
	d, err := db.Open(context.Background(), db.Config{Path: cfg.Database.Path})
	if err != nil {
		t.Fatalf("reopen restored file: %v", err)
	}
	if err := d.WithTx(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx,
			`UPDATE schema_migrations SET checksum = 'bogus' WHERE version = 1`)
		return err
	}); err != nil {
		t.Fatalf("corrupt ledger: %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatalf("close corrupted database: %v", err)
	}

	if _, err := Up(context.Background(), cfg, zerolog.Nop()); err == nil {
		t.Fatal("boot accepted a restored database whose migration ledger was altered")
	}
}

// A backup whose ledger does not match the binary must be refused BEFORE
// Restore fences or installs anything: an incompatible backup leaves the
// host's current database byte-identical.
func TestRestoreRefusesIncompatibleBackup(t *testing.T) {
	cfg := testConfig(t)
	h := upOrFail(t, cfg)
	backupPath := filepath.Join(t.TempDir(), "control-backup.db")
	if err := h.DB.Backup(context.Background(), backupPath); err != nil {
		t.Fatalf("Backup: %v", err)
	}
	h.Close()

	before, err := os.ReadFile(cfg.Database.Path)
	if err != nil {
		t.Fatalf("read current database: %v", err)
	}

	// Corrupt the BACKUP's ledger, not the live database's.
	d, err := db.Open(context.Background(), db.Config{Path: backupPath})
	if err != nil {
		t.Fatalf("open backup to corrupt: %v", err)
	}
	if err := d.WithTx(context.Background(), func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx,
			`UPDATE schema_migrations SET checksum = 'bogus' WHERE version = 1`)
		return err
	}); err != nil {
		t.Fatalf("corrupt backup ledger: %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatalf("close corrupted backup: %v", err)
	}

	if err := Restore(context.Background(), cfg, backupPath, zerolog.Nop()); err == nil {
		t.Fatal("Restore accepted a backup whose migration ledger was altered")
	}

	after, err := os.ReadFile(cfg.Database.Path)
	if err != nil {
		t.Fatalf("reread current database: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("Restore modified the current database despite refusing the backup")
	}
}

// Restore is maintenance: it must refuse while a backend holds the exclusive
// lock, and refuse BEFORE fencing — a workload alive before the call must
// still be alive after it.
func TestRestoreRefusesWhileBackendRunning(t *testing.T) {
	cfg := testConfig(t)
	h := upOrFail(t, cfg)
	t.Cleanup(func() { _ = h.Tmux.KillServer(context.Background()) })
	ctx := context.Background()

	if _, err := h.Tmux.CreateSession(ctx, tmux.SessionSpec{
		Name: "running-guard", WorkDir: cfg.Projects.AllowedRoots[0],
		Argv: []string{"/bin/sh"}, Generation: 1, Marker: "guard-marker",
	}); err != nil {
		t.Fatalf("create guard session: %v", err)
	}
	backupPath := filepath.Join(t.TempDir(), "control-backup.db")
	if err := h.DB.Backup(ctx, backupPath); err != nil {
		t.Fatalf("Backup: %v", err)
	}

	err := Restore(ctx, cfg, backupPath, zerolog.Nop())
	if !errors.Is(err, lock.ErrHeld) {
		t.Fatalf("Restore with backend running: err = %v, want lock.ErrHeld", err)
	}

	got, err := h.Tmux.HasSession(ctx, "running-guard")
	if err != nil {
		t.Fatalf("HasSession guard after refused restore: %v", err)
	}
	if !got {
		t.Fatal("restore fenced the namespace despite refusing on the lock")
	}
}

// A sealed backup that cannot be opened must be refused before the tmux
// namespace is fenced or the database replaced: a live pane survives every
// refusal, the database is byte-identical afterwards, and no staging file is
// left beside it. Only the matching identity restores, and what it restores
// is the backup's data, not the live database's.
func TestRestoreSealedRefusesBeforeFencing(t *testing.T) {
	cfg := testConfig(t)
	h := upOrFail(t, cfg)
	ctx := context.Background()
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatalf("generate identity: %v", err)
	}

	// The backup holds a row the live database will not have afterwards, so
	// a successful restore is distinguishable from a no-op.
	now := db.FormatTime(time.Now())
	if err := h.DB.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO projects (id, name, canonical_path, created_at, last_used_at)
			VALUES ('in-backup', 'in backup', ?, ?, ?)`, cfg.Projects.AllowedRoots[0], now, now)
		return err
	}); err != nil {
		t.Fatalf("seed backup-only project: %v", err)
	}
	backupPath := filepath.Join(t.TempDir(), "control-backup.db.age")
	if err := h.DB.BackupSealed(ctx, backupPath, id.Recipient()); err != nil {
		t.Fatalf("BackupSealed: %v", err)
	}
	if err := h.DB.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE id = 'in-backup'`)
		return err
	}); err != nil {
		t.Fatalf("remove backup-only project from the live database: %v", err)
	}

	// A live workload in the namespace. Restore must not touch it on any
	// refusal; the test never fences anything itself.
	if _, err := h.Tmux.CreateSession(ctx, tmux.SessionSpec{
		Name: "sealed-live", WorkDir: cfg.Projects.AllowedRoots[0],
		Argv: []string{"/bin/sh"}, Generation: 1, Marker: "sealed-marker",
	}); err != nil {
		t.Fatalf("create live pane: %v", err)
	}
	h.Close()
	alive := func(step string) {
		t.Helper()
		got, err := h.Tmux.HasSession(ctx, "sealed-live")
		if err != nil || !got {
			t.Fatalf("after %s: live session gone (got=%v err=%v); restore fenced before refusing", step, got, err)
		}
	}
	alive("backend stop")

	before, err := os.ReadFile(cfg.Database.Path)
	if err != nil {
		t.Fatalf("read current database: %v", err)
	}
	dbDir := filepath.Dir(cfg.Database.Path)
	untouched := func(step string) {
		t.Helper()
		alive(step)
		after, err := os.ReadFile(cfg.Database.Path)
		if err != nil {
			t.Fatalf("after %s: read database: %v", step, err)
		}
		if !bytes.Equal(before, after) {
			t.Fatalf("after %s: the refused restore changed the live database", step)
		}
		entries, _ := os.ReadDir(dbDir)
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ".unseal-") || strings.HasPrefix(e.Name(), ".restore-") {
				t.Fatalf("after %s: staging file %q left behind", step, e.Name())
			}
		}
	}

	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatalf("read sealed backup: %v", err)
	}
	tampered := filepath.Join(t.TempDir(), "tampered.age")
	flipped := append([]byte(nil), raw...)
	flipped[len(flipped)-8] ^= 0xff
	if err := os.WriteFile(tampered, flipped, 0o600); err != nil {
		t.Fatal(err)
	}
	truncated := filepath.Join(t.TempDir(), "truncated.age")
	if err := os.WriteFile(truncated, raw[:len(raw)-64], 0o600); err != nil {
		t.Fatal(err)
	}
	// Valid ciphertext around a file that is not a Deck database at all.
	notADB := filepath.Join(t.TempDir(), "not-a-db.age")
	func() {
		f, err := os.OpenFile(notADB, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		w, err := age.Encrypt(f, id.Recipient())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte("SQLite format 3\x00 but nothing behind it")); err != nil {
			t.Fatal(err)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
	}()
	wrong, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatalf("generate identity: %v", err)
	}

	refusals := []struct {
		name       string
		path       string
		identities []age.Identity
		want       string
	}{
		{"no identity", backupPath, nil, "encrypted"},
		{"wrong identity", backupPath, []age.Identity{wrong}, "unseal"},
		{"tampered ciphertext", tampered, []age.Identity{id}, "unseal"},
		{"truncated ciphertext", truncated, []age.Identity{id}, "unseal"},
		{"encrypted non-database", notADB, []age.Identity{id}, ""},
	}
	for _, r := range refusals {
		err := RestoreSealed(ctx, cfg, r.path, r.identities, zerolog.Nop())
		if err == nil {
			t.Fatalf("%s: RestoreSealed accepted the backup", r.name)
		}
		if r.want != "" && !strings.Contains(err.Error(), r.want) {
			t.Fatalf("%s: error %q does not mention %q", r.name, err, r.want)
		}
		untouched(r.name)
	}

	// The matching identity restores the backup's row, fencing the namespace
	// as a plain restore does.
	if err := RestoreSealed(ctx, cfg, backupPath, []age.Identity{id}, zerolog.Nop()); err != nil {
		t.Fatalf("RestoreSealed with the matching identity: %v", err)
	}
	if got, err := h.Tmux.HasSession(ctx, "sealed-live"); err == nil && got {
		t.Fatal("successful restore left the live pane unfenced")
	}
	entries, _ := os.ReadDir(dbDir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".unseal-") {
			t.Errorf("successful restore left the unsealed staging file %q", e.Name())
		}
	}
	h2 := upOrFail(t, cfg)
	defer h2.Close()
	var n int
	if err := h2.DB.Reader().QueryRow(`SELECT count(*) FROM projects WHERE id = 'in-backup'`).Scan(&n); err != nil {
		t.Fatalf("read restored row: %v", err)
	}
	if n != 1 {
		t.Fatalf("restored database has %d 'in-backup' projects, want 1: the backup's data was not restored", n)
	}
}
