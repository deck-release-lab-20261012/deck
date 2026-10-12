//go:build !linux

package project

import (
	"errors"
	"os"
)

var errProjectFilesUnsupported = errors.New("project file access is unsupported on this platform")

func openProjectRoot(string, func()) (*os.Root, error) {
	return nil, errProjectFilesUnsupported
}

func openRootPath(*os.Root, string, bool) (*os.File, error) {
	return nil, errProjectFilesUnsupported
}

func createUploadStage(*os.File) (*os.File, string, error) {
	return nil, "", errProjectFilesUnsupported
}

func removeUploadStage(*os.File, string) {}

func placeUpload(*os.File, string, string, *UploadConsent, fileAccessHooks) error {
	return errProjectFilesUnsupported
}
