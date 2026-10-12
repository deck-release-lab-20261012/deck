package project

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

// Per-project file access is limited to list, read, upload, and download.

const (
	// MaxUploadBytes bounds one uploaded file.
	MaxUploadBytes = 32 << 20
	// MaxRequestBytes includes room for multipart framing around a maximum-size file.
	MaxRequestBytes = MaxUploadBytes + (1 << 20)
	// maxTextViewBytes bounds what the text viewer returns.
	maxTextViewBytes = 1 << 20
	// maxEntries bounds one directory listing.
	maxEntries = 2000
)

var (
	// ErrOutsideProject is a path that references outside its project root.
	ErrOutsideProject = errors.New("path is outside the project")
	// ErrFileNotFound is a path that does not exist inside the project.
	ErrFileNotFound = errors.New("no such file in the project")
	// ErrNotRegularFile is a request to read something that is not a file.
	ErrNotRegularFile = errors.New("not a regular file")
	// ErrTooLarge is a file past the viewer's bound.
	ErrTooLarge = errors.New("file is too large to view")
	// ErrUploadTooLarge is an upload past its file or request bound.
	ErrUploadTooLarge = errors.New("upload is too large")
	// ErrNotText is a file whose bytes are not valid UTF-8.
	ErrNotText = errors.New("file is not text")
	// ErrUploadExists is a destination that already holds something and was
	// not explicitly approved for replacement.
	ErrUploadExists = errors.New("destination already exists")
	// ErrUploadChanged is a replacement whose target no longer matches the
	// file the operator approved destroying.
	ErrUploadChanged = errors.New("destination changed since replacement was approved")
)

// UploadConsent names the existing file an operator approved replacing, by
// the opaque version the server observed when it reported the collision.
// The version is folded from the kernel's identity for the name — device
// and inode, the file type, the size, and modification and change times at
// nanosecond resolution — so neither a different file planted under the
// same name nor an in-place rewrite satisfies an approval taken for the
// file the operator saw, even when size and mtime are reproduced exactly.
// Only the server computes it; the client returns it verbatim.
type UploadConsent struct {
	Version string
}

// UploadConflict reports a destination the upload refused to touch. The
// metadata fields carry what the listing would disclose, observed at the
// moment of refusal, so the operator can be asked with current facts
// rather than a stale browser listing. Version is the opaque identity of
// whatever holds the name now; sending it back as consent is what
// approves a replacement, and every refusal reports a fresh one.
type UploadConflict struct {
	// Leaf is the destination's own name inside its directory.
	Leaf string
	// Dir reports a directory holding the name. A directory is never
	// replaceable, with or without consent.
	Dir bool
	// NotFile reports a symlink or special file holding the name. Only a
	// regular file is ever replaceable: destroying a link or a device by
	// renaming over it removes something whose kind the listing never
	// showed the operator.
	NotFile bool
	// Changed reports that replacement consent was presented but no
	// longer matches what holds the name: the operator approved a
	// different file than the one a replacement would destroy.
	Changed bool
	// Version is the opaque identity the server observed for whatever
	// holds the name; returned as consent it approves a replacement.
	Version string
	// Size and MTime describe what holds the name now. For a symlink they
	// describe the link itself, never its target — the same rule the
	// listing follows.
	Size  int64
	MTime time.Time
}

func (c *UploadConflict) Error() string {
	if c.Dir {
		return fmt.Sprintf("%s: a folder holds this name", c.Leaf)
	}
	if c.NotFile {
		return fmt.Sprintf("%s: not a regular file", c.Leaf)
	}
	if c.Changed {
		return fmt.Sprintf("%s: %s", c.Leaf, ErrUploadChanged.Error())
	}
	return fmt.Sprintf("%s: %s", c.Leaf, ErrUploadExists.Error())
}

func (c *UploadConflict) Unwrap() error {
	if c.Dir || c.NotFile {
		return ErrNotRegularFile
	}
	if c.Changed {
		return ErrUploadChanged
	}
	return ErrUploadExists
}

// FileEntry is one item in a project directory listing.
type FileEntry struct {
	// Name is the entry's own name, never a path.
	Name string `json:"name"`
	// Path is relative to the project root and slash-separated.
	Path  string `json:"path"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size,omitempty"`
	Mode  string `json:"mode"`
	MTime string `json:"mtime"`
}

// FileListing is one directory inside a project.
type FileListing struct {
	// Path is the listed directory relative to the project root; "" is
	// the root itself.
	Path    string      `json:"path"`
	Parent  string      `json:"parent,omitempty"`
	AtRoot  bool        `json:"at_root"`
	Entries []FileEntry `json:"entries"`
	// Truncated reports that the directory holds more than maxEntries.
	Truncated bool `json:"truncated,omitempty"`
}

// checkRelative refuses a path that is absolute or walks upward, before
// cleaning can remove those components.
func checkRelative(rel string) error {
	if rel == "" {
		return nil
	}
	if strings.HasPrefix(rel, "/") || filepath.IsAbs(filepath.FromSlash(rel)) {
		return fmt.Errorf("%w: %q is absolute", ErrOutsideProject, rel)
	}
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if seg == ".." {
			return fmt.Errorf("%w: %q walks outside", ErrOutsideProject, rel)
		}
	}
	return nil
}

func cleanRelative(rel string) string {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == "." {
		return ""
	}
	return filepath.ToSlash(clean)
}

func rootName(rel string) string {
	clean := cleanRelative(rel)
	if clean == "" {
		return "."
	}
	return filepath.FromSlash(clean)
}

func mapRootOpenError(err error) error {
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) {
		return ErrFileNotFound
	}
	if errors.Is(err, syscall.ELOOP) {
		return fmt.Errorf("%w: symbolic link refused", ErrOutsideProject)
	}
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		var errno syscall.Errno
		if !errors.As(pathErr.Err, &errno) {
			return fmt.Errorf("%w: %v", ErrOutsideProject, err)
		}
	}
	return err
}

type fileAccessHooks struct {
	rootAnchored func()
	targetOpened func()
	parentOpened func()
	// targetMissing lets tests place a competing file after the absence check.
	targetMissing func()
	// conflictVerified runs after replacement consent has been verified
	// against the live target and immediately before the swap that
	// destroys it — the last point at which another writer can still
	// take the name.
	conflictVerified func()
}

func openProjectPath(projectRoot, rel string, directory bool, hooks fileAccessHooks) (*os.File, error) {
	if err := checkRelative(rel); err != nil {
		return nil, err
	}
	root, err := openProjectRoot(projectRoot, hooks.rootAnchored)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	f, err := openRootPath(root, rootName(rel), directory)
	if err != nil {
		return nil, mapRootOpenError(err)
	}
	if hooks.targetOpened != nil {
		hooks.targetOpened()
	}
	return f, nil
}

// ListFiles lists one directory inside a project.
func ListFiles(projectRoot, rel string) (*FileListing, error) {
	return listFiles(projectRoot, rel, fileAccessHooks{})
}

func listFiles(projectRoot, rel string, hooks fileAccessHooks) (*FileListing, error) {
	dir, err := openProjectPath(projectRoot, rel, true, hooks)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	info, err := dir.Stat()
	if err != nil {
		return nil, ErrFileNotFound
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%w: %q is a file", ErrFileNotFound, rel)
	}

	names, err := dir.ReadDir(maxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("read %q: %w", rel, err)
	}
	listingPath := cleanRelative(rel)
	listing := &FileListing{
		Path:    listingPath,
		AtRoot:  listingPath == "",
		Entries: make([]FileEntry, 0, len(names)),
	}
	if !listing.AtRoot {
		listing.Parent = filepath.ToSlash(filepath.Dir(listing.Path))
		if listing.Parent == "." {
			listing.Parent = ""
		}
	}
	if len(names) > maxEntries {
		listing.Truncated = true
		names = names[:maxEntries]
	}
	for _, e := range names {
		fi, err := e.Info()
		if err != nil {
			continue
		}
		listing.Entries = append(listing.Entries, FileEntry{
			Name:  e.Name(),
			Path:  filepath.ToSlash(filepath.Join(listing.Path, e.Name())),
			Dir:   e.IsDir(),
			Size:  fi.Size(),
			Mode:  fi.Mode().Perm().String(),
			MTime: fi.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
	sort.Slice(listing.Entries, func(i, j int) bool {
		a, b := listing.Entries[i], listing.Entries[j]
		if a.Dir != b.Dir {
			return a.Dir // directories first
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return listing, nil
}

// OpenFile opens a regular file inside a project for download. The caller
// closes it.
func OpenFile(projectRoot, rel string) (*os.File, os.FileInfo, error) {
	return openFile(projectRoot, rel, fileAccessHooks{})
}

func openFile(projectRoot, rel string, hooks fileAccessHooks) (*os.File, os.FileInfo, error) {
	f, err := openProjectPath(projectRoot, rel, false, hooks)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, ErrFileNotFound
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, ErrNotRegularFile
	}
	return f, info, nil
}

// ReadTextFile returns valid UTF-8 contents within the viewer size bound.
func ReadTextFile(projectRoot, rel string) (string, error) {
	return readTextFile(projectRoot, rel, fileAccessHooks{})
}

func readTextFile(projectRoot, rel string, hooks fileAccessHooks) (string, error) {
	f, info, err := openFile(projectRoot, rel, hooks)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if info.Size() > maxTextViewBytes {
		return "", fmt.Errorf("%w: %d bytes, limit %d", ErrTooLarge, info.Size(), maxTextViewBytes)
	}
	body, err := io.ReadAll(io.LimitReader(f, maxTextViewBytes+1))
	if err != nil {
		return "", err
	}
	if len(body) > maxTextViewBytes {
		return "", fmt.Errorf("%w: limit %d", ErrTooLarge, maxTextViewBytes)
	}
	if !utf8.Valid(body) {
		return "", ErrNotText
	}
	return string(body), nil
}

// WriteFile stores an uploaded file inside a project.
//
// It stages in the destination directory and atomically renames the complete
// file into place. A destination that already holds anything is refused with
// an *UploadConflict unless consent carries the opaque version the server
// reported for the file the operator approved replacing; the version is
// recomputed from the live directory after staging, so a target that
// appeared or changed after the approval is re-asked, never silently
// overwritten. A name held by anything but a regular file is never
// replaceable at all.
//
// One window remains and cannot be closed: between the stat that verifies
// the version and the rename that commits, an arbitrary writer can still
// replace the target, and the rename destroys that writer's file. Linux has
// no "rename only this inode" operation, and RENAME_EXCHANGE cannot make
// the swap safe — after exchanging, deciding the swap was wrong and
// exchanging back can destroy a third file that took either name while the
// check ran, so the exchange and its rollback are not used at all. The
// post-staging version recheck is the boundary; the race behind it is the
// honest cost of replacing a file on a shared filesystem.
func WriteFile(projectRoot, rel string, src io.Reader, consent *UploadConsent) (string, int64, error) {
	return writeFile(projectRoot, rel, src, consent, fileAccessHooks{})
}

func writeFile(projectRoot, rel string, src io.Reader, consent *UploadConsent, hooks fileAccessHooks) (string, int64, error) {
	if err := checkRelative(rel); err != nil {
		return "", 0, err
	}
	clean := cleanRelative(rel)
	if clean == "" {
		return "", 0, fmt.Errorf("%w: %q is not a file name", ErrOutsideProject, rel)
	}
	cleanOS := filepath.FromSlash(clean)
	parentName, leaf := filepath.Dir(cleanOS), filepath.Base(cleanOS)
	if leaf == "" || leaf == "." || leaf == ".." || strings.ContainsRune(leaf, filepath.Separator) {
		return "", 0, fmt.Errorf("%w: %q is not a file name", ErrOutsideProject, rel)
	}

	root, err := openProjectRoot(projectRoot, hooks.rootAnchored)
	if err != nil {
		return "", 0, err
	}
	defer root.Close()
	parent, err := openRootPath(root, parentName, true)
	if err != nil {
		return "", 0, mapRootOpenError(err)
	}
	defer parent.Close()
	parentInfo, err := parent.Stat()
	if err != nil || !parentInfo.IsDir() {
		return "", 0, ErrFileNotFound
	}
	if hooks.parentOpened != nil {
		hooks.parentOpened()
	}

	tmp, staged, err := createUploadStage(parent)
	if err != nil {
		return "", 0, fmt.Errorf("stage upload: %w", err)
	}
	committed := false
	defer func() {
		tmp.Close()
		if !committed {
			removeUploadStage(parent, staged)
		}
	}()

	n, err := io.Copy(tmp, io.LimitReader(src, MaxUploadBytes+1))
	if err != nil {
		return "", 0, fmt.Errorf("write upload: %w", err)
	}
	if n > MaxUploadBytes {
		return "", 0, fmt.Errorf("%w: file exceeds %d bytes", ErrUploadTooLarge, MaxUploadBytes)
	}
	if err := tmp.Close(); err != nil {
		return "", 0, fmt.Errorf("close upload: %w", err)
	}
	if err := placeUpload(parent, staged, leaf, consent, hooks); err != nil {
		return "", 0, fmt.Errorf("commit upload: %w", err)
	}
	committed = true
	return clean, n, nil
}
