package harnessbump

import (
	"bytes"
	"testing"
)

func TestReviewPromptBindsImmutableDiff(t *testing.T) {
	diff := []byte("diff --git a/Dockerfile b/Dockerfile\n-old\n+new\n")
	prompt := []byte("trusted instructions\n## Diff\n\n```diff\ndiff --git a/Dockerfile b/Dockerfile\n-old\n+new\n```\n")
	if err := VerifyReviewPrompt(prompt, diff); err != nil {
		t.Fatal(err)
	}
	if err := VerifyReviewPrompt(bytes.TrimRight(prompt, "\n"), diff); err != nil {
		t.Fatal("shell command substitution removed the final newline:", err)
	}
	// curl writes body + newline + HTTP status; extracting the status leaves
	// the body's final newline intact. The renderer adds its own newline.
	rendered := bytes.Replace(prompt, []byte("+new\n```"), []byte("+new\n\n```"), 1)
	if err := VerifyReviewPrompt(rendered, diff); err != nil {
		t.Fatal("real dispatcher preserves the HTTP diff body newline:", err)
	}
	for _, changed := range [][]byte{[]byte("next head\n"), nil, append(diff, []byte("another file")...)} {
		if VerifyReviewPrompt(prompt, changed) == nil || VerifyReviewPrompt(rendered, changed) == nil {
			t.Fatal("accepted a raced head or base")
		}
	}
	if VerifyReviewPrompt(append(prompt, []byte("extra diff")...), diff) == nil {
		t.Fatal("accepted bytes after the bound diff")
	}
	if VerifyReviewPrompt(bytes.Replace(rendered, []byte("+new"), []byte("+different"), 1), diff) == nil {
		t.Fatal("accepted changed content in the real renderer shape")
	}
}
