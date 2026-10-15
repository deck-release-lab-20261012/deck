---
id: reviewer
title: A pull request that needs a reviewer who isn't me
group: explore
duration: 4 min
requires: [github]
---

# A pull request that needs a reviewer who isn't me

## Why a bot identity
advance_on: continue

GitHub won't let an account approve its own pull request. If every agent signs in as you, a review from a different model can only be a comment. The noise review app gives reviews their own identity, noise-review[bot], so an approval counts.

## Create the app once
advance_on: continue
command: noise review verify-setup

Create a GitHub app for your account, install it on the repositories you want reviewed, and put its id, installation id and private key where Deck can read them. The setup guide walks through it, and verify-setup checks each step.

## Request a review
advance_on: continue
primary: Request review
action: request-review

Request review on any pull request Deck opened. It picks a model other than the one that wrote the change, gives it the diff, and posts the verdict on the pull request. Exit codes tell you whether it approved or asked for changes.
