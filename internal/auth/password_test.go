package auth

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"
)

func newPasswordHandler(t *testing.T, now func() time.Time) *Handler {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct horse battery staple"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	h, err := New(Config{
		Mode:          "password",
		PasswordHash:  hash,
		SessionSecret: []byte("0123456789abcdef0123456789abcdef"),
		Now:           now,
	}, zerolog.Nop())
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestPasswordGateSerializesConcurrentFailures(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := newPasswordGate(func() time.Time { return now })
	var workers sync.WaitGroup
	for i := 0; i < 32; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			g.record("192.0.2.10", false)
		}()
	}
	workers.Wait()
	g.mu.Lock()
	source := g.sources["192.0.2.10"]
	global := g.global
	g.mu.Unlock()
	if source.failures != 32 || global.failures != 32 {
		t.Fatalf("failure accounting source=%d global=%d", source.failures, global.failures)
	}
	if ok, wait := g.admit("192.0.2.10"); ok || wait <= 0 || wait > passwordLockout {
		t.Fatalf("concurrent lockout admitted=%v wait=%v", ok, wait)
	}
}

func TestPasswordGateBoundsDistinctSourceState(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := newPasswordGate(func() time.Time { return now })
	for i := 0; i < maxPasswordSources*2; i++ {
		if ok, _ := g.admit(fmt.Sprintf("192.0.2.%d", i)); !ok {
			// The global gate may be locked only after failures; admission alone
			// never consumes limiter state.
			t.Fatal("clean admission was unexpectedly limited")
		}
	}
	if len(g.sources) != 0 {
		t.Fatalf("admission-only sources retained = %d", len(g.sources))
	}
	for i := 0; i < maxPasswordSources+100; i++ {
		g.record(fmt.Sprintf("198.51.100.%d", i), false)
	}
	if len(g.sources) != maxPasswordSources {
		t.Fatalf("failure sources retained = %d, want cap %d", len(g.sources), maxPasswordSources)
	}
}

func TestPasswordGateWindowRolloverDoesNotShortenLockout(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	g := newPasswordGate(func() time.Time { return now })
	g.sources["192.0.2.10"] = passwordAttempt{
		failures:  maxSourceFailures,
		windowAt:  now,
		lockedTil: now.Add(15 * time.Minute),
	}
	now = now.Add(passwordWindow + time.Minute)
	if ok, wait := g.admit("192.0.2.10"); ok || wait != 4*time.Minute {
		t.Fatalf("rollover admitted=%v wait=%v", ok, wait)
	}
}

func passwordRequest(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/auth/password", strings.NewReader(body))
	req.RemoteAddr = "192.0.2.10:40000"
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestPasswordLoginIssuesExistingSessionCookies(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	h := newPasswordHandler(t, func() time.Time { return now })
	rec := httptest.NewRecorder()
	h.handlePasswordLogin(rec, passwordRequest(`{"password":"correct horse battery staple"}`))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("login = %d: %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != h.sessionCookieName() || cookies[1].Name != h.csrfCookieName() {
		t.Fatalf("cookies = %+v", cookies)
	}

	probe := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	probe.AddCookie(cookies[0])
	passed := false
	h.Require(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { passed = true })).ServeHTTP(httptest.NewRecorder(), probe)
	if !passed {
		t.Fatal("password login cookie did not pass the existing session middleware")
	}
}

func TestPasswordLoginRefusesGenericallyAndBacksOffPerSource(t *testing.T) {
	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	h := newPasswordHandler(t, func() time.Time { return now })
	first := httptest.NewRecorder()
	h.handlePasswordLogin(first, passwordRequest(`{"password":"wrong"}`))
	if first.Code != http.StatusUnauthorized || first.Body.String() != "login failed\n" {
		t.Fatalf("first refusal = %d %q", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	h.handlePasswordLogin(second, passwordRequest(`{"password":"wrong"}`))
	if second.Code != http.StatusTooManyRequests || second.Body.String() != "login failed\n" || second.Header().Get("Retry-After") == "" {
		t.Fatalf("backoff refusal = %d %q retry=%q", second.Code, second.Body.String(), second.Header().Get("Retry-After"))
	}
	now = now.Add(time.Second)
	other := passwordRequest(`{"password":"correct horse battery staple"}`)
	other.RemoteAddr = "192.0.2.11:40000"
	rec := httptest.NewRecorder()
	h.handlePasswordLogin(rec, other)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("independent source = %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPasswordLoginBoundsAndValidatesBody(t *testing.T) {
	for name, body := range map[string]string{
		"unknown field": `{"password":"x","operator":"known"}`,
		"oversized":     `{"password":"` + strings.Repeat("x", maxPasswordBody) + `"}`,
		"missing":       `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			h := newPasswordHandler(t, time.Now)
			req := passwordRequest(body)
			req.RemoteAddr = name + ":40000"
			rec := httptest.NewRecorder()
			h.handlePasswordLogin(rec, req)
			if rec.Code != http.StatusUnauthorized || !bytes.Equal(rec.Body.Bytes(), []byte("login failed\n")) {
				t.Fatalf("response = %d %q", rec.Code, rec.Body.String())
			}
		})
	}
}
