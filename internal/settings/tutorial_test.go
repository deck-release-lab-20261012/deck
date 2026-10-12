package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/noisefloor-oss/deck/internal/auth"
)

// mountTutorial wires the handler with no authentication: every request then
// lands in the installation-wide bucket, which is the honest scope of a
// single-tenant unauthenticated installation.
func mountTutorial(t *testing.T) (*Repository, *http.ServeMux) {
	t.Helper()
	repo, _ := newTestRepo(t)
	h := NewHandler(repo, zerolog.Nop())
	mux := http.NewServeMux()
	h.Mount(mux.Handle, func(next http.Handler) http.Handler { return next })
	return repo, mux
}

// mountTutorialBehindAuth wires the handler behind the real trusted-proxy
// middleware so tests observe the server-derived principal scope rather than
// trusting a context the test itself planted.
func mountTutorialBehindAuth(t *testing.T) *http.ServeMux {
	t.Helper()
	repo, _ := newTestRepo(t)
	h := NewHandler(repo, zerolog.Nop())
	authHandler, err := auth.New(auth.Config{
		Mode:           "trusted_proxy",
		ProxyAddresses: []string{"127.0.0.1"},
		IdentityHeader: "X-Operator",
	}, zerolog.Nop())
	if err != nil {
		t.Fatalf("auth.New: %v", err)
	}
	mux := http.NewServeMux()
	h.Mount(mux.Handle, authHandler.Require)
	return mux
}

func proxyRequest(t *testing.T, method, target, body, identity string) *http.Request {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	// The middleware trusts the header only from a configured peer.
	req.RemoteAddr = "127.0.0.1:443"
	if identity != "" {
		req.Header.Set("X-Operator", identity)
	}
	return req
}

func decodeTutorial(t *testing.T, rec *httptest.ResponseRecorder) tutorialResponse {
	t.Helper()
	var got tutorialResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rec.Body)
	}
	return got
}

// First use is a missing record: 404, never a fabricated empty document.
func TestTutorialMissingReadsAsNotFound(t *testing.T) {
	_, mux := mountTutorial(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/tutorial", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET status = %d (%s), want 404", rec.Code, rec.Body)
	}
}

func TestTutorialRoundTrip(t *testing.T) {
	_, mux := mountTutorial(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings/tutorial",
		strings.NewReader(`{"version":1,"dismissed":true,"lesson":"welcome","step":2,"done":["welcome"]}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d (%s)", rec.Code, rec.Body)
	}
	written := decodeTutorial(t, rec)
	if written.Scope != "installation" {
		t.Fatalf("unauthenticated write scope = %q, want installation", written.Scope)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/tutorial", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d (%s)", rec.Code, rec.Body)
	}
	got := decodeTutorial(t, rec)
	want := TutorialPreference{Version: 1, Dismissed: true, Lesson: "welcome", Step: 2, Done: []string{"welcome"}}
	if !reflect.DeepEqual(got.TutorialPreference, want) || got.Scope != "installation" {
		t.Fatalf("GET = %+v, want %+v at installation scope", got, want)
	}

	// An omitted done list stores as [], so readers never branch on null.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings/tutorial",
		strings.NewReader(`{"version":1,"dismissed":false,"lesson":"welcome","step":0}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT without done status = %d (%s)", rec.Code, rec.Body)
	}
	if got := decodeTutorial(t, rec); got.Done == nil || len(got.Done) != 0 {
		t.Fatalf("omitted done decoded as %v, want a non-nil empty list", got.Done)
	}
}

// The scope comes from the authenticated principal, established by the
// middleware — never from a caller-supplied field. Two operators are
// independent, the header is consumed so nothing downstream can read it,
// and an unauthenticated request is refused before any scope is consulted.
func TestTutorialScopeIsServerDerived(t *testing.T) {
	mux := mountTutorialBehindAuth(t)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, proxyRequest(t, http.MethodPut, "/api/settings/tutorial",
		`{"version":1,"dismissed":true,"lesson":"welcome","step":1,"done":[]}`, "alice"))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d (%s)", rec.Code, rec.Body)
	}
	if got := decodeTutorial(t, rec); got.Scope != "operator" {
		t.Fatalf("authenticated write scope = %q, want operator", got.Scope)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, proxyRequest(t, http.MethodGet, "/api/settings/tutorial", "", "bob"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("bob GET status = %d, want 404 — alice's record must not leak across scopes", rec.Code)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, proxyRequest(t, http.MethodGet, "/api/settings/tutorial", "", "alice"))
	if rec.Code != http.StatusOK {
		t.Fatalf("alice GET status = %d (%s)", rec.Code, rec.Body)
	}
	if got := decodeTutorial(t, rec); got.Lesson != "welcome" || got.Step != 1 || !got.Dismissed {
		t.Fatalf("alice GET = %+v, want her own record", got)
	}

	// No identity header from a trusted peer is an authentication failure,
	// not a fall-through into a shared scope.
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, proxyRequest(t, http.MethodGet, "/api/settings/tutorial", "", ""))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET status = %d, want 401", rec.Code)
	}
}

func TestTutorialValidationRejects(t *testing.T) {
	bodies := map[string]string{
		"not json":           `not json`,
		"version zero":       `{"version":0,"lesson":"welcome"}`,
		"version newer":      `{"version":2,"lesson":"welcome"}`,
		"lesson missing":     `{"version":1,"step":0}`,
		"lesson too long":    `{"version":1,"lesson":"` + strings.Repeat("a", 65) + `"}`,
		"lesson bad charset": `{"version":1,"lesson":"Welcome Home"}`,
		"lesson path":        `{"version":1,"lesson":"../etc"}`,
		"step negative":      `{"version":1,"lesson":"welcome","step":-1}`,
		"step too large":     `{"version":1,"lesson":"welcome","step":100}`,
		"done entry bad":     `{"version":1,"lesson":"welcome","done":["ok","Bad One"]}`,
		"done too many": `{"version":1,"lesson":"welcome","done":[` + func() string {
			ids := make([]string, 33)
			for i := range ids {
				ids[i] = fmt.Sprintf(`"l%d"`, i)
			}
			return strings.Join(ids, ",")
		}() + `]}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			_, mux := mountTutorial(t)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings/tutorial", strings.NewReader(body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("PUT status = %d (%s), want 400", rec.Code, rec.Body)
			}
			rec = httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/tutorial", nil))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("a rejected write stored a record: GET status = %d", rec.Code)
			}
		})
	}
}

// A record written by a build speaking another contract version is data
// nobody here may reinterpret: reads return it as stored, and a write from
// this build is refused rather than overwriting it.
func TestTutorialUnknownStoredVersionIsPreserved(t *testing.T) {
	repo, d := newTestRepo(t)
	ctx := context.Background()
	h := NewHandler(repo, zerolog.Nop())
	mux := http.NewServeMux()
	h.Mount(mux.Handle, func(next http.Handler) http.Handler { return next })

	const planted = `{"version":99,"dismissed":true,"lesson":"from-the-future","step":4,"done":[]}`
	plant := func() {
		if err := d.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
			return putString(ctx, tx, tutorialKey(""), planted, repo.now())
		}); err != nil {
			t.Fatalf("plant: %v", err)
		}
	}
	plant()

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/tutorial", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d (%s)", rec.Code, rec.Body)
	}
	if got := decodeTutorial(t, rec); got.Version != 99 || got.Lesson != "from-the-future" {
		t.Fatalf("GET = %+v, want the stored version-99 record returned as written", got)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings/tutorial",
		strings.NewReader(`{"version":1,"dismissed":false,"lesson":"welcome","step":0,"done":[]}`)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("PUT over an unknown-version record status = %d (%s), want 409", rec.Code, rec.Body)
	}
	var stored string
	if err := d.Reader().QueryRow(`SELECT value FROM settings WHERE key = ?`, tutorialKey("")).Scan(&stored); err != nil {
		t.Fatalf("read stored row: %v", err)
	}
	if stored != planted {
		t.Fatalf("stored row = %s, want the unknown-version record untouched", stored)
	}
}

// The tutorial document shares the settings table but not the safety
// settings document: neither write touches the other's keys, and a
// presentation write never enters the safety audit trail.
func TestTutorialWriteLeavesSafetySettingsAlone(t *testing.T) {
	repo, d := newTestRepo(t)
	ctx := context.Background()
	if err := repo.SetTutorial(ctx, "", TutorialPreference{
		Version: 1, Dismissed: true, Lesson: "welcome", Step: 1, Done: []string{"welcome"},
	}); err != nil {
		t.Fatalf("write tutorial: %v", err)
	}
	s, err := repo.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if s.SkipPermissions || s.SkipCloseConfirm || s.SkipRemoveProjectConfirm {
		t.Fatalf("a tutorial write flipped a safety setting: %+v", s)
	}
	if err := repo.Set(ctx, Settings{SkipCloseConfirm: true}); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	p, found, err := repo.GetTutorial(ctx, "")
	if err != nil || !found {
		t.Fatalf("tutorial after settings write: %+v, found=%v, %v", p, found, err)
	}
	if !p.Dismissed || p.Lesson != "welcome" || p.Step != 1 {
		t.Fatalf("a settings write clobbered the tutorial record: %+v", p)
	}
	var audits int
	if err := d.Reader().QueryRow(`SELECT COUNT(*) FROM audit_events`).Scan(&audits); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	if audits != 1 {
		t.Fatalf("audit events = %d, want exactly 1 (the safety-settings change alone is audited)", audits)
	}
}

// A stored row that no longer decodes fails closed: reads error, writes are
// refused, and the bytes stay where they are for whoever can repair them.
func TestTutorialCorruptStoredRowFailsClosed(t *testing.T) {
	repo, d := newTestRepo(t)
	ctx := context.Background()
	h := NewHandler(repo, zerolog.Nop())
	mux := http.NewServeMux()
	h.Mount(mux.Handle, func(next http.Handler) http.Handler { return next })

	const planted = `{"version":1,"lesson":`
	if err := d.WithTx(ctx, func(ctx context.Context, tx *sql.Tx) error {
		return putString(ctx, tx, tutorialKey(""), planted, repo.now())
	}); err != nil {
		t.Fatalf("plant: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/settings/tutorial", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("GET over a corrupt row status = %d, want 500", rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/settings/tutorial",
		strings.NewReader(`{"version":1,"dismissed":true,"lesson":"welcome","step":0,"done":[]}`)))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("PUT over a corrupt row status = %d, want 500 — a write must not paper over it", rec.Code)
	}
	var stored string
	if err := d.Reader().QueryRow(`SELECT value FROM settings WHERE key = ?`, tutorialKey("")).Scan(&stored); err != nil {
		t.Fatalf("read stored row: %v", err)
	}
	if stored != planted {
		t.Fatalf("stored row = %q, want the corrupt row untouched", stored)
	}
}
