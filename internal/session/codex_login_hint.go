package session

import (
	"os"
	"path/filepath"
	"strings"
)

// The exact env -i launch assignments are the source, not tmux's inherited
// environment. File metadata only suppresses optional first-login guidance;
// it establishes neither a valid credential nor a subscription.
func codexLoginHelperHint(launchEnvironment []string, workDir string) bool {
	env := make(map[string]string)
	for _, assignment := range launchEnvironment {
		if key, value, ok := strings.Cut(assignment, "="); ok {
			env[key] = value
		}
	}
	if env["NOISEDECK_LOGIN_PROVIDER"] != "codex" || env["NOISEDECK_LOGIN_SOCKET"] == "" {
		return false
	}
	home := env["CODEX_HOME"]
	if home == "" {
		if env["HOME"] == "" {
			return true
		}
		home = filepath.Join(env["HOME"], ".codex")
	}
	if !filepath.IsAbs(home) {
		home = filepath.Join(workDir, home)
	}
	info, err := os.Stat(filepath.Join(home, "auth.json"))
	return err != nil || !info.Mode().IsRegular()
}
