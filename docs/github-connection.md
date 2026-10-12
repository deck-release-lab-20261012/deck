# Connect GitHub

Choose **Connect GitHub** during Git identity setup, or **GitHub connection…**
from the global three-dot menu. Opening the dialog reads the active account;
it does not start authentication. You can connect before creating a project
or saving a Git author identity.

Choose **Connect GitHub** to run the installed GitHub CLI in Deck's runtime.
Follow the native terminal instructions, including the displayed code and
browser link. You do not need GitHub CLI on the computer running your browser.
The CLI handles consent, credential storage and its Git credential-helper
prompt. Choose **Read status** after finishing; a process ending alone does
not establish that login succeeded.

Closing the dialog leaves the current sign-in running. Reopen to attach to the
same attempt. **Take control** deliberately transfers input from another
browser. **Cancel sign-in** stops only the verified process belonging to that
attempt. A disconnected or uncertain action is never retried automatically;
read status before acting again. If launch itself could not be confirmed, Deck
retains an unavailable attempt and blocks another launch in that backend.
Inspect the native runtime before restarting Deck to clear that uncertainty.
A backend restart loses the temporary attempt
handle and disconnects its browser terminal; Deck does not adopt or kill old
login processes by name. Resolve an interrupted native login in the runtime
before starting another if its outcome is unclear.

A healthy active account is preserved. A failed, stored active credential can
be reconnected explicitly. Environment credentials such as `GH_TOKEN` retain
the GitHub CLI's normal precedence and cannot be replaced by this dialog;
change them in your deployment. Unknown credential sources and ambiguous
status require attention through the native CLI. Git author identity remains
separate from GitHub authentication.

This flow supports GitHub.com and requires authenticated Deck access. An
installation explicitly using `auth.mode: none` must enable an authenticated
mode before using this principal-bound flow. Organization SSO and repository
access remain governed by the account's GitHub permissions; an absent or
inaccessible repository does not establish why access was denied.

Real account consent, organization SSO, credential persistence, fresh helper
setup and new private HTTPS clones remain operator qualification gates until
recorded against the deployed candidate. Automated tests use isolated tmux
sockets and synthetic CLI fixtures; they do not exercise your credentials.
