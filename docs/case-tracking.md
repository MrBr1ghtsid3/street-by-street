# Case Tracking

SBS records two different kinds of thing, and they are tracked in two
different systems on purpose. This page covers the second one.

## State vs. process

**SBS observations** (`data/streets/*.json`, see
[data-taxonomy.md](data-taxonomy.md)) record *state* — what's currently
true about a street. A pothole observation says "this exists, here, as of
this date, status `open`." It doesn't track who's looking at it, what was
tried, or when it's expected to be fixed. It's a snapshot, refreshed by a
person walking the street again.

**Cases** (GitHub Issues, labelled `case`) record *process* — the
lifecycle of getting something resolved. A Case has ownership, a
workaround, a target date, and a resolution summary. It exists from
triage through to close.

The name "Case" is deliberate, not decorative: SBS already uses "issue" as
a taxonomy term (`type: "issue"`, covering categories like `road` and
`litter`). Calling the process-tracking layer "Cases" instead of "Issues"
avoids a collision between "an issue on a street" and "an Issue in GitHub"
when both are being discussed in the same sentence.

A Case can optionally link back to a specific observation, but the two
records don't merge — the observation stays a state snapshot, the Case
stays a process record, and the link between them is a citation, not a
shared schema.

## Why GitHub Issues, not a third-party platform

GitHub Issues was chosen over a dedicated case-tracking platform
(FixMyStreet, Open311, a Notion database) for three reasons, expanded on
in [ADR 005](../decisions/005-case-tracking.md):

- **Cost** — no new hosting, subscription, or account to maintain for a
  single-maintainer project.
- **Integration** — Cases reference commits, PRs, and other Issues
  natively; no webhook or sync job is needed to keep two systems
  consistent.
- **Audit-trail consistency** — the rest of the project's decisions and
  history already live in git (commits, PRs, ADRs in `decisions/`).
  Putting process-tracking in the same platform keeps the project's full
  history in one place instead of splitting it across git and an external
  tracker.

FixMyStreet and Open311 remain a reasonable future option if SBS becomes
resident-facing at scale — i.e. if reports start coming from the public
rather than from the steward's own audits. That's not the case today, so
standing up either is deferred rather than ruled out.

## Linking convention

There is no hard foreign key between a GitHub Issue and an observation —
GitHub Issues and the street JSON files are separate systems, and forcing
a hard link between them would mean building and maintaining sync
tooling neither system needs otherwise. Instead, the link is a documented
text convention:

- In a Case's description, reference the observation it tracks with:

  ```text
  Tracks: streets/{street-id} observation #{id}
  ```

  e.g. `Tracks: streets/ana-ventura observation #1`. Once the Case exists,
  set that observation's `tracking_issue` field (see
  [data-taxonomy.md](data-taxonomy.md)) to the Case's issue number.

- If a Case is opened for a problem that recurs after an earlier Case
  resolved it, reference the earlier Case with:

  ```text
  Follows-from: #{issue-number}
  ```

  This builds a visible lineage of patch-vs-fix history: a recurring
  pothole that keeps getting patched rather than properly resurfaced shows
  up as a chain of Cases each pointing at the last, rather than as the
  same Case being silently reopened.

Both conventions are plain text, not enforced by any GitHub feature or
script — a missing or malformed reference doesn't break anything, it just
means the lineage has to be reconstructed by hand later.

## When a Case closes

Closing a Case does not automatically update the linked observation. The
steward updates the observation's `status` to `resolved` (and sets
`resolved_date`) as a manual step, the same way every other observation
edit is manual. This task does not add automation for that step; see
[ADR 005](../decisions/005-case-tracking.md) for why the link stays
convention-based rather than scripted.

## Board

Cases are tracked on a GitHub Project (v2) board named **"SBS Cases"**,
created from GitHub's built-in "Bug tracker" template. Its actual columns,
in order, are:

1. **To Triage** — newly opened, not yet read closely enough to confirm
   it's real, in-scope, and not a duplicate.
2. **Backlog** — confirmed and in-scope, but not yet being worked.
   `Linked street` / `Linked observation ID` filled in if applicable;
   `Recurrence ref` filled in if this follows an earlier Case.
3. **Ready** — next in line to be picked up; no blockers.
4. **In Progress** — actively being worked. `Workaround applied` filled
   in if an interim fix is in place, including its known limitations, so
   it's clear the symptom is suppressed but the root cause may not be
   addressed yet.
5. **In Review** — work is done and is being checked before close (e.g.
   confirming a fix actually holds, not just that something was done).
6. **Done** — `Resolution summary` filled in, stating what was actually
   done and whether it addressed the root cause or just the symptom —
   that distinction is what makes a later recurrence legible as a
   recurrence rather than a surprise. The Case is closed. The linked
   observation's `status`, if any, is updated to `resolved` as a separate
   manual step — moving a Case to Done does not do this automatically.

Not every Case passes through every column — a quick request might move
straight from Backlog to In Progress with no review step — but a Case
shouldn't skip backwards except to correct a mistake (e.g. moved to In
Progress before it was actually picked up).
