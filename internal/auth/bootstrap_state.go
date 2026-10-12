package auth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/crypto/bcrypt"
)

const (
	bootstrapStateVersion  = 1
	generatedPasswordBytes = 24
	sessionSecretBytes     = 32
	passwordHashCost       = 12
)

// BootstrapState is the runtime authentication material consumed by the
// password handler. It contains no plaintext credential.
type BootstrapState struct {
	PasswordHash  []byte
	SessionSecret []byte
}

// BootstrapResult reports whether this boot created new durable state. The
// generated plaintext exists only in the create result so boot can disclose it
// after the durable write; it is never encoded in the state file.
type BootstrapResult struct {
	State             BootstrapState
	GeneratedPassword string
	Created           bool
}

type bootstrapStateFile struct {
	Version       int    `json:"version"`
	PasswordHash  string `json:"password_hash"`
	SessionSecret string `json:"session_secret"`
}

// EnsureBootstrapState loads or atomically creates password-mode state. The
// caller must hold the process-wide backend lock, which serializes creation.
func EnsureBootstrapState(path, suppliedHash string) (BootstrapResult, error) {
	if path == "" {
		return BootstrapResult{}, errors.New("auth: bootstrap state path is empty")
	}
	if suppliedHash != "" {
		if _, err := bcrypt.Cost([]byte(suppliedHash)); err != nil {
			return BootstrapResult{}, fmt.Errorf("auth: supplied password hash: %w", err)
		}
	}
	if _, err := os.Lstat(path); err == nil {
		result, readErr := readBootstrapState(path)
		if readErr != nil {
			return BootstrapResult{}, readErr
		}
		if suppliedHash != "" && suppliedHash != string(result.State.PasswordHash) {
			return BootstrapResult{}, errors.New("auth: supplied password hash does not match durable bootstrap state")
		}
		return result, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return BootstrapResult{}, fmt.Errorf("auth: inspect bootstrap state: %w", err)
	}

	password, err := randomText(generatedPasswordBytes)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: generate bootstrap password: %w", err)
	}
	hash := []byte(suppliedHash)
	if suppliedHash == "" {
		hash, err = bcrypt.GenerateFromPassword([]byte(password), passwordHashCost)
		if err != nil {
			return BootstrapResult{}, fmt.Errorf("auth: hash bootstrap password: %w", err)
		}
	} else {
		password = ""
	}
	secret := make([]byte, sessionSecretBytes)
	if _, err := io.ReadFull(rand.Reader, secret); err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: generate session secret: %w", err)
	}
	encoded, err := json.Marshal(bootstrapStateFile{
		Version:       bootstrapStateVersion,
		PasswordHash:  string(hash),
		SessionSecret: base64.RawURLEncoding.EncodeToString(secret),
	})
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: encode bootstrap state: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := writePrivateOnce(path, encoded, "bootstrap state", ".auth-state-*"); err != nil {
		return BootstrapResult{}, err
	}
	return BootstrapResult{
		State:             BootstrapState{PasswordHash: hash, SessionSecret: secret},
		GeneratedPassword: password,
		Created:           true,
	}, nil
}

func randomText(bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func readBootstrapState(path string) (BootstrapResult, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: inspect bootstrap state: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return BootstrapResult{}, fmt.Errorf("auth: bootstrap state %q must be a regular private file (mode 0600)", path)
	}
	f, err := os.Open(path) // #nosec G304 -- path is derived from the operator-owned runtime database path.
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: open bootstrap state: %w", err)
	}
	defer func() { _ = f.Close() }()
	dec := json.NewDecoder(io.LimitReader(f, 16<<10))
	dec.DisallowUnknownFields()
	var stored bootstrapStateFile
	if err := dec.Decode(&stored); err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: decode bootstrap state: %w", err)
	}
	if stored.Version != bootstrapStateVersion {
		return BootstrapResult{}, fmt.Errorf("auth: unsupported bootstrap state version %d", stored.Version)
	}
	if _, err := bcrypt.Cost([]byte(stored.PasswordHash)); err != nil {
		return BootstrapResult{}, fmt.Errorf("auth: stored password hash: %w", err)
	}
	secret, err := base64.RawURLEncoding.DecodeString(stored.SessionSecret)
	if err != nil || len(secret) != sessionSecretBytes {
		return BootstrapResult{}, errors.New("auth: stored session secret is invalid")
	}
	return BootstrapResult{State: BootstrapState{
		PasswordHash: []byte(stored.PasswordHash), SessionSecret: secret,
	}}, nil
}

func writePrivateOnce(path string, body []byte, label, tempPattern string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("auth: create %s directory: %w", label, err)
	}
	tmp, err := os.CreateTemp(dir, tempPattern)
	if err != nil {
		return fmt.Errorf("auth: create %s temporary file: %w", label, err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	failed := true
	defer func() {
		if failed {
			_ = tmp.Close()
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return fmt.Errorf("auth: protect %s: %w", label, err)
	}
	if _, err := tmp.Write(body); err != nil {
		return fmt.Errorf("auth: write %s: %w", label, err)
	}
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("auth: sync %s: %w", label, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("auth: close %s: %w", label, err)
	}
	if err := os.Link(tmpName, path); err != nil {
		return fmt.Errorf("auth: publish %s: %w", label, err)
	}
	d, err := os.Open(dir) // #nosec G304 -- derived from the operator-owned runtime database path.
	if err != nil {
		return fmt.Errorf("auth: open %s directory: %w", label, err)
	}
	if err := d.Sync(); err != nil {
		_ = d.Close()
		return fmt.Errorf("auth: sync %s directory: %w", label, err)
	}
	if err := d.Close(); err != nil {
		return fmt.Errorf("auth: close %s directory: %w", label, err)
	}
	failed = false
	return nil
}
