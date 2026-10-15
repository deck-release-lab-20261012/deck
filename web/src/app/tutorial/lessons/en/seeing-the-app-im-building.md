---
id: previews
title: Seeing the app I'm building
group: explore
duration: 3 min
requires: [previews]
---

# Seeing the app I'm building

## Turn previews on for a project
advance_on: continue
primary: Preview…
action: preview-settings

Choose Preview… from the project menu and tell Deck how to start your dev server. Each project gets its own loopback address, such as http://127.0.0.2:8840.

## Start the server and open it
advance_on: continue
primary: Open preview
action: open-preview
command: noise deck preview run

Run the launcher in a terminal in the project, then choose Open preview. Routes, assets, APIs and hot reload work as they do on your machine.

## What previews are not
advance_on: continue

A reachable page is not a passing test. And the dev server runs in the same shared workspace as everything else; previews don't sandbox it.
