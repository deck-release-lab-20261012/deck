package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/noisefloor-oss/deck/internal/audit"
	"github.com/noisefloor-oss/deck/internal/db"
)

// PrepareWorkspaceLock is the backend half of an explicitly authorized lock.
// It closes admission for this backend lifetime. The native controller must
// subsequently stop the entire workload and verify the encrypted mount closed;
// this method alone never establishes a locked workspace.
func (m *Manager) PrepareWorkspaceLock(ctx context.Context) error {
	if err := m.gate.FenceAndDrain(ctx); err != nil {
		return err
	}
	// One transaction marks the complete cohort before the first signal. An
	// interrupted stop must not leave its later members eligible for recovery.
	if err := m.repo.recordWorkspaceStop(ctx); err != nil {
		return err
	}
	// An interrupted recovery can leave a live provisional CLI behind a
	// terminal session row. The ordinary active list cannot prove it stopped.
	slots, err := m.repo.ListSuccessorSlots(ctx)
	if err != nil {
		return err
	}
	if len(slots) != 0 {
		return fmt.Errorf("workspace lock: unresolved recovery: %w", ErrUnverifiable)
	}
	cohort, err := m.repo.ListActive(ctx)
	if err != nil {
		return err
	}
	for _, s := range cohort {
		if s.Status != StatusRunning {
			return fmt.Errorf("workspace lock: unsettled session: %w", ErrUnverifiable)
		}
		stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := m.Stop(stopCtx, s.ID, false)
		cancel()
		if errors.Is(err, ErrStopUnobserved) && ctx.Err() == nil {
			// Force is still an exact, reobserved stop of this generation, never a
			// signal based on a stale process ID or an uncertain prior delivery.
			forceCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = m.Stop(forceCtx, s.ID, true)
			cancel()
		}
		if errors.Is(err, ErrNotRunning) && ctx.Err() == nil {
			// Another cohort member can finish while an earlier stop waits.
			// Its terminal row alone is insufficient: verify the original
			// generation's process is gone before continuing shutdown.
			observed := m.ObserveRuntime(ctx, s)
			if observed.Process == ProcessDead && (observed.IdentityVerified == nil || *observed.IdentityVerified) {
				continue
			}
		}
		if err != nil {
			return err
		}
	}
	return ctx.Err()
}

func (r *Repository) recordWorkspaceStop(ctx context.Context) error {
	return r.db.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		now := db.FormatTime(time.Now())
		// The generation marker survives ordinary stop expiry and compatibility
		// cleanup of recovery counters. Explicit Resume advances the generation.
		_, err := tx.ExecContext(ctx, `UPDATE sessions
			SET stop_requested_at = ?, workspace_stop_generation = generation, updated_at = ?
			WHERE removed_at IS NULL`, now, now)
		if err != nil {
			return err
		}
		return db.AppendAudit(ctx, tx, db.AuditEvent{Type: string(audit.WorkspaceStopRequested),
			Details: "workspace locking closed launch and input admission and recorded all session stops"})
	})
}

func workspaceStopped(s *Session) bool {
	return s != nil && s.Generation > 0 && s.WorkspaceStopGeneration == s.Generation
}
