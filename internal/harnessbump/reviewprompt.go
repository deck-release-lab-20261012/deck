package harnessbump

import (
	"bytes"
	"errors"
)

// VerifyReviewPrompt binds the dispatcher's mutable PR diff to the immutable
// compare diff fetched for the selected base and head. Truncation fails closed.
func VerifyReviewPrompt(prompt, diff []byte) error {
	if len(diff) == 0 || len(diff) > 102400 || len(prompt) > 2<<20 {
		return errors.New("review input is empty, truncated or oversized")
	}
	// The dispatcher's HTTP-status extraction preserves the response body's
	// final newline; its renderer adds another before the closing fence.
	// Also accept callers that strip trailing newlines via shell substitution.
	// Every diff byte other than those terminal newlines must still match.
	for _, body := range [][]byte{diff, bytes.TrimRight(diff, "\n")} {
		expected := append([]byte("\n## Diff\n\n```diff\n"), body...)
		expected = append(expected, []byte("\n```")...)
		if bytes.HasSuffix(bytes.TrimRight(prompt, "\n"), expected) {
			return nil
		}
	}
	return errors.New("dispatcher diff does not match the selected base and head")
}
