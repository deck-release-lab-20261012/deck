package main

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestListNamesEveryHarness(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"list"}, &out, &out); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"claude\t", "codex\t", "devin\tDEVIN_VERSION\tdevin-manifest"} {
		if !strings.Contains(out.String(), name) {
			t.Errorf("list lacks %q:\n%s", name, out.String())
		}
	}
}

func TestUsageErrors(t *testing.T) {
	var out bytes.Buffer
	if err := run(nil, &out, &out); err == nil {
		t.Error("no command ran")
	}
	if err := run([]string{"merge"}, &out, &out); err == nil {
		t.Error("an unknown command ran")
	}
	if err := run([]string{"probe", "-harness", "codex"}, &out, &out); err == nil || !strings.Contains(err.Error(), "-image") {
		t.Errorf("probe without an image: %v", err)
	}
	if err := run([]string{"apply", "-harness", "nope", "-root", t.TempDir()}, &out, &out); err == nil {
		t.Error("an unknown harness applied")
	}
	if err := run([]string{"settle"}, &out, &out); err == nil || !strings.Contains(err.Error(), "-repo") {
		t.Errorf("settle without a repo: %v", err)
	}
	if err := run([]string{"verdict"}, &out, &out); err == nil || !strings.Contains(err.Error(), "-capture") {
		t.Errorf("verdict without a capture: %v", err)
	}
	t.Setenv("OPENAI_API_KEY", "")
	if err := run([]string{"broker", "-model", "m"}, &out, &out); err == nil || !strings.Contains(err.Error(), "OPENAI_API_KEY") {
		t.Errorf("broker without a key: %v", err)
	}
	t.Setenv("OPENAI_API_KEY", "sk-test")
	if err := run([]string{"broker", "-model", "m", "-upstream", "http://plain.example"}, &out, &out); err == nil || !strings.Contains(err.Error(), "https") {
		t.Errorf("broker with a plaintext upstream: %v", err)
	}
	if err := run([]string{"broker"}, &out, &out); err == nil || !strings.Contains(err.Error(), "-model") {
		t.Errorf("broker without a model: %v", err)
	}
	if err := run([]string{"jail-dial"}, &out, &out); err == nil || !strings.Contains(err.Error(), "-socket") {
		t.Errorf("jail-dial without a socket: %v", err)
	}
}

func TestBrokerWritesItsPortAndStopsOnCancel(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-test")
	portFile := filepath.Join(t.TempDir(), "port")
	ctx, cancel := context.WithCancel(context.Background())
	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- runContext(ctx, []string{"broker", "-model", "m", "-listen", "127.0.0.1:0", "-port-file", portFile}, &out, &out)
	}()
	var port []byte
	for i := 0; i < 100; i++ {
		port, _ = os.ReadFile(portFile)
		if len(port) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n, err := strconv.Atoi(strings.TrimSpace(string(port))); err != nil || n <= 0 {
		t.Fatalf("port file = %q", port)
	}
	resp, err := http.Get("http://127.0.0.1:" + strings.TrimSpace(string(port)) + "/admin")
	if err != nil || resp.StatusCode != http.StatusNotFound {
		t.Errorf("broker answered %v %v", resp, err)
	}
	if resp != nil {
		_ = resp.Body.Close()
	}
	cancel()
	if err := <-done; err != nil {
		t.Errorf("broker exit: %v", err)
	}
}

func TestBrokerListensOnAUnixSocket(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-test")
	dir, err := os.MkdirTemp("/tmp", "hb")
	if err != nil {
		dir = t.TempDir()
	} else {
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
	}
	socket := filepath.Join(dir, "b.sock")
	ctx, cancel := context.WithCancel(context.Background())
	var out bytes.Buffer
	done := make(chan error, 1)
	go func() {
		done <- runContext(ctx, []string{"broker", "-model", "m", "-listen", "unix:" + socket}, &out, &out)
	}()
	var info os.FileInfo
	for i := 0; i < 100; i++ {
		var err error
		if info, err = os.Stat(socket); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if info == nil || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0o600 {
		t.Fatalf("socket = %v", info)
	}
	client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}}
	resp, err := client.Get("http://broker/admin")
	if err != nil || resp.StatusCode != http.StatusNotFound {
		t.Errorf("over the socket: %v %v", resp, err)
	}
	if resp != nil {
		_ = resp.Body.Close()
	}
	cancel()
	if err := <-done; err != nil {
		t.Errorf("broker exit: %v", err)
	}
}
