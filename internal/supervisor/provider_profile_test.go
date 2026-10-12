package supervisor

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/noisefloor-oss/deck/internal/provider"
)

func TestClaudeProviderProfileGolden(t *testing.T) {
	revision, err := CurrentProviderProfile(provider.Claude)
	if err != nil {
		t.Fatalf("CurrentProviderProfile: %v", err)
	}
	var wantJSON, wantDigest string
	switch runtime.GOARCH {
	case "amd64":
		wantJSON = `{"schema":"noisedeck.provider-profile.v1","provider":"claude","descriptor_revision":"claude-assigned-identity.v1","tested_version":"2.1.296","runtime_relative_executable":"usr/local/bin/claude","executable_sha256":"24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de"}`
		wantDigest = "52d80190c8b24abe66540d2943bd85de9b34441331017b02f94b149f8f0770a8"
	case "arm64":
		wantJSON = `{"schema":"noisedeck.provider-profile.v1","provider":"claude","descriptor_revision":"claude-assigned-identity.v1","tested_version":"2.1.296","runtime_relative_executable":"usr/local/bin/claude","executable_sha256":"f1f6e96e0d8342b9dbf41d7e88255397a6a52ce3d8736ad6a4c6b59c9b62fefa"}`
		wantDigest = "f40d9580002be654842de56b1549c84653b8ca110007be1cd129005e2eb06a60"
	default:
		t.Fatalf("unsupported test architecture %s", runtime.GOARCH)
	}
	if revision.CanonicalJSON != wantJSON {
		t.Fatalf("canonical JSON = %s, want %s", revision.CanonicalJSON, wantJSON)
	}
	if revision.Digest != wantDigest {
		t.Fatalf("digest = %s, want %s", revision.Digest, wantDigest)
	}
}

func TestResolveProviderProfileRequiresExactAuthority(t *testing.T) {
	revision, err := CurrentProviderProfile(provider.Claude)
	if err != nil {
		t.Fatalf("CurrentProviderProfile: %v", err)
	}

	resolved, err := ResolveProviderProfile(
		revision.Digest, revision.Digest,
		revision.Profile.ExecutableSHA256)
	if err != nil {
		t.Fatalf("ResolveProviderProfile: %v", err)
	}
	if resolved.Digest != revision.Digest {
		t.Fatalf("resolved digest = %s, want %s", resolved.Digest, revision.Digest)
	}
	if resolved.Profile.Provider != provider.Claude {
		t.Fatalf("resolved provider = %s, want %s", resolved.Profile.Provider, provider.Claude)
	}

	tests := []struct {
		name     string
		bound    string
		profile  string
		artifact string
		want     error
	}{
		{"policy revision disagreement", revision.Digest, strings.Repeat("0", 64), revision.Profile.ExecutableSHA256, ErrProviderProfilePolicy},
		{"unknown profile", strings.Repeat("0", 64), strings.Repeat("0", 64), revision.Profile.ExecutableSHA256, ErrProviderProfileDigest},
		{"uppercase profile", revision.Digest, strings.ToUpper(revision.Digest), revision.Profile.ExecutableSHA256, ErrProviderProfileDigest},
		{"malformed profile", revision.Digest, "sha256:wrong", revision.Profile.ExecutableSHA256, ErrProviderProfileDigest},
		{"artifact mismatch", revision.Digest, revision.Digest, strings.Repeat("0", 64), ErrProviderProfileArtifact},
		{"malformed artifact", revision.Digest, revision.Digest, "/host/claude", ErrProviderProfileArtifact},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ResolveProviderProfile(
				test.bound, test.profile, test.artifact)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestCurrentProviderProfileRejectsUnsupportedProvider(t *testing.T) {
	_, err := CurrentProviderProfile(provider.Codex)
	if !errors.Is(err, ErrUnsupportedProviderProfile) {
		t.Fatalf("error = %v, want ErrUnsupportedProviderProfile", err)
	}
	if strings.Contains(err.Error(), string(provider.Codex)) {
		t.Fatalf("error echoes caller input: %v", err)
	}
}

func TestProviderProfileRejectsCallerControlledLaunchFields(t *testing.T) {
	base, err := builtInProviderProfile(provider.Claude)
	if err != nil {
		t.Fatalf("builtInProviderProfile: %v", err)
	}
	tests := []struct {
		name   string
		mutate func(*ProviderProfileV1)
	}{
		{"absolute host path", func(p *ProviderProfileV1) { p.RuntimeRelativeExecutable = "/usr/local/bin/claude" }},
		{"parent traversal", func(p *ProviderProfileV1) { p.RuntimeRelativeExecutable = "../bin/claude" }},
		{"empty component", func(p *ProviderProfileV1) { p.RuntimeRelativeExecutable = "usr//claude" }},
		{"non-ascii executable", func(p *ProviderProfileV1) { p.RuntimeRelativeExecutable = "usr/local/bin/clаude" }},
		{"unsupported schema", func(p *ProviderProfileV1) { p.Schema = "noisedeck.provider-profile.v2" }},
		{"non-ascii descriptor", func(p *ProviderProfileV1) { p.DescriptorRevision = "claude-vа" }},
		{"uppercase digest", func(p *ProviderProfileV1) { p.ExecutableSHA256 = strings.ToUpper(p.ExecutableSHA256) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := base
			test.mutate(&candidate)
			if _, err := canonicalizeProviderProfile(candidate); !errors.Is(err, ErrInvalidProviderProfile) {
				t.Fatalf("error = %v, want ErrInvalidProviderProfile", err)
			}
		})
	}
}

func TestProviderProfileRevisionCoversEveryAuthorityField(t *testing.T) {
	base, err := builtInProviderProfile(provider.Claude)
	if err != nil {
		t.Fatalf("builtInProviderProfile: %v", err)
	}
	revision, err := canonicalizeProviderProfile(base)
	if err != nil {
		t.Fatalf("canonicalizeProviderProfile: %v", err)
	}
	mutations := []func(*ProviderProfileV1){
		func(p *ProviderProfileV1) { p.Provider = provider.Kimi },
		func(p *ProviderProfileV1) { p.DescriptorRevision = "claude-assigned-identity.v1.1" },
		func(p *ProviderProfileV1) { p.TestedVersion = "2.1.221" },
		func(p *ProviderProfileV1) { p.RuntimeRelativeExecutable = "usr/local/bin/claude-next" },
		func(p *ProviderProfileV1) { p.ExecutableSHA256 = strings.Repeat("0", 64) },
	}
	for i, mutate := range mutations {
		candidate := base
		mutate(&candidate)
		changed, err := canonicalizeProviderProfile(candidate)
		if err != nil {
			t.Fatalf("mutation %d: %v", i, err)
		}
		if changed.Digest == revision.Digest {
			t.Errorf("mutation %d did not change digest", i)
		}
	}
}

func TestClaudeProviderProfileMatchesPinnedRuntimeImage(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "Dockerfile"))
	if err != nil {
		t.Fatalf("read Dockerfile: %v", err)
	}
	revision, err := CurrentProviderProfile(provider.Claude)
	if err != nil {
		t.Fatalf("CurrentProviderProfile: %v", err)
	}
	wants := []string{
		"ARG CLAUDE_CODE_VERSION=" + revision.Profile.TestedVersion,
		"-o /usr/local/bin/claude",
	}
	switch runtime.GOARCH {
	case "amd64":
		wants = append(wants, "ARG CLAUDE_BINARY_SHA256_AMD64="+revision.Profile.ExecutableSHA256)
	case "arm64":
		wants = append(wants, "ARG CLAUDE_BINARY_SHA256_ARM64="+revision.Profile.ExecutableSHA256)
	}
	for _, want := range wants {
		if !strings.Contains(string(body), want) {
			t.Errorf("Dockerfile does not contain %q", want)
		}
	}
}
