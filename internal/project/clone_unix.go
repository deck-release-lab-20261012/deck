//go:build unix

package project

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// leafOpenFlags opens a directory by name without following a link in
// its place: a name swapped for a link is refused, not followed.
const leafOpenFlags = syscall.O_NOFOLLOW | syscall.O_DIRECTORY

// rootAtDescriptor binds an os.Root to a directory already held open, by
// the kernel-owned link to the descriptor rather than by any path name.
func rootAtDescriptor(dir *os.File) (*os.Root, error) {
	return os.OpenRoot(fmt.Sprintf("/proc/self/fd/%d", dir.Fd()))
}

// killProcessGroup runs the command in its own process group and, on
// cancel, signals the group: git's helpers die with it.
func killProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}

// workingDirectoryOf names the directory dir holds open, by descriptor
// rather than by path, so the child changes into the directory that was
// validated even if its name has since been pointed elsewhere. The
// descriptor stays open in the parent until the child has started.
func workingDirectoryOf(dir *os.File, _ string) string {
	return fmt.Sprintf("/proc/self/fd/%d", dir.Fd())
}
