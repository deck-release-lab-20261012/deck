# Provider logo usage decision

**Decision (2026-08-06):** We assess that using provider brand marks in the
session UI to indicate which vendor's CLI a session runs is defensible as
nominative use, subject to the constraints below and to per-mark copyright
clearance at adoption time. Until then, the letter chips with per-provider
identity colors remain the shipped treatment; adopting any mark is deferred
to the Workspace-4 design pass. This document covers the
trademark analysis; **artwork copyright is cleared per mark at adoption**
(a mark ships only when both legs are satisfied).

## Findings (our analysis unless attributed)

- lobehub/lobe-icons packages provider SVGs under MIT (repo LICENSE;
  @lobehub/icons npm license field). The project states no trademark
  caveat anywhere we could find; the observation that an MIT grant on an
  icon package cannot convey third-party trademark rights is OUR analysis,
  not an upstream statement. Copyright in each logo's artwork is a
  separate question the MIT package does not clearly settle for
  third-party marks it redistributes.
- opencode (anomalyco/opencode, MIT) is the exception: it ships an official
  brand asset kit inside the MIT repo
  (packages/console/app/src/asset/brand/, incl. opencode-brand-assets.zip)
  — a distributed permissively-licensed kit, so both the copyright and the
  implied-permission posture for opencode marks are materially better than
  for the other vendors.
- Vendor policy checks are NOT completed. Attempts on 2026-08-06 from this
  environment: openai.com/brand returned 403; anthropic.com/legal/trademark
  404; Moonshot brand terms not located. Per-vendor answers with URLs must
  be recorded here before any of those marks is adopted (constraint 4 makes
  an unrecorded check unusable).

## Constraints that keep this nominative

1. Marks label sessions/providers running that vendor's actual CLI — never
   our own branding, app icon, or marketing surface.
2. Proportional scaling only. No recoloring except variants the vendor's
   own kit provides; if a mark is illegible on our surfaces without
   modification, use the letter chip instead.
3. No implication of sponsorship or endorsement.
4. Before adopting a specific mark: record here the vendor's brand/terms
   URL and what it says, plus the copyright basis for the artwork file we
   ship. A vendor objection or forbidding guideline removes the mark
   immediately (letter chips are the permanent fallback).
5. Internal, non-sold operator tool today; if the product is distributed or
   sold, this decision is void and must be redone.

## Status

No mark ships under this decision yet. opencode's kit is the likely first
adoption in the workspace design pass; Anthropic/OpenAI/Moonshot marks stay
letter chips until their per-vendor rows above are filled in.
