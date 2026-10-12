package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/noisefloor-oss/deck/internal/inputgate"
	"github.com/noisefloor-oss/deck/internal/provider"
)

const resumeSweepBound = 30 * time.Second

type RecoveryCounts struct {
	AutomaticPending  int
	AutomaticInFlight int
}

func (m *Manager) RecoveryCounts(ctx context.Context) (RecoveryCounts, error) {
	var counts RecoveryCounts
	candidates, slots, err := m.repo.RecoveryFactsSnapshot(ctx)
	if err != nil {
		return counts, err
	}
	for _, source := range candidates {
		desc, ok := m.providers[provider.Name(source.Provider)]
		if automaticRecoveryOpportunity(source, desc, ok, m.now()) {
			counts.AutomaticPending++
		}
	}
	counts.AutomaticInFlight = len(slots)
	return counts, nil
}

// AutoResumeSweep gives each exact lost generation one row-local recovery
// execution. Admission itself consumes the opportunity; ordinary provider
// refusal is a diagnostic outcome, not a retry series.
func (m *Manager) AutoResumeSweep(ctx context.Context) error {
	if m.gate == nil || m.leases == nil || m.workDir == nil {
		return errors.New("session: automatic recovery is not wired")
	}
	candidates, err := m.repo.ListResumeCandidates(ctx)
	if err != nil {
		return err
	}
	sctx, cancel := context.WithTimeout(ctx, resumeSweepBound)
	defer cancel()
	for _, source := range candidates {
		_, err := m.recover(sctx, source.ID, "", false)
		switch {
		case err == nil,
			errors.Is(err, ErrNotResumable),
			errors.Is(err, ErrRecoverySuperseded),
			errors.Is(err, ErrRecoveryInProgress):
			continue
		case errors.Is(err, inputgate.ErrWorkspaceLocking):
			return nil
		case errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil:
			return nil
		default:
			return fmt.Errorf("session: automatic recovery: %w", err)
		}
	}
	return nil
}
