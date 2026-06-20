# ADR 005: Case Tracking

## Status: Accepted

## Context

SBS observations ([ADR 003](003-data-model.md)) record state — what's
currently true about a street, as of the last audit. They don't, and
shouldn't, record process: who's looking at a problem, what's been tried,
what's blocking it, or when it's expected to be fixed. As the project
picks up real incidents and requests (not just initial-audit findings),
that process needs somewhere to live — triage, ownership, an interim
workaround if one exists, and an eventual resolution — separate from the
observation state model so the two don't get conflated. The work item
itself is referred to as a "Case" specifically to avoid colliding with
SBS's existing taxonomy term "issue" (a `road`/`litter`/etc. category on
an observation) when both are discussed together.

## Decision

Track Cases as **GitHub Issues**, using a dedicated Issue Form
(`.github/ISSUE_TEMPLATE/case.yml`) labelled `case`, with **GitHub
Projects (v2)** as the board/workflow layer on top of them, rather than
adopting a third-party case-tracking platform.

A Case links to an SBS observation, when relevant, via a **documented
text convention**, not a hard foreign key:

- `Tracks: streets/{street-id} observation #{id}` in the Case's
  description.
- `Follows-from: #{issue-number}` when a Case is a recurrence of a
  problem an earlier Case already resolved.

The observation gains an optional `tracking_issue` field (documented in
[docs/data-taxonomy.md](../docs/data-taxonomy.md)) to record the Case
number once one exists. No retroactive backfill onto existing
observations, and no automation linking the two systems — when a Case
closes, updating the observation's `status` to `resolved` is a manual
step, the same as every other observation edit.

This is a hard link in spirit, not in tooling: GitHub Issues and the
street JSON files are separate systems with no shared schema, and
building sync tooling to enforce the link would reintroduce the kind of
cross-system sync overhead the rest of the data model already avoids
(see [ADR 004](004-data-update-strategy.md)).

## Alternatives Considered

- **FixMyStreet / Open311** — a purpose-built civic-issue-tracking
  platform with resident-facing reporting. Deferred: it carries real
  hosting and integration overhead (its own server, its own data store,
  a sync path back into SBS) that's only justified once reports are
  coming from the public at scale, not from a single steward's own
  audits. Documented as the natural next step if that changes, not ruled
  out permanently.
- **Notion database** — would give a nicer kanban-style board out of the
  box, but introduces a second system of record alongside git, with the
  same sync-overhead problem ADR 004 already chose to avoid for OSM and
  statistics data. Rejected for the same reason: every additional system
  that needs to stay in sync with the git-based data store is a future
  drift risk, not a one-time cost.
- **Hard foreign key between Issues and observation JSON** (e.g. a script
  that writes `tracking_issue` automatically via the GitHub API on Case
  creation, or validates the link on CI) — rejected for now as more
  automation than the current single-maintainer scale justifies. Revisit
  if the volume of Cases makes manual linking error-prone enough to be
  worth the tooling.

## Consequences

- Case history (comments, assignment, linked PRs, close/reopen events)
  lives in GitHub's native Issue timeline for free — no separate audit
  log to build or maintain.
- The link between a Case and an observation is manual and
  convention-based: nothing prevents a typo'd street id, a missing
  `tracking_issue` update, or a Case closing without the observation
  ever being marked `resolved`. This is an accepted gap, not an oversight
  — see ADR 004 for the same trade-off made elsewhere in this project.
- Recurrence lineage (`Follows-from:`) becomes visible over time as a
  project-wide pattern (which kinds of problems keep coming back) rather
  than something only visible by reading one street's observation
  history.
- The Project (v2) board has since been created — named "SBS Cases",
  built from GitHub's "Bug tracker" template with columns To Triage,
  Backlog, Ready, In Progress, In Review, and Done (see
  [case-tracking.md](../docs/case-tracking.md)). Creating it, the `case`
  label, and any milestones were manual/authenticated steps outside the
  original change that produced the template and this ADR — they were
  done separately, once the workflow they'd support was already
  documented.
- If SBS later needs resident-facing reporting, FixMyStreet/Open311
  becomes the natural migration target; this ADR doesn't block that, it
  just declines to build it before there's demand for it.
