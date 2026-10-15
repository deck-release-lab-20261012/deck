---
id: lesson-3
title: Your own code
group: course
duration: 8 min
requires: [github]
principles: [1, 2, 4]
---

# Your own code

## Bring your own code
advance_on: project_opened(source=github)
primary: Add project…
action: add-project

Import one of your repositories. Pick something small enough that one change is easy to check. Deck signs in to GitHub with its own copy of the GitHub CLI, so there is nothing to install on this computer.

## Give it a brief
advance_on: task_exists
opens: tasks
primary: Add PRD… → Generate tasks
action: generate-tasks
primary_note: Uses your Claude plan or API key.
fallback: Add task…
fallback_action: add-task
fallback_primary_when: no_claude

Write a short brief for something you want changed, or use one you already have. Deck turns it into tasks. If you'd rather, add one task by hand. If you can't think of anything, try: generate release notes for the last tag with relnotes.

## Give it a branch
advance_on: lane_session_attached
primary: Start a lane
action: start-lane

Each task gets its own worktree and branch. Nothing happens on main. Start a lane claims the task, creates the branch, and opens a session in it.

## Ask for the change
advance_on: input_sent then session_busy
primary: Put it in the terminal
action: insert-prompt
busy_text: {agent} is working.
prompt: |
  You're on a branch for one task: "{task.title}". {task.description} Make the change, keep it small, run the tests, and open a pull request when they pass. Tell me the pull request number.

Here's a prompt built from your task. Read it, change what you like, and press Return.

## A reviewer that isn't the author
advance_on: review_seen
primary: Request review
action: request-review
note_when: no_review_app
note: Without the review app, the review is posted as a comment rather than a formal review. The Explore chapter "A pull request that needs a reviewer who isn't me" shows how to set it up.

No agent reviews its own work. Request review asks a different model to read the pull request and post what it finds. When the review app is set up, that lands as a real review under noise-review[bot].

## Finish
advance_on: task_done
primary: Mark task done
action: mark-task-done

Merge the pull request when you're happy with it, then mark the task done. Deck removes the branch and worktree.

## See your release notes
advance_on: check_exited
when: starter_exists
primary: Put in a terminal
action: run-command
command: node {starter.relnotes}/relnotes.mjs
command_note: Runs relnotes from the practice project against this repository.

relnotes from lesson 1 works on any repository. Run it here to see the release notes for the commits since your last tag.

## done
next: all-lessons

Lesson 3 is done. You landed a change on your own repository from its own branch, and a different model reviewed it.
