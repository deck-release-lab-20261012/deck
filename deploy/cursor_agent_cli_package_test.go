package deploy

import (
	"os"
	"strings"
	"testing"
)

func TestDockerfilePinsCursorAgentCLI(t *testing.T) {
	raw, err := os.ReadFile("../Dockerfile")
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	dockerfile := string(raw)
	for _, required := range []string{
		"ARG CURSOR_AGENT_VERSION=2026.10.01-e373342",
		"ARG CURSOR_AGENT_SHA256_AMD64=a79726c6e644520e993970be4c45775a6889802b67abe461a677a53219ae28e8",
		"ARG CURSOR_AGENT_SHA256_ARM64=785c5f6bf2a60eb1121e27ed8c14f5ee07ed1b5b6692324f2d9a997238245eb5",
		"https://downloads.cursor.com/lab/${CURSOR_AGENT_VERSION}/linux/${cursor_arch}/agent-cli-package.tar.gz",
		`test "$(cursor-agent --version)" = "${CURSOR_AGENT_VERSION}"`,
		"cursor-agent --help >/tmp/cursor-agent-help",
		"--trust",
		"--yolo",
		"--resume",
		"ln -s \"/opt/cursor-agent/${CURSOR_AGENT_VERSION}/dist-package/cursor-agent\" /usr/local/bin/cursor-agent",
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile missing Cursor Agent package contract %q", required)
		}
	}
	// The build-time checks must not bake first-run provider state into the
	// image: cursor-agent writes ~/.cursor/cli-config.json and populates the
	// Node compile cache under the cache home even for --version and --help,
	// so the probes run against a scratch home that is deleted in the same
	// layer.
	for _, required := range []string{
		`check=$(mktemp -d)`,
		`export HOME="$check"`,
		`rm -rf "$check" /tmp/cursor-agent-help`,
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile Cursor Agent checks missing scratch-home isolation %q", required)
		}
	}
}
