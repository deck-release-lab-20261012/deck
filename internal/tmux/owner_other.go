//go:build !linux

package tmux

import (
	"fmt"
	"os"
	"runtime"
)

// verifyOwnedByRuntimeUser is unavailable off Linux and fails closed,
// matching processIdentity: a build that skipped the socket-ownership check
// would be weaker than the rule while appearing to satisfy it.
func verifyOwnedByRuntimeUser(path string, _ os.FileInfo) error {
	return fmt.Errorf(
		"tmux: socket ownership verification is not implemented on %s; cannot "+
			"establish that %q is owned by the runtime user", runtime.GOOS, path)
}
