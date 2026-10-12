package provider

import (
	"errors"
	"fmt"
	"strings"
	"syscall"
)

// ShellDescriptor implements Descriptor for an interactive shell.
//
// The shell provider is a deliberate utility — a raw terminal in the project
// directory — never a substitute for a missing provider launch (that fallback
// stays forbidden). Its identity contract is IdentityNone: a shell
// has no native session identity, so nothing is assigned at launch and nothing
// is retrieved afterwards. It is never resumed; a death is recovered by
// relaunching it, which loses nothing because a shell holds no state that
// outlives its process.
//
// bash's interactive behavior is stable in the ways the contract cares about:
// readline honors bracketed paste, Enter submits, and a pasted newline arrives
// as a line boundary. Verified against bash 5.2.15 in a real tmux pane; see
// docs/provider-contracts/shell.yaml.
type ShellDescriptor struct {
	execPath string
}

// The contract below was measured against bash 5.2.15.

// NewShell builds a shell descriptor. execPath must be absolute.
func NewShell(execPath string) (*ShellDescriptor, error) {
	if !strings.HasPrefix(execPath, "/") {
		return nil, fmt.Errorf("provider: shell executable %q must be an absolute path", execPath)
	}
	return &ShellDescriptor{execPath: execPath}, nil
}

func (s *ShellDescriptor) Name() Name                                            { return Shell }
func (s *ShellDescriptor) Executable() string                                    { return s.execPath }
func (s *ShellDescriptor) IdentityContract() IdentityContract                    { return IdentityNone }
func (s *ShellDescriptor) IdentityCaptureMechanisms() []IdentityCaptureMechanism { return nil }

// Availability reports nil: having no native session identity is the shell's
// contract, not a fault.
func (s *ShellDescriptor) Availability() error { return nil }

// NewSessionArgs is the bare executable: tmux sets the pane's working
// directory, and an interactive shell needs no flags. A SessionID in
// the spec is an error — identity-none means there is nothing to assign.
func (s *ShellDescriptor) NewSessionArgs(spec LaunchSpec) ([]string, error) {
	if spec.SessionID != "" {
		return nil, fmt.Errorf(
			"provider: shell is identity-none but a session id %q was supplied", spec.SessionID)
	}
	return []string{s.execPath}, nil
}

// ResumeSessionArgs always fails: identity-none providers have nothing exact
// to resume. The refusal is explicit and recorded, never a guess at
// "the last shell in this directory".
func (s *ShellDescriptor) ResumeSessionArgs(ResumeSpec) ([]string, error) {
	return nil, errors.New("provider: shell sessions are identity-none and cannot be resumed")
}

// Environment sets the prompt and nothing else; the shell otherwise
// inherits the scrubbed pane environment and reads its own startup
// files. The distro default prompt carries user@host and a full path,
// which eats a terminal that is often narrow. \w is bash's own cwd
// expansion — abbreviating $HOME to ~ — so the console is not
// computing or interpreting anything about the shell's state.
//
// The prompt is set through PROMPT_COMMAND rather than PS1 because an
// interactive bash reads its rc files AFTER the environment is applied,
// and Debian's /etc/bash.bashrc and ~/.bashrc both assign PS1
// unconditionally — so an exported PS1 is overwritten before the first
// prompt is ever drawn. PROMPT_COMMAND runs after those files, before
// each prompt, so it survives what PS1 does not. Measured on a real pty:
// exporting PS1 renders `user@host:~$`, PROMPT_COMMAND renders `~ $`.
//
// It is not immune, only later: an rc that assigns PROMPT_COMMAND itself
// would clobber this the same way PS1 was clobbered, and ~ is a
// persistent volume the operator can edit. Nothing in the image does —
// Debian only mentions PROMPT_COMMAND in a comment — so this is where
// the prompt is settled today, not a guarantee about every possible home
// directory.
//
// The cost is that this overrides a prompt the operator set in their own
// rc, every prompt. That is the same presentation decision the console
// was already making, now actually in effect.
//
// PROMPT_COMMAND is deliberately NOT in PermittedEnvironment. That list
// names variables carried in from the SERVICE's environment, and bash
// executes PROMPT_COMMAND as a command before every prompt — inheriting
// one would hand whatever launched the service arbitrary execution in
// the operator's shell. Only this literal value is ever set.
func (s *ShellDescriptor) Environment() []string {
	return []string{`PROMPT_COMMAND=PS1="\w \$ "`}
}

// PermittedEnvironment is an allowlist, same rationale as every provider.
func (s *ShellDescriptor) PermittedEnvironment() []string {
	return []string{"HOME", "PATH", "TERM", "LANG", "LC_ALL"}
}

// RequiredConfigPaths is empty: the shell keeps no identity or credentials.
func (s *ShellDescriptor) RequiredConfigPaths() []string { return nil }

// ExecutableIdentity: bash is a native binary, so /proc/exe matching is
// sufficient.
func (s *ShellDescriptor) ExecutableIdentity() ExecutableIdentity {
	return ExecutableIdentity{Interpreted: false}
}

// Injection reports how input reaches the interactive shell.
//
// Verified against bash 5.2.15(1)-release (readline 8.2) in a real tmux pane;
// see docs/provider-contracts/shell.yaml:
//
//   - bracketed paste + Enter delivers and runs;
//   - a pasted body containing a newline lands in the edit buffer as
//     multiple lines and does NOT run until Enter arrives separately; that
//     Enter then runs the buffered lines in order;
//   - input typed while a foreground command runs is buffered by the tty and
//     read when the command finishes (ActiveTurnQueued);
//   - there is no modal surface; nothing discards input.
func (s *ShellDescriptor) Injection() InjectionContract {
	return InjectionContract{
		UseBracketedPaste:        true,
		SubmitKey:                "Enter",
		SupportsMultiline:        true,
		AcceptsInputDuringTurn:   ActiveTurnQueued,
		DiscardsInputDuringModal: false,
		Verified:                 true,
	}
}

// GracefulStopSignal is SIGHUP; ForceStopSignal is SIGKILL.
//
// Measured: an INTERACTIVE bash ignores SIGTERM (stop signalled, no exit
// observed within the manager's deadline), while SIGHUP is the terminal-
// hangup path a shell is built to exit on.
func (s *ShellDescriptor) GracefulStopSignal() syscall.Signal { return syscall.SIGHUP }
func (s *ShellDescriptor) ForceStopSignal() syscall.Signal    { return syscall.SIGKILL }
