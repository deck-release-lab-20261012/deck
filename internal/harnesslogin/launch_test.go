package harnesslogin

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestLaunchRequiresShippedVersionAndPreservesCustomBrowser(t *testing.T) {
	dir := t.TempDir()
	opener := filepath.Join(dir, "opener")
	native := filepath.Join(dir, "dist", "bundle", "cli.js")
	if err := os.MkdirAll(filepath.Dir(native), 0700); err != nil {
		t.Fatal(err)
	}
	writePiModuleFixtures(t, dir, piVersion)
	for _, p := range []string{opener, native} {
		if err := os.WriteFile(p, []byte("#!/bin/sh\necho '"+piVersion+"'\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("BROWSER", "")
	call := func(provider string, env []string) []string {
		return launchEnvironment(context.Background(), provider, native, "/fixture/register.sock", env, opener)
	}
	env := call("pi", nil)
	if !slices.Contains(env, "BROWSER="+opener) || !slices.Contains(env, "NOISEDECK_LOGIN_SOCKET=/fixture/register.sock") {
		t.Fatal("reviewed launch missing opener")
	}
	for _, name := range []string{"codex", "cline", "shell", "unknown"} {
		if len(call(name, nil)) != 0 {
			t.Fatal("unreviewed version or harness received opener")
		}
	}
	for _, extra := range [][]string{{"PATH=/custom"}, {"BROWSER=/custom"}} {
		if len(call("pi", extra)) != 0 {
			t.Fatal("custom descriptor environment replaced")
		}
	}
	t.Setenv("BROWSER", "/custom/browser")
	if len(call("pi", nil)) != 0 {
		t.Fatal("operator browser replaced")
	}
}

func TestMissingOpenerAndUnboundedVersionOutputStayNative(t *testing.T) {
	dir := t.TempDir()
	native := filepath.Join(dir, "native")
	if err := os.WriteFile(native, []byte("#!/bin/sh\nwhile true; do echo unexpected; done\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BROWSER", "")
	if env := launchEnvironment(context.Background(), "pi", native, "/fixture.sock", nil, filepath.Join(dir, "missing")); len(env) != 0 {
		t.Fatal("missing opener enabled handoff")
	}
	if env := launchEnvironment(context.Background(), "codex", native, "/fixture.sock", nil, native); len(env) != 0 {
		t.Fatal("oversized version output enabled handoff")
	}
}

func writePiModuleFixtures(t *testing.T, root, oauthVersion string) {
	t.Helper()
	for path, text := range map[string]string{
		filepath.Join(root, "package.json"):                                             `{"name":"@earendil-works/pi-coding-agent","version":"` + piVersion + `"}`,
		filepath.Join(root, "node_modules", "@earendil-works", "pi-ai", "package.json"): `{"name":"@earendil-works/pi-ai","version":"` + oauthVersion + `"}`,
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPiAuthModuleVersionMustMatchShippedCLI(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(root, "dist", "bundle", "cli.js")
	if err := os.MkdirAll(filepath.Dir(executable), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte("#!/bin/sh\necho "+piVersion+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	writePiModuleFixtures(t, root, "0.85.2")
	if shippedPiModules(executable) {
		t.Fatal("unreviewed OAuth dependency admitted under a reviewed CLI version")
	}
	writePiModuleFixtures(t, root, piVersion)
	if !shippedPiModules(executable) {
		t.Fatal("reviewed native module installation rejected")
	}
}

func TestCodexVersionPrintingScriptCannotQualifyAsNativeOwner(t *testing.T) {
	executable := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\necho 'codex-cli "+codexVersion+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if ShippedCodexExecutable(context.Background(), executable) != "" {
		t.Fatal("version-printing helper admitted as native Codex")
	}
	if ShippedCodexExecutable(context.Background(), "/bin/true") != "" {
		t.Fatal("unreviewed native executable admitted")
	}
}
