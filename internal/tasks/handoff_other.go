//go:build !linux

package tasks

import "errors"

func runGenerationHandoff([]string) error {
	return errors.Join(ErrUnsafeTree, errRootedTaskAccessUnsupported)
}
