# ADR 010: OSM-Owned Attributes

## Status: Accepted

## Context

PR #32 gave `scripts/refresh_osm.py` write access to `data/streets/*.json`'s
`attributes` block, alongside the geojson it already wrote (see
[ADR 004](004-data-update-strategy.md)). The set of fields it writes -
`length_m`, `surface_type`, `road_class`, `bus_stops` - was four hardcoded
assignment lines in `update_street_json()`, with a hand-typed
`attributes_note` next to them describing which fields were OSM-derived.

The two fell out of agreement immediately. `update_street_json()` wrote
four keys; the note it generated named three, omitting `road_class`
entirely. A reader of `data/streets/ana-ventura.json` had no way to tell
`road_class` apart from a genuinely ground-surveyed field - the note
actively told them it wasn't one. That's a false provenance claim on
published data, not a cosmetic gap.

Separately, and worse: before PR #32, `road_class` held a human ground
observation - `"tertiary / residential (mixed along its length)"` - written
by whoever walked Ana Ventura and looked at more than a tag. PR #32
overwrote it with the bare OSM `highway` tag, `"tertiary"`, because nothing
distinguished "the OSM classification" from "what a steward actually saw"
- they were the same field. Every quarterly refresh since would have
overwritten it again, silently, forever.

Both problems have the same root: the set of OSM-owned fields existed only
as a list a human had to keep restating correctly in two places (the
assignment lines, the note) and remember to keep out of a third (any
attribute a person might want to hand-edit). [docs/ethics.md](../docs/ethics.md)
already holds, in a different context, that a safeguard depending on
someone remembering to apply it will eventually fail. This was that shape
of safeguard, and it failed on schedule.

## Decision

Introduce `OSM_OWNED_STREET_ATTRS`, a module-level constant in
`scripts/refresh_osm.py` naming exactly the attribute keys the script is
permitted to write:

```python
OSM_OWNED_STREET_ATTRS = ("length_m", "surface_type", "road_class", "bus_stops")
```

`update_street_json()` writes attributes by iterating this constant, not
by per-field assignment lines, and raises if a caller's `computed_attrs`
is missing a key it expects (a present key with value `None` is legitimate
- OSM having no data for that field - and is written as `null`, not
treated as an error). `attributes_note` is generated from the same
constant, so the note's claim about which fields are OSM-derived and the
set of fields actually written are the same list read twice, not two
lists someone has to keep in sync by hand.

Every attribute key not in `OSM_OWNED_STREET_ATTRS` - `dwellings`,
`parking_spaces`, `lighting_count`, and the new `road_character` below -
is structurally out of this script's reach. Adding one there would mean
adding a new dict key inside `main()`'s `computed_attrs` construction
*and* adding the name to the constant, so a field can't become
script-writable by accident the way `road_class` became script-writable
without anyone deciding a human field should stop being one.

To recover what PR #32 destroyed, add `road_character` - a free-text,
human-observed attribute holding exactly the kind of description
`road_class` used to hold before it became an OSM mirror. It is
deliberately not in `OSM_OWNED_STREET_ATTRS`. `data/streets/ana-ventura.json`'s
`road_character` is restored to `"tertiary / residential (mixed along its
length)"`; its `road_class` stays `"tertiary"`, the bare OSM tag, which is
itself still worth keeping - it's independently-sourced, quarterly-refreshed
classification data, just not the same claim `road_character` makes.

## Consequences

- Adding a new OSM-derived field going forward means adding its name to
  `OSM_OWNED_STREET_ATTRS` and its value to `computed_attrs` in `main()`.
  The note updates itself; there's no third place to remember.
- `road_class` is no longer a field a person can usefully hand-edit -
  anything written there will be silently overwritten at the next
  quarterly refresh, the same as `length_m`, `surface_type`, and
  `bus_stops` already were. A steward's own read of a street's character
  belongs in `road_character` now, not `road_class`.
- Every street record that wants a human road description to survive
  needs both fields present. Nothing enforces that structurally beyond
  the template and this ADR - `templates/street-audit.md` lists
  `road_character` as its own row, marked separately from `road_class`,
  but a street file assembled by hand outside that template could still
  omit it. That's an accepted gap, the same review-dependent one every
  other hand-assembled street record already carries.
- `update_street_json()` now raises on a caller programming error
  (a missing expected key) instead of either crashing on a `KeyError`
  with no context or silently writing an incomplete record - this only
  matters to `scripts/refresh_osm.py`'s own `main()`, which already
  supplies all four keys correctly, but it stops a future edit to that
  function from reintroducing the same class of drift this ADR exists to
  close.

## Alternatives Considered

- **Add `road_class` to the note's typed-out field list and leave
  everything else as it was** - rejected: fixes today's specific
  omission but not the mechanism that produced it. The next field added
  to either the assignment lines or the note without touching the other
  reproduces the exact same defect.
- **Drop `road_class` from what `refresh_osm.py` writes, make it
  human-only again** - rejected. The bare OSM classification is real,
  independently-sourced data worth refreshing quarterly on its own terms;
  the actual problem was never that it existed, only that it was
  conflated with a steward's richer description under one field name.
  Splitting the field is the fix; removing the OSM data isn't.
- **Store the human description as a note or comment rather than a real
  attribute** - rejected: the side panel's attribute rendering
  (`assets/js/map.js`'s `renderStreetDetail`) already iterates
  `record.attributes` generically to build the display, so a proper
  attribute key is what makes `road_character` show up there for free.
  A separate note field would need its own bespoke rendering path for no
  real benefit.
