//go:build linux

package workspacemigrate

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotRefusesUnsupportedMetadata(t *testing.T) {
	for _, kind := range []string{"hardlink", "symlink-hardlink", "xattr", "fifo", "setuid"} {
		t.Run(kind, func(t *testing.T) {
			root, _ := fixture(t)
			name := filepath.Join(root.Name(), "data", "example")
			switch kind {
			case "hardlink":
				if err := os.Link(name, filepath.Join(root.Name(), "data", "another")); err != nil {
					t.Fatal(err)
				}
			case "symlink-hardlink":
				if err := os.Link(filepath.Join(root.Name(), "home", "project-link"), filepath.Join(root.Name(), "home", "another-link")); err != nil {
					t.Fatal(err)
				}
			case "xattr":
				if err := unix.Setxattr(name, "user.workspace-test", []byte("synthetic"), 0); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				if err := unix.Mkfifo(filepath.Join(root.Name(), "data", "pipe"), 0600); err != nil {
					t.Fatal(err)
				}
			case "setuid":
				if err := os.Chmod(name, 0700|os.ModeSetuid); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := ManifestFor(t.Context(), root); !errors.Is(err, ErrSnapshot) {
				t.Fatal("unsupported metadata silently dropped", err)
			}
		})
	}
}
