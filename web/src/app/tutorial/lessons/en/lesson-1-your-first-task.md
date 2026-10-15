---
id: lesson-1
title: Your first task
group: course
duration: 8 min
requires: []
principles: [1, 6]
---

# Your first task

## Choose a coding agent
advance_on: agent_picked
primary: Choose an agent…
action: choose-agent
footer: Agents here can read everything under /workspace. [What that means](lesson:what-an-agent-can-reach)

Deck runs coding agents in terminals, one session each. Pick the one with your active subscription. If you have multiple, just pick any as a starting point. You can add more after the lesson. You'll use the coding agent to fix a real bug in the next few minutes.

## Create the practice projects
advance_on: starter_created
primary: Create relnotes and start {agent}
action: create-starter
fine_print: Always new folders. If relnotes exists, this one is relnotes-2.
fallback_when: no_git_identity
fallback: Commits as [Set a Git identity…](action:git-identity)
fallback_action: git-identity

relnotes turns a git log into release notes. It comes with Deck, so this works offline and without GitHub.

## Sign in to {agent}
advance_on: session_signed_in
when: agent_needs_login

{agent} opened a sign-in page in your browser. Finish there. If you end up on a localhost page that won't load, Deck will ask you for that address.

## Turn the PRD into tasks
advance_on: task_exists(requirement=1)
opens: tasks
primary: Add PRD… → Generate tasks
action: generate-tasks
generate_count: 2
primary_note: Uses your Claude plan or API key.
fallback: Add the first task by hand
fallback_action: add-task(requirement=1)
fallback_primary_when: no_claude

relnotes has a one-page PRD. Add it, and Deck lists the tasks it describes. The second one depends on the first.

## Ask {agent} to build it
advance_on: input_sent then session_busy
primary: Put it in the terminal
action: insert-prompt
busy_text: {agent} is working. This usually takes a minute.
prompt: |
  Implement requirement 1 in PRD.md: print the Breaking changes section for commits whose body has a line starting with "BREAKING CHANGE:". Change only relnotes.mjs. Leave relnotes.test.mjs alone, run node --test, and tell me the result.

Here's a prompt for the first task. Deck puts it in the terminal. Read it, change it if you like, and press Return to send it. This is the lesson's one model request.

## See what changed
advance_on: file_opened(modified)
opens: files

Open a file {agent} changed. Changed files are marked Modified.

## Check that it works
advance_on: check_exited
primary: Put in a terminal
action: run-command
command: node --test relnotes.test.mjs
pass_text: 2 tests passed
fail_text: 1 test failed. Look at the terminal, or ask {agent} to fix it.

Run the tests in a plain terminal. There is one more test file, for the second task; that one comes in lesson 2.

## Read the diff and close the task
advance_on: task_done
command: git diff
primary: Mark task done
action: mark-task-done

The diff is every line {agent} changed. When you're happy, mark the task done.

## done
next: lesson-2

Lesson 1 is done. relnotes now prints a Breaking changes section, and there is a test for it.
