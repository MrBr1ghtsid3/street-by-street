# ADR 007: Intervention Data

## Status: Accepted

## Context

Plainsight observations record state (ADR 003) and, when needed, link to a
GitHub Case that tracks the process of getting a problem resolved
(ADR 005). Neither currently captures the act of the resolution itself:
who showed up, how long it took, what it cost, what was actually done.
That's arguably the most civically valuable data the project can
produce — it's what turns "this street has a litter problem" into "here
is concretely what it costs, in people and euros, to clear one," which is
the kind of number that makes civic effort legible and comparable across
POIs, streets, and time.

The Case already has somewhere to put this at full detail (workaround
notes, resolution summary, comments). The question is whether the
public-facing observation record should carry any of it, and if so, how
much, and in what relationship to the Case.

## Decision

Add an optional `resolution` object to observations
(`docs/data-taxonomy.md`), populated only once an observation has
actually been acted on. It holds a **hand-curated public summary**:
intervention date, outcome, a free-form `people` string, `person_hours`,
`equipment`, `cost_eur`, an optional `cost_note`, an optional
`after_photo`, a `case_ref`, and a one-line `summary`.

The GitHub Case remains the **private source of truth** for full
intervention detail — itemised spend, names the contributors haven't
agreed to publish, internal back-and-forth. The `resolution` object is
linked to it by issue number (`case_ref`, the same value as the
observation's `tracking_issue`) but is **authored, not auto-synced**: a
person writes the public summary by hand, deciding what's worth
surfacing, rather than a script copying the Case verbatim. This is the
same reasoning as the Case/observation split itself (ADR 005) applied one
level deeper — every additional sync path between two records of the same
event is a future drift risk, and the smaller, curated record is also the
one more comfortable to publish by default.

Two field choices are deliberate:

- **`people` is a free-form string, not a structured array.** Effort
  varies too much in kind — a lone steward, a named group, an
  anonymous handful of volunteers — to force into a rigid shape this
  early. `person_hours` is the numeric field that actually needs to
  aggregate; `people` just needs to be honest and readable.
- **`cost_eur` is euros**, matching the currency the rest of the project
  already uses, not Bulgarian lev.

`resolution.outcome` (`resolved` / `partial` / `workaround`) determines
what the observation's `status` should be set to, but this is a manual
data-entry convention documented in `docs/methodology.md`, not something
enforced by code — the same trade-off ADR 005 already made for Case-close
→ `status: resolved`.

The map popup (`assets/js/map.js`) renders a "Resolution" section — badge,
date, summary, a compact person-hours/cost/people stats line, equipment,
after-photo (currently a filename placeholder, since no photo-display
pipeline exists yet — see `docs/ethics.md`), and a "Full case →" link —
only when an observation has a `resolution` object. Observations without
one render exactly as before.

## Alternatives Considered

- **Auto-populate `resolution` from the Case via the GitHub API** —
  rejected for the same reason ADR 005 rejected a hard foreign key: it
  would require sync tooling this project's scale doesn't justify yet,
  and it removes the editorial step of deciding what's safe/worth
  publishing versus what stays in the private Case.
- **Structured `people` (array of names/roles)** — rejected as premature
  rigidity. A single free-text field is honest about how varied and
  informal contributions are at this stage; revisit if aggregating by
  named contributor ever becomes a real need.
- **No public intervention data at all, Case-only** — would keep the
  public record simpler, but throws away the most civically interesting
  output of the project (what fixing things actually costs) in the name
  of not building a summary field. Rejected.

## Consequences

- Intervention cost and effort become publicly visible and aggregatable
  (`person_hours`, `cost_eur`) across POIs, once enough resolutions
  accumulate to be interesting in aggregate.
- Potentially sensitive detail — full itemised costs, names people
  haven't agreed to publish, internal discussion of what went wrong —
  stays private in the Case by default; only what's hand-curated into
  `resolution.summary`/`cost_note`/`people` goes public.
- `status` and `resolution.outcome` can drift out of sync the same way
  `status` and Case-close already can (ADR 005) — this is an accepted
  gap, corrected by re-editing the record, not by tooling.
- `after_photo` display depends on the photo pipeline described in
  `docs/ethics.md` and `docs/charter.md`, which doesn't exist yet; until
  it does, the popup shows the filename as a caption rather than an
  image.
