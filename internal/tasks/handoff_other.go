//go:build !linux

package tasks

func runGenerationHandoff([]string) error {
	return ErrGenerationUnsupported
}
