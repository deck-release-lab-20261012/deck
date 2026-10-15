---
id: core-principles
title: Core principles
group: explore
duration: 1 min
requires: []
---

# Core principles

Deck is an opinionated way of working with native coding harnesses. We provide a set of micro-tools as part of the `noise` suite, that are designed to be agent-first. These are the guiding principles when designing Deck:

1. **Start with a task, not a chat.** Write a brief describing what you want, break it into tasks, and give each agent one task at a time on its own branch.

2. No one reviews their own work. A different model reviews every change before it merges and posts its review on the pull request, just like any other reviewer.

3. Agents can talk to each other. When an agent needs something from another project, it can ask that project’s agent directly. You can follow the conversation without having to relay messages.

4. Sessions keep going when you leave. Close your laptop and pick up the same session on your phone later.

5. Agents share what they learn. What one agent learns is available to the others, across projects and harnesses.

6. Deck leaves the agents alone. It runs Claude Code, Codex, and the rest exactly as their vendors ship them.
