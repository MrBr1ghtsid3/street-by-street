# ADR 008: Observation Taxonomy

## Status: Accepted

## Context

The original taxonomy ([docs/data-taxonomy.md](../docs/data-taxonomy.md))
split categories by observation `type`: six issue categories (`road`,
`litter`, `vegetation`, `hazard`, `structure`, `other`) and five asset
categories (`business`, `green_space`, `infrastructure`, `service`,
`heritage`, `other`) — eleven categories across two parallel lists, each
with its own `other` catch-all. That shape was inherited from the
project's original tool stack ([ADR 001](001-tool-stack.md)) rather than
designed against the three pillars this project actually means to track,
and it let observations accumulate under `other` instead of forcing a
decision about what the taxonomy was actually for.

Separately, and unrelated in origin but landing in the same pass: street
status included a `complete` value, rendered green and labelled "Fully
documented." No street audit is ever actually finished — recurring
conditions (litter reappears, wear resumes) mean there is no terminal
state a street reaches — so `complete` asserted something the project
cannot honestly claim, in the same spirit as the manual-vetting language
in [docs/ethics.md](../docs/ethics.md) that refuses to describe unbuilt
automation as if it existed.

## Decision

### One shared category list, not two parallel ones

Replace the eleven-category, two-list model with a single list of three
categories, used identically whether the observation's `type` is `issue`
or `asset`:

- `accessibility` — walkability; day vs. night lighting conditions;
  seasonal impacts; public transport availability; navigation for people
  with disabilities.
- `animal_welfare` — monitoring dogs and cats; distinguishing owned from
  unowned animals; mapping clusters.
- `cleanliness` — recurring littering; access to bins and collection
  points; collection intervals; air quality.

A category describes the observation's *domain* — which of the project's
three pillars it belongs to. Whether it's a problem or something of value
is already carried by `type` (`issue`/`asset`); encoding that distinction
a second time, by giving issues and assets different category lists, was
redundant and meant every new category had to be designed twice (does
this belong on the issue list, the asset list, or both) instead of once.

### No `other` catch-all

There is deliberately no fourth "doesn't fit" category. An `other` bucket
that's always available removes the pressure to ever decide whether the
taxonomy itself is complete, and in practice becomes exactly the dumping
ground it looks like — impossible to search, impossible to report on,
and a standing invitation to skip the harder question of whether a
fourth real pillar is needed.

An observation that genuinely doesn't fit `accessibility`,
`animal_welfare`, or `cleanliness` is **not logged as an observation at
all**. It goes in the "Taxonomy gaps" section of
[templates/street-audit.md](../templates/street-audit.md#taxonomy-gaps)
instead — a plain table (what was seen, where, when, and why it fits
none of the three) that exists specifically to surface a gap rather than
paper over it (see [docs/methodology.md](../docs/methodology.md), step
3). Entries accumulating there are the taxonomy asking to be extended;
adding a fourth category is a decision this project records in its own
ADR, not one made in the field by forcing a fit.

### Street status: `complete` renamed to `normal`

In the same change, `complete` becomes `normal`. The rendered colour and
weight (green, heavier line) are unchanged — only the label and the claim
behind it. `normal` means a street has an established, currently-kept
record; it is the steady default state, not a declaration that nothing
further will ever be found there.

## Consequences

- The three pillars are closed for now. This is a narrowing, not a
  placeholder shape expected to grow casually — expanding it requires a
  new ADR, the same bar every other structural decision in this project
  clears.
- Five of the six seed observations logged against Ana Ventura (pothole,
  hedge, shop, mulberry tree, well) were placeholders written before this
  taxonomy existed and didn't survive the narrowing under any of the
  three pillars honestly — they were retired as a direct consequence of
  this change, leaving the one real, still-open litter observation
  (recategorised `litter` → `cleanliness`) as Ana Ventura's only current
  record. See the dated note in
  [docs/charter.md](../docs/charter.md#success-criteria-for-the-ana-ventura-poc)
  for how this affects that document's original success criteria.
- `CATEGORY_ICON` and the category list are duplicated by hand across
  `assets/js/map.js`, `scripts/new_observation.py`,
  `tools/observation-form.html`, and `tools/templates/observation_form_server.html`
  (the last two via `tools/serve.py`'s `/taxonomy` endpoint) — same
  duplication tradeoff as before, just fewer entries to keep in sync per
  copy (three instead of eleven).
- Any future category addition means updating all four copies plus
  `docs/data-taxonomy.md`, not just picking a new string.

## Alternatives Considered

- **Keep `other`, one list per type** — the status quo. Rejected because
  it never forces the taxonomy question to be answered, and produces
  data that's hard to use precisely because it accepts anything.
- **Force unclassifiable observations into the nearest pillar** —
  rejected: mislabelling a real observation to avoid an empty field
  produces false data that's worse than an honest gap, and it hides the
  signal (repeated near-misses) that would otherwise justify a fourth
  category.
- **Keep separate issue/asset category lists, just trim each to three or
  so** — rejected because the type/category redundancy was the actual
  problem, not the category count; a single shared list removes a whole
  axis of duplication rather than just shrinking it.

## Implementation note

This ADR predates `data/taxonomy.json`. The machine-readable source of
truth for the category list, the category→icon mapping, the fallback
icon, and the issue/asset status lists now lives there, read by
`scripts/new_observation.py`, `tools/serve.py`, `assets/js/map.js`, and
`tools/observation-form.html` — not declared inline in each of those
files as the "Consequences" section above originally described.
`docs/data-taxonomy.md` remains the hand-written, human-readable
companion to that file. The two are kept in agreement by
`scripts/check_taxonomy_sync.py`, run in CI on every pull request and
push to `main` via `.github/workflows/check-taxonomy.yml`, rather than
resting on a person remembering to update both.
