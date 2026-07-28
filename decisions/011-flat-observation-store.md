# ADR 011: Flat Observation Store

## Status: Accepted

## Context

Observations lived inside `data/streets/{id}.json`, one array per street
(ADR 003). That made a street a storage precondition for an observation:
before anything could be recorded, a street had to be chosen, its record
had to exist, and `audited: true` had to be set on its
`data/tutrakan-streets.geojson` feature - three things that had to agree,
with nothing checking them (the same shape of problem
[ADR 010](010-osm-owned-attributes.md) closed off for OSM-derived
attributes).

But the street relationship an observation needs was already carried
inside the observation itself, as `nearby_streets[]` with a `primary`
flag (`scripts/compute_street_proximity.py`, since before this ADR).
Embedding observations inside a street's file duplicated a relationship
the data already held, and it was the duplicate - not the relationship -
that forced a street decision before a photo could become a pin.

The repository holds exactly one observation. This is the cheapest this
migration will ever be.

## Decision

Move observations out of `data/streets/*.json` into a single flat store,
`data/observations.json`:

```json
{ "observations": [ ... ] }
```

One file, not one file per observation: a flat directory of per-
observation files can't be enumerated by a browser over static hosting,
and a generated manifest listing them would itself be a derived file that
has to agree with its source - exactly the drift class ADR 010 and
`scripts/new_street.py` already exist to close off. There is no
`next_id` counter either, for the same reason: the id is derived as
`max(existing ids) + 1` at write time, so there is no counter to drift
from reality.

Every field that existed before (`id`, `type`, `category`, `title`,
`description`, `coordinates`, `status`, `reported_date`, `resolved_date`,
`tracking_issue`, `nearby_streets`, `photo`) keeps exactly the same
meaning - this is a relocation, not a redesign. `street_id` is
deliberately **not** a field on an observation: `nearby_streets[].primary`
already is the street relationship, computed, not hand-entered
(unchanged from ADR 003/the existing proximity script). Adding a second,
hand-set `street_id` field would recreate the exact duplicate-source-of-
truth problem this ADR removes.

Consequences of decoupling storage from a street:

- **The map** (`assets/js/map.js`) renders a pin for every observation
  with coordinates, independent of whether its street has been onboarded
  or audited. The street detail panel lists an observation by filtering
  the store on `nearby_streets[]` where `primary` is `true` for that
  street, rather than reading an embedded list.
- **Photo filenames** drop the street prefix: `obs-{id}__{description}.jpg`
  instead of `{street-id}__obs-{id}__{description}.jpg`, under
  `assets/images/observations/` instead of
  `assets/images/streets/{street-id}/`. `scripts/photo_pipeline.py` looks
  an observation up by id alone.
- **`scripts/new_observation.py`**'s `--street` becomes optional and, when
  given, is used only for the branch name, commit message, and PR body -
  never written into the observation. The id is always derived, never
  supplied, using the same "re-read after checkout" freshness the old
  per-street id-collision check used, now applied to a counter that
  doesn't exist rather than a collision that can't happen.
- **Case linking** (`.github/ISSUE_TEMPLATE/case.yml`,
  `scripts/link_case_to_observation.py`) drops the street: the convention
  is `Tracks: observation #{n}`, not `Tracks: streets/{id} observation
  #{n}`. See [docs/case-tracking.md](../docs/case-tracking.md).
- **`observations_count` and `issues_open`** on
  `data/tutrakan-streets.geojson` features are now derivable from the
  store (count observations whose `nearby_streets[].primary` matches that
  street). They are left stale deliberately - refreshing them from the
  store, or removing them in favour of computing on the fly, is a
  separate decision, out of scope here.
- **The one migrated observation** was renumbered from id 2 to id 1 (ids
  now start at 1, no gap) and its photo renamed from
  `ana-ventura__obs-2__litter.jpg` to `obs-1__litter.jpg`. Its linked
  Case (#5) still resolves forward correctly (`tracking_issue: 5` is
  unchanged), but Case #5's own GitHub Issue body - live, external state
  - still reads "Linked observation ID: 2" from before this migration,
  which no longer resolves to anything. That body was deliberately not
  edited as part of this change, the same reasoning applied elsewhere in
  this project to already-published external state (e.g. the
  `sbs-cover-start`/`sbs-cover-end` markers in ADR 006): fixing it is a
  one-line manual `gh issue edit`, not something to rewrite silently from
  a script. A Case's cover photo, if any, is unaffected - covers were
  never referenced from an observation's `photo` field.

## Alternatives Considered

- **One JSON file per observation** - rejected: not enumerable by a
  browser over static hosting without a generated index, which would be
  a second file that has to agree with the first - the same drift shape
  this ADR exists to remove, one level up.
- **A `next_observation_id` counter, stored and incremented** - rejected
  for the same reason ADR 010 rejected typing OSM-derived fields out a
  second time: a stored counter is one more piece of state that can fall
  out of sync with the data it's supposed to describe. Deriving it from
  `max(existing ids)` means there is nothing to keep in sync.
- **A `street_id` field on the observation, set at creation time** -
  rejected: `nearby_streets[].primary` already answers "which street is
  this near," computed from real geometry once coordinates exist. A
  second, hand-set field would either duplicate that answer or
  contradict it, and there would be no way to tell which one to believe.
- **Keep per-street storage, but make the street optional by auto-
  creating a placeholder street record** - rejected: this still forces a
  street decision before an observation can exist (something has to be
  auto-created), just deferred by one step, and a placeholder record is
  exactly the kind of speculative, unaudited data
  [docs/ethics.md](../docs/ethics.md)'s honesty-by-construction stance
  argues against publishing.
