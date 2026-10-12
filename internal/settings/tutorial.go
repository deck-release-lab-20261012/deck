package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

// TutorialPreferenceVersion is the version of the tutorial preference
// contract this build speaks. It is bumped when the document's shape or the
// meaning of its fields changes, so a record written by another build is
// recognized rather than misread.
const TutorialPreferenceVersion = 1

// keyTutorialV1 prefixes the settings-table rows that hold tutorial
// presentation state. The full key is the prefix plus the authenticated
// principal, so one operator's record never lands in another's scope.
const keyTutorialV1 = "tutorial_v1"

// ErrTutorialVersionConflict refuses a write that would overwrite a stored
// record whose version this build does not speak. Silent overwrite would
// destroy a newer build's progress state; the conflict is reported instead.
var ErrTutorialVersionConflict = errors.New("stored tutorial preference has an unsupported version")

// errTutorialInvalid marks a client-supplied document that fails validation;
// the handler maps it to 400.
var errTutorialInvalid = errors.New("invalid tutorial preference")

// tutorialKey scopes the record to the authenticated principal. An
// installation without authentication is single-tenant, so its one record
// is installation-wide, shared by every browser that reaches it — the empty
// principal is that bucket, not a hidden per-user scope.
func tutorialKey(principal string) string {
	if principal == "" {
		return keyTutorialV1
	}
	return keyTutorialV1 + ":" + principal
}

// tutorialScope names the scope a record was read or written under, so a
// response never implies per-operator storage an unauthenticated
// installation does not have.
func tutorialScope(principal string) string {
	if principal == "" {
		return "installation"
	}
	return "operator"
}

// TutorialPreference is the operator-scoped record of tutorial presentation
// state: whether the operator closed it, and where to resume. It is
// presentation only — it authorizes nothing — so the values are
// bounds-checked and stored, never trusted.
type TutorialPreference struct {
	Version   int      `json:"version"`
	Dismissed bool     `json:"dismissed"`
	Lesson    string   `json:"lesson"`
	Step      int      `json:"step"`
	Done      []string `json:"done"`
}

// tutorialLessonID is the lesson-identifier alphabet: the ids are catalog
// keys the UI ships, never paths or prose.
var tutorialLessonID = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

const (
	tutorialMaxStep = 99
	tutorialMaxDone = 32
)

// normalize keeps the stored document canonical: no duplicate done entries,
// and an empty list stores as [] rather than null so readers never branch
// on Go's nil-slice encoding.
func (p *TutorialPreference) normalize() {
	if p.Done == nil {
		p.Done = []string{}
	}
	seen := make(map[string]bool, len(p.Done))
	done := p.Done[:0]
	for _, id := range p.Done {
		if seen[id] {
			continue
		}
		seen[id] = true
		done = append(done, id)
	}
	p.Done = done
}

func (p TutorialPreference) validate() error {
	if p.Version != TutorialPreferenceVersion {
		return fmt.Errorf("%w: version must be %d", errTutorialInvalid, TutorialPreferenceVersion)
	}
	if !tutorialLessonID.MatchString(p.Lesson) {
		return fmt.Errorf("%w: lesson must be 1-64 lowercase letters, digits or dashes", errTutorialInvalid)
	}
	if p.Step < 0 || p.Step > tutorialMaxStep {
		return fmt.Errorf("%w: step must be between 0 and %d", errTutorialInvalid, tutorialMaxStep)
	}
	if len(p.Done) > tutorialMaxDone {
		return fmt.Errorf("%w: done lists at most %d lessons", errTutorialInvalid, tutorialMaxDone)
	}
	for _, id := range p.Done {
		if !tutorialLessonID.MatchString(id) {
			return fmt.Errorf("%w: done entries are lesson ids", errTutorialInvalid)
		}
	}
	return nil
}

// GetTutorial reads the principal's record. The second return value is
// false when none was ever written — the UI's first-use signal — and a
// stored row whose version this build does not speak is returned as stored,
// so the caller can preserve it instead of misreading it.
func (r *Repository) GetTutorial(ctx context.Context, principal string) (TutorialPreference, bool, error) {
	raw, err := r.getString(ctx, tutorialKey(principal))
	if err != nil {
		return TutorialPreference{}, false, err
	}
	if raw == "" {
		return TutorialPreference{}, false, nil
	}
	var p TutorialPreference
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return TutorialPreference{}, false, fmt.Errorf("decode tutorial preference: %w", err)
	}
	return p, true, nil
}

// SetTutorial stores the principal's record. The version check and the
// write share one transaction: a stored record this build does not speak
// fails with ErrTutorialVersionConflict rather than being overwritten, and a
// stored row that no longer decodes fails closed for the same reason.
// Tutorial progress is a presentation preference, not a security event, so
// — like the layout document — it is not audited.
func (r *Repository) SetTutorial(ctx context.Context, principal string, next TutorialPreference) error {
	return r.db.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		var raw string
		err := tx.QueryRowContext(ctx,
			`SELECT value FROM settings WHERE key = ?`, tutorialKey(principal)).Scan(&raw)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return fmt.Errorf("read tutorial preference: %w", err)
		default:
			var stored TutorialPreference
			if err := json.Unmarshal([]byte(raw), &stored); err != nil {
				return fmt.Errorf("decode stored tutorial preference: %w", err)
			}
			if stored.Version != TutorialPreferenceVersion {
				return ErrTutorialVersionConflict
			}
		}
		encoded, err := json.Marshal(next)
		if err != nil {
			return fmt.Errorf("encode tutorial preference: %w", err)
		}
		return putString(ctx, tx, tutorialKey(principal), string(encoded), r.now())
	})
}
