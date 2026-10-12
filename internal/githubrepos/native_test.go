package githubrepos

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeExitPreservesHTTPClassificationWithoutDiagnostics(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\nprintf 'HTTP/2.0 403 Forbidden\\r\\nX-RateLimit-Remaining: 0\\r\\n\\r\\n{}'\nprintf 'synthetic-private-diagnostic' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	result := newService(authStatus("operator"), execRun).List(context.Background(), "operator", true)
	if result.Outcome != outcomeRateLimited || result.Complete || len(result.Repositories) != 0 {
		t.Fatalf("outcome %+v", result)
	}
	stdout, err := execRun(context.Background(), listPageArgv(1))
	if err == nil || !strings.Contains(string(stdout), "403") || strings.Contains(string(stdout), "private-diagnostic") {
		t.Fatalf("command boundary lost HTTP status or retained diagnostics")
	}
}

func TestPartialSSOResponseNeverBecomesCompleteListing(t *testing.T) {
	run := func(context.Context, []string) ([]byte, error) {
		return ghResponse(200, "OK", map[string]string{"X-GitHub-SSO": "partial-results; organizations=1"}, "["+repoJSON(1, "operator", "public", "User", "", false)+"]"), nil
	}
	result := newService(authStatus("operator"), run).List(context.Background(), "operator", true)
	if result.Outcome != outcomeSSORequired || result.Complete || len(result.Repositories) != 0 {
		t.Fatalf("partial SSO result %+v", result)
	}
}

func TestDotPrefixedRepositoryIsSelectable(t *testing.T) {
	repo, out := decodeRepoObject([]byte(repoJSON(7, "org", ".github", "Organization", "", false)))
	if out != outcomeOK || repo.CloneURL != "https://github.com/org/.github.git" {
		t.Fatalf("dot repository %+v %s", repo, out)
	}
	if _, out := decodeRepoArray([]byte("null")); out != outcomeMalformed {
		t.Fatalf("null listing classified %s", out)
	}
}
