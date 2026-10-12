package harnessbump

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

// BatchResult records the complete discovery snapshot and every applied update.
type BatchResult struct {
	ID       string   `json:"id"`
	Statuses []Status `json:"statuses"`
	Updated  []string `json:"updated"`
}

// BatchID binds a batch to the complete catalogue of target versions.
func BatchID(pins map[string]string) (string, error) {
	sum := sha256.New()
	for _, h := range Catalogue {
		v := pins[h.VersionArg]
		if !ValidVersion(v) {
			return "", fmt.Errorf("invalid target version for %s", h.Name)
		}
		_, _ = fmt.Fprintf(sum, "%s=%s\n", h.Name, v)
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

// ApplyBatch discovers once before changing pins. A failed discovery or digest
// download cannot leave a partial batch that a caller mistakes for a full update.
func ApplyBatch(ctx context.Context, root string, resolver *Resolver) (BatchResult, error) {
	statuses, err := Check(ctx, root, resolver, Catalogue)
	if err != nil {
		return BatchResult{}, err
	}
	result := BatchResult{Statuses: statuses, Updated: []string{}}
	var bumps []Bump
	for _, s := range statuses {
		h, err := Lookup(s.Harness)
		if err != nil {
			return result, err
		}
		if s.Note != "" && h.Source != SourceManual {
			return result, fmt.Errorf("%s: %s", s.Harness, s.Note)
		}
		if !s.Outdated {
			continue
		}
		digests, err := resolver.Digests(ctx, h, s.Latest)
		if err != nil {
			return result, err
		}
		bumps = append(bumps, Bump{Harness: h, From: s.Pinned, To: s.Latest, Digests: digests})
	}
	for _, b := range bumps {
		if _, err := Apply(root, b); err != nil {
			return result, err
		}
		result.Updated = append(result.Updated, b.Harness.Name)
	}
	raw, err := os.ReadFile(filepath.Clean(filepath.Join(root, "Dockerfile")))
	if err != nil {
		return result, err
	}
	result.ID, err = BatchID(ReadPins(raw))
	return result, err
}

// batchHarness is a settlement identity, not a CLI or a catalogue entry.
func batchHarness(name string) (Harness, error) {
	if name == "all" {
		return Harness{Name: "all"}, nil
	}
	return Lookup(name)
}
