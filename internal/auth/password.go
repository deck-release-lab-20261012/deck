package auth

import (
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	maxPasswordBody    = 4096
	maxPasswordLength  = 72 // bcrypt's defined input bound; reject instead of silently truncating.
	passwordWindow     = 10 * time.Minute
	passwordLockout    = 5 * time.Minute
	globalLockout      = time.Minute
	maxSourceFailures  = 8
	maxGlobalFailures  = 80
	maxBackoff         = 30 * time.Second
	maxPasswordSources = 4096
)

type passwordAttempt struct {
	failures  int
	windowAt  time.Time
	retryAt   time.Time
	lockedTil time.Time
}

// passwordGate is an in-process credential-abuse boundary. One mutex makes
// admission and failure accounting linear under concurrent requests.
type passwordGate struct {
	mu      sync.Mutex
	now     func() time.Time
	sources map[string]passwordAttempt
	global  passwordAttempt
}

func newPasswordGate(now func() time.Time) *passwordGate {
	return &passwordGate{now: now, sources: make(map[string]passwordAttempt)}
}

func (g *passwordGate) admit(source string) (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	g.global = freshAttempt(g.global, now)
	s, exists := g.sources[source]
	if exists {
		s = freshAttempt(s, now)
		if attemptInactive(s, now) {
			delete(g.sources, source)
		} else {
			g.sources[source] = s
		}
	}
	until := later(g.global.lockedTil, s.lockedTil)
	until = later(until, g.global.retryAt)
	until = later(until, s.retryAt)
	if now.Before(until) {
		return false, until.Sub(now)
	}
	return true, 0
}

func (g *passwordGate) record(source string, success bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if success {
		delete(g.sources, source)
		return
	}
	g.global = recordFailure(freshAttempt(g.global, now), now, maxGlobalFailures, globalLockout)
	if _, exists := g.sources[source]; !exists {
		g.makeSourceRoom(now)
	}
	g.sources[source] = recordFailure(freshAttempt(g.sources[source], now), now, maxSourceFailures, passwordLockout)
}

func freshAttempt(a passwordAttempt, now time.Time) passwordAttempt {
	if a.windowAt.IsZero() || now.Sub(a.windowAt) >= passwordWindow {
		fresh := passwordAttempt{windowAt: now}
		if a.retryAt.After(now) {
			fresh.retryAt = a.retryAt
		}
		if a.lockedTil.After(now) {
			fresh.lockedTil = a.lockedTil
		}
		return fresh
	}
	return a
}

func attemptInactive(a passwordAttempt, now time.Time) bool {
	return a.failures == 0 && !a.retryAt.After(now) && !a.lockedTil.After(now)
}

// makeSourceRoom bounds adversarial distinct-source memory. Expired entries
// go first; if every slot is live, the oldest window is evicted while the
// global gate continues to bound aggregate attempts.
func (g *passwordGate) makeSourceRoom(now time.Time) {
	if len(g.sources) < maxPasswordSources {
		return
	}
	for source, attempt := range g.sources {
		fresh := freshAttempt(attempt, now)
		if attemptInactive(fresh, now) {
			delete(g.sources, source)
		}
	}
	if len(g.sources) < maxPasswordSources {
		return
	}
	var oldestSource string
	var oldest time.Time
	for source, attempt := range g.sources {
		if oldestSource == "" || attempt.windowAt.Before(oldest) {
			oldestSource, oldest = source, attempt.windowAt
		}
	}
	delete(g.sources, oldestSource)
}

func recordFailure(a passwordAttempt, now time.Time, limit int, lockout time.Duration) passwordAttempt {
	a.failures++
	shift := min(a.failures-1, 7)
	backoff := time.Duration(math.Pow(2, float64(shift))) * 250 * time.Millisecond
	if backoff > maxBackoff {
		backoff = maxBackoff
	}
	a.retryAt = now.Add(backoff)
	if a.failures >= limit {
		a.lockedTil = now.Add(lockout)
	}
	return a
}

func later(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}

func requestSource(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err == nil {
		return host
	}
	return remote
}

func (h *Handler) handlePasswordLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	source := requestSource(r.RemoteAddr)
	if ok, wait := h.password.admit(source); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
		h.passwordRefusal(w, http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPasswordBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var body struct {
		Password string `json:"password"`
	}
	if err := dec.Decode(&body); err != nil || body.Password == "" || len(body.Password) > maxPasswordLength || dec.Decode(&struct{}{}) != io.EOF {
		h.password.record(source, false)
		h.passwordRefusal(w, http.StatusUnauthorized)
		return
	}
	if err := bcrypt.CompareHashAndPassword(h.cfg.PasswordHash, []byte(body.Password)); err != nil {
		h.password.record(source, false)
		h.passwordRefusal(w, http.StatusUnauthorized)
		return
	}
	value, err := h.issueSessionValue(h.now())
	if err != nil {
		http.Error(w, "login unavailable", http.StatusInternalServerError)
		return
	}
	payload, err := h.verifySessionValue(value, h.now())
	if err != nil {
		http.Error(w, "login unavailable", http.StatusInternalServerError)
		return
	}
	h.password.record(source, true)
	h.setSessionCookies(w, value, payload)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) passwordRefusal(w http.ResponseWriter, status int) {
	http.Error(w, "login failed", status)
}
