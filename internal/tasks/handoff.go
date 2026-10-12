package tasks

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

const (
	generationHandoffCommand = "__task-generation-handoff"
	generationPRDFD          = 10
	handoffTimeout           = 10 * time.Second
)

func generationEngineArgv(engine string) []string {
	return []string{
		engine, "tasks", "generate", "--yes", "/proc/self/fd/10",
	}
}

// IsGenerationHandoffCommand keeps the private command spelling owned by
// this package rather than duplicated in the service entry point.
func IsGenerationHandoffCommand(arg string) bool {
	return arg == generationHandoffCommand
}

// RunGenerationHandoff is the private process mode used inside the managed
// tmux pane. It is exported only so cmd/noisedeck can enter the mode before
// normal configuration loading.
func RunGenerationHandoff(args []string) error {
	return runGenerationHandoff(args)
}

type handoffListener struct {
	listener *net.UnixListener
	path     string
	dir      *os.File
}

func newHandoffListener(socketDir, runID string) (*handoffListener, error) {
	dir, err := os.Open(socketDir)
	if err != nil {
		return nil, fmt.Errorf("taskmaster: open handoff directory: %w", err)
	}
	if info, err := dir.Stat(); err != nil || !info.IsDir() {
		dir.Close()
		return nil, errors.New("taskmaster: handoff path is not a directory")
	}
	path := filepath.Join(descriptorPath(dir), ".task-handoff-"+runID[:12]+".sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		dir.Close()
		return nil, fmt.Errorf("taskmaster: listen for descriptor handoff: %w", err)
	}
	return &handoffListener{listener: listener, path: path, dir: dir}, nil
}

func (h *handoffListener) Close() {
	_ = h.listener.Close()
	_ = os.Remove(h.path)
	_ = h.dir.Close()
}

func (h *handoffListener) await(ctx context.Context) (bool, error) {
	deadline := time.Now().Add(handoffTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := h.listener.SetDeadline(deadline); err != nil {
		return false, err
	}
	conn, err := h.listener.AcceptUnix()
	if err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		return false, fmt.Errorf("taskmaster: descriptor handoff acknowledgement: %w", err)
	}
	defer conn.Close()
	var status [1]byte
	if _, err := io.ReadFull(conn, status[:]); err != nil {
		return false, fmt.Errorf("taskmaster: read descriptor handoff acknowledgement: %w", err)
	}
	return status[0] == 1, nil
}

func signalHandoff(path string, success bool) error {
	conn, err := net.DialTimeout("unix", path, handoffTimeout)
	if err != nil {
		return fmt.Errorf("connect descriptor handoff: %w", err)
	}
	defer conn.Close()
	status := byte(0)
	if success {
		status = 1
	}
	if _, err := conn.Write([]byte{status}); err != nil {
		return fmt.Errorf("signal descriptor handoff: %w", err)
	}
	return nil
}
