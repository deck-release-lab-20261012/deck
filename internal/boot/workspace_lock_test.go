package boot

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrivateLockPreparationReportsActualOutcome(t *testing.T) {
	for _, tc := range []struct {
		name, body  string
		err         error
		want, calls int
	}{
		{"prepared", "", nil, http.StatusNoContent, 1},
		{"unconfirmed", "", errors.New("private session path must not escape"), http.StatusServiceUnavailable, 1},
		{"unexpected body", "{}", nil, http.StatusBadRequest, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			h := workspaceLockHandler(func(context.Context) error { calls++; return tc.err })
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "http://localhost/api/internal/workspace/prepare-lock", strings.NewReader(tc.body)))
			if w.Code != tc.want || calls != tc.calls || strings.Contains(w.Body.String(), "private session path") {
				t.Fatalf("status=%d calls=%d", w.Code, calls)
			}
		})
	}
}
