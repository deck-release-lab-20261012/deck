---
id: lesson-2
title: Two agents, one bug
group: course
duration: 6 min
requires: [agent-chat, two-sessions]
principles: [3, 4, 5]
---

# Two agents, one bug

## The second task
advance_on: task_exists(requirement=2)
opens: tasks
fallback: Add the second task by hand
fallback_action: add-task(requirement=2)
fallback_when: no_task(requirement=2)

The second task from the PRD is already on the board: the `!` marker in a commit subject isn't treated as breaking. It was blocked on the first task. Now it's ready.

## Start the other agent
advance_on: session_attached(project=ccparse) then input_sent
primary: Start {agent} in ccparse
action: start-session(project=ccparse)
then_primary: Put it in the terminal
then_action: insert-prompt
prompt: |
  You own the ccparse project. Wait for a message from the relnotes agent (use a2a). When it arrives, fix what it reports, add a test for it, bump the version in package.json, tag the release, and reply with the version number.

relnotes gets its commit parsing from ccparse, a separate project with its own agent. Start one there and give it this prompt. It will wait to be asked for something.

## Ask the relnotes agent to find it
advance_on: input_sent(project=relnotes)
primary: Put it in the terminal
action: insert-prompt
prompt: |
  Work on task 2 in PRD.md: commits like "feat(api)!: drop v1" should be listed under Breaking changes. Find the cause. If it's in ccparse, use a2a to ask the ccparse agent to fix it and tag a release, wait for the reply, update ccparse.pin to the new version, and run node --test.

Back in relnotes. This prompt asks the agent to find the cause and, if the cause is somewhere else, to go ask. Two model requests this lesson, one per agent.

## Watch them talk
advance_on: chat_message_seen then page_reloaded(session_live)
opens: chats

The Chats panel shows the two agents talking. You're not in this conversation and you don't need to be. While they work, close this tab. Come back in a minute.

## Proof
advance_on: check_exited
primary: Put in a terminal
action: run-command
command: node --test
pass_text: 3 tests passed
fail_text: 1 test failed. Look at the relnotes terminal first, then the ccparse one.

Run the relnotes tests again.

## done
next: lesson-3

Lesson 2 is done. The bug was in ccparse, so that's where it was fixed and tagged, by an agent you never typed to. relnotes picked up the new version and its tests pass.
