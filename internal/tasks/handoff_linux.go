//go:build linux

package tasks

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func runGenerationHandoff(args []string) error {
	if len(args) != 4 {
		return errors.New("task generation handoff: invalid arguments")
	}
	engine, rootRef, prdRef, ackPath := args[0], args[1], args[2], args[3]
	if !filepath.IsAbs(engine) || filepath.Clean(engine) != engine {
		_ = signalHandoff(ackPath, false)
		return errors.New("task generation handoff: engine path is not canonical")
	}
	for _, ref := range []string{rootRef, prdRef} {
		if !validProcDescriptorPath(ref) {
			_ = signalHandoff(ackPath, false)
			return errors.New("task generation handoff: invalid descriptor reference")
		}
	}
	if !filepath.IsAbs(ackPath) || filepath.Clean(ackPath) != ackPath {
		return errors.New("task generation handoff: invalid acknowledgement path")
	}

	root, err := os.Open(rootRef)
	if err != nil {
		_ = signalHandoff(ackPath, false)
		return fmt.Errorf("task generation handoff: open project root: %w", err)
	}
	defer root.Close()
	if info, err := root.Stat(); err != nil || !info.IsDir() {
		_ = signalHandoff(ackPath, false)
		return errors.New("task generation handoff: project root is not a directory")
	}
	if err := unix.Fchdir(int(root.Fd())); err != nil {
		_ = signalHandoff(ackPath, false)
		return fmt.Errorf("task generation handoff: bind working directory: %w", err)
	}

	prd, err := os.Open(prdRef)
	if err != nil {
		_ = signalHandoff(ackPath, false)
		return fmt.Errorf("task generation handoff: open PRD: %w", err)
	}
	defer prd.Close()
	if info, err := prd.Stat(); err != nil || !info.Mode().IsRegular() {
		_ = signalHandoff(ackPath, false)
		return errors.New("task generation handoff: PRD is not a regular file")
	}

	if err := installDescriptor(prd, generationPRDFD); err != nil {
		_ = signalHandoff(ackPath, false)
		return fmt.Errorf("task generation handoff: install PRD descriptor: %w", err)
	}
	defer func() { _ = unix.Close(generationPRDFD) }()

	if err := signalHandoff(ackPath, true); err != nil {
		return err
	}
	argv := generationEngineArgv(engine)
	runtime.KeepAlive(prd)
	return unix.Exec(engine, argv, os.Environ())
}

// installDescriptor duplicates source above the fixed descriptor range
// before replacing the target. Otherwise an inherited descriptor layout
// could make Dup3 close the source before it is retained.
func installDescriptor(source *os.File, target int) error {
	retained, err := duplicateAtLeast(source, target+1)
	if err != nil {
		return err
	}
	defer func() { _ = unix.Close(retained) }()
	if err := unix.Dup3(retained, target, 0); err != nil {
		return err
	}
	return nil
}

func duplicateAtLeast(file *os.File, minimum int) (int, error) {
	fd, err := unix.FcntlInt(file.Fd(), unix.F_DUPFD_CLOEXEC, minimum)
	runtime.KeepAlive(file)
	return fd, err
}

func validProcDescriptorPath(path string) bool {
	parts := strings.Split(path, "/")
	if len(parts) != 5 || parts[0] != "" || parts[1] != "proc" || parts[3] != "fd" {
		return false
	}
	pid, pidErr := strconv.Atoi(parts[2])
	fd, fdErr := strconv.Atoi(parts[4])
	return pidErr == nil && fdErr == nil && pid > 0 && fd >= 0
}
