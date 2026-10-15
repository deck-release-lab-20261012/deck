//go:build darwin

package project

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// Darwin cannot reopen directory descriptors through /dev/fd with O_DIRECTORY.
// Keep a rooted handle alongside each no-follow descriptor instead.
func openProjectRoot(projectRoot string, afterAnchor func()) (*os.Root, error) {
	if !filepath.IsAbs(projectRoot) || filepath.Clean(projectRoot) != projectRoot {
		return nil, fmt.Errorf("%w: project root is not canonical", ErrOutsideProject)
	}
	fd, err := openDirectory("/")
	if err != nil {
		return nil, fmt.Errorf("open project root anchor: %w", err)
	}
	anchor := os.NewFile(uintptr(fd), "project-root")
	if anchor == nil {
		_ = unix.Close(fd)
		return nil, errors.New("open project root anchor: invalid file descriptor")
	}
	root, err := os.OpenRoot("/")
	if err != nil {
		_ = anchor.Close()
		return nil, err
	}
	keepRoot := false
	defer func() {
		_ = anchor.Close()
		if !keepRoot {
			_ = root.Close()
		}
	}()
	for _, component := range strings.Split(strings.TrimPrefix(projectRoot, "/"), "/") {
		if component == "" {
			continue
		}
		nextFD, err := openDirectoryAt(int(anchor.Fd()), component)
		if err != nil {
			return nil, fmt.Errorf("%w: project root changed during acquisition: %w", ErrOutsideProject, err)
		}
		nextAnchor := os.NewFile(uintptr(nextFD), "project-root")
		if nextAnchor == nil {
			_ = unix.Close(nextFD)
			return nil, errors.New("open project root component: invalid file descriptor")
		}
		nextRoot, err := root.OpenRoot(component)
		if err != nil {
			_ = nextAnchor.Close()
			return nil, fmt.Errorf("%w: project root changed during acquisition: %w", ErrOutsideProject, err)
		}
		anchorInfo, anchorErr := nextAnchor.Stat()
		rootInfo, rootErr := nextRoot.Stat(".")
		if anchorErr != nil || rootErr != nil || !os.SameFile(anchorInfo, rootInfo) {
			_ = nextRoot.Close()
			_ = nextAnchor.Close()
			return nil, fmt.Errorf("%w: project root descriptor identity changed", ErrOutsideProject)
		}
		oldRoot, oldAnchor := root, anchor
		root, anchor = nextRoot, nextAnchor
		rootErr, anchorErr = oldRoot.Close(), oldAnchor.Close()
		if rootErr != nil || anchorErr != nil {
			return nil, errors.New("close project root component failed")
		}
	}
	if afterAnchor != nil {
		afterAnchor()
	}
	keepRoot = true
	return root, nil
}

func renameNoReplace(pfd int, staged, leaf string) error {
	for {
		err := unix.RenameatxNp(pfd, staged, pfd, leaf, unix.RENAME_EXCL)
		if !errors.Is(err, syscall.EINTR) {
			return err
		}
	}
}
