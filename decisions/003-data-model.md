# ADR 003: Data Model

## Status: Accepted

## Context

Before any data was collected at scale, SBS needed a settled shape for
what it records, so that the first street audited (Ana Ventura) produces a
record compatible with the second, the tenth, and the hundredth, without
a migration. Two design questions had to be answered up front: what's the
unit of organisation, and how is a street's slow-changing description kept
separate from the things that get logged on it repeatedly.

## Decision

### Three-level hierarchy

Adopt **City → Street → Observation** as the organising structure for all
data:

- **City** (Tutrakan) is the map entry point and the only level at which
  official statistics apply (see
  [docs/data-sources.md](../docs/data-sources.md)).
- **Street** is the primary unit — both a navigable destination and a
  container for everything recorded on it.
- **Observation** is the atomic record — a single dated issue or asset.

This mirrors iNaturalist's model, where the individual observation is the
atomic unit and everything else (species pages, location pages) is a
rollup view over observations rather than a separately maintained record.
SBS applies the same idea: a street's profile is built from its
observations and attributes, not maintained as an independent narrative
that could drift out of sync with them.

### Attributes/observations split

Within a street record, **attributes** (length, dwelling count, parking
spaces, bus stops, lighting, surface type, road class, official and
historical name) are stored separately from **observations** (the
issues and assets list). Attributes are captured once and changed rarely;
observations accumulate continuously and are independently dated and
statused. The full field-level rationale and the practical test for
classifying a new field is in
[docs/data-taxonomy.md](../docs/data-taxonomy.md#street-attributes-vs-observations).

This is enforced structurally rather than left as a convention: the JSON
schema (see [docs/architecture.md](../docs/architecture.md#data-model))
puts them in separate top-level blocks (`attributes` vs. `observations`),
so the split can't be silently lost as the schema evolves.

## Consequences

- Adding a new street never requires touching the schema — it's always
  the same `meta` / `attributes` / `trivia` / `official_context` /
  `observations` shape, populated with that street's data.
- Querying "all open issues on this street" or "all assets across all
  streets" is a straightforward filter over `observations`, uncomplicated
  by attribute fields living in the same array.
- The cost is one extra layer of structure that a flatter schema wouldn't
  have. This is accepted because the alternative — one flat list per
  street mixing attributes and observations — would make it ambiguous
  whether a given record changes once or continuously, which is exactly
  the distinction the model exists to preserve.

## Alternatives Considered

- **Flat per-street record** (attributes and observations as one list) —
  rejected because it erases the one distinction (changes-once vs.
  changes-continuously) that the rest of the methodology depends on, for
  example when deciding update cadence or when reasoning about what a
  steward is responsible for keeping current.
- **Observation-only model, with street "attributes" computed from
  observations** (e.g. treating "this street has a well" as itself an
  observation rather than an attribute) — rejected because attributes
  like length, dwelling count, or road class aren't really discoveries
  made on a particular date; they're closer to a street's identity, and
  forcing them into the observation shape would mean inventing a fake
  `reported_date` for facts that don't have one.
