package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDockerfileInstallsPinnedDevinCLI(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, required := range []string{
		"ARG DEVIN_VERSION=3000.11.3",
		"ARG DEVIN_SHA256_AMD64=83b3b113c01bf2a3e9e100db08d77e6b086806a7754f091e20831bdfe215157e",
		"ARG DEVIN_SHA256_ARM64=21a2d7a8dea67987067cde7eb3fe7193a48daa8f8c3d50d414c603c4a2b67f15",
		"https://static.devin.ai/cli/${DEVIN_VERSION}/devin-${DEVIN_VERSION}-${devin_arch}-unknown-linux.tar.gz",
		`echo "${devin_sha256}  /tmp/devin.tar.gz" | sha256sum -c -`,
		`tar --no-same-owner -xzf /tmp/devin.tar.gz`,
		`ln -s "/opt/devin/${DEVIN_VERSION}/bin/devin" /usr/local/bin/devin`,
		`test "$(devin --version | awk '{print $2}')" = "${DEVIN_VERSION}"`,
		`grep -Eq -- "(^|[[:space:]])${flag}([[:space:],]|$)" /tmp/devin-help || exit 1`,
		"--resume",
		"--model",
		"--print",
		"--permission-mode",
		"--respect-workspace-trust",
	} {
		if !strings.Contains(body, required) {
			t.Errorf("Dockerfile is missing %q", required)
		}
	}
	if strings.Contains(body, "https://cli.devin.ai/install.sh") {
		t.Fatal("Dockerfile follows Devin's moving installer instead of the pinned artifact")
	}
}

func TestComposeExampleDocumentsDevinOperatorAuth(t *testing.T) {
	raw, err := os.ReadFile("compose.env.example")
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, required := range []string{
		"devin auth login",
		"~/.local/share/devin/credentials.toml",
		`"attribution": false`,
		`"auto_update": false`,
		"~/.config/devin/config.json",
	} {
		if !strings.Contains(body, required) {
			t.Errorf("compose.env.example is missing %q", required)
		}
	}
}
