# Street-by-Street Methodology

## Overview

SBS audits a town one street at a time. Each audit produces a street record
made of two parts: a small set of slow-changing **attributes** about the
street, and a growing list of dated **observations** — issues and assets —
found on it. See [data-taxonomy.md](data-taxonomy.md) for the full field
and category reference, and [architecture.md](architecture.md) for how
these records flow into the map.

## Audit walk procedure

1. **Walk the full length of the street**, start to end, on foot. Take
   photos with Mapillary as you go — it geotags automatically and the
   imagery becomes a durable, reusable record independent of this project.
2. **Log observations as you find them**, rather than trying to remember
   everything afterwards. Each one needs: type (issue/asset), category,
   a short title, a description with a location note (nearest house
   number, junction, or landmark), and today's date as `reported_date`.
3. **Note anything you can't classify confidently.** Use category `other`
   rather than forcing a fit, and flag it for review — recurring `other`
   entries are a sign the taxonomy needs a new category.
4. **Don't try to be exhaustive on the first pass.** A street record that
   captures the obvious issues and assets is more useful published than a
   perfect record that never ships. Revisits add to it over time.

When an observation's exact location is wanted, open
`tools/coordinate-picker.html` locally (or via the deployed site if
accessible) — it's an internal workflow tool, not linked from the main
site. Click the matching point on the map, copy the resulting `{ "lat":
…, "lng": … }` snippet, and paste it into that observation's
`coordinates` field in its street's JSON file before committing. See
[data-taxonomy.md](data-taxonomy.md) for the field's exact shape.

After adding coordinates and before committing, run
`python3 scripts/compute_street_proximity.py` from the repo root. It
walks every street's geometry in `data/tutrakan-streets.geojson` and
writes a `nearby_streets` array back onto each geotagged observation,
flagging the closest street as `primary` and any other street within
50m as a secondary candidate. This is a manual, on-demand step in the
same data-entry workflow as the coordinate picker — it is **not** wired
into CI and never runs automatically, since which street is "primary"
for a borderline observation is ultimately a judgement call the script
only assists, it doesn't make.

## Where Case tracking fits in

Logging an observation and tracking it through to resolution are two
different steps, deliberately kept apart — see
[case-tracking.md](case-tracking.md) for the full state-vs-process
rationale. In the audit workflow specifically:

- Most observations need nothing further than what's described above —
  they're logged, and stay as a dated state record until a later revisit
  changes their `status`.
- When an observation needs active follow-up (it's urgent, it needs
  someone assigned, it needs a workaround while a proper fix is pending,
  or it's a recurrence of something already patched once), open a Case
  using the `case.yml` issue form rather than trying to track that
  process inside the JSON record. Reference the observation in the
  Case's description (`Tracks: streets/{street-id} observation #{id}`)
  and set that observation's `tracking_issue` field to the new Issue
  number.
- When the Case is closed, update the observation's `status` to
  `resolved` (and set `resolved_date`) as a manual step — closing the
  Case does not do this automatically.

## Attribute capture

Attributes are captured once per street, ideally during or shortly after
the first walk:

- **Length and geometry** — use OpenStreetMap rather than measuring by
  hand. The `data/tutrakan-streets.geojson` base layer in this repository
  is pulled directly from OSM via the Overpass API, and street length is
  derived from that geometry. This is free, already reasonably accurate
  for a small town, and means attribute capture doesn't require any
  surveying equipment.
- **Traffic** — record a qualitative band (`low` / `medium` / `high`)
  rather than a count. A solo steward walking a street once cannot produce
  a reliable traffic count, and a precise-looking number that's actually a
  guess is worse than an honest qualitative estimate.
- **Everything else** (dwellings, parking spaces, bus stops, lighting,
  surface type, road class) — captured by direct observation during the
  walk. Where a figure genuinely isn't known yet, leave it `null` rather
  than guessing, and note it as a TODO in the street's record.

> **Outstanding TODO:** the current `data/tutrakan-streets.geojson` only
> includes named `highway` ways pulled from OSM — unnamed tracks and
> driveways are excluded since they don't correspond to an addressable
> street. If OSM coverage for a given street turns out to be incomplete or
> wrong, correct it upstream in OpenStreetMap where possible, since that
> benefits everyone who uses the data, not just this project.

## Steward role

Each street has a named steward responsible for keeping its record
current. In the pilot phase, with a single contributor, the steward role
exists mostly as a placeholder in the schema (`meta.steward` in each
street's JSON record) — but the intent is that, as the project grows past
one person, ownership of a street can be handed to whoever is best placed
to keep visiting it (a resident, a local group). The steward field is
deliberately separate from the observations so that ownership can change
without rewriting history.

## Update cadence

There's no fixed schedule yet — this is one of the open questions the
Ana Ventura pilot is meant to inform (see
[charter.md](charter.md#open-questions)). Until a cadence is set, treat a
street as due for revisit whenever something is reported informally (a
Facebook comment, a conversation) that contradicts the current record, and
otherwise revisit opportunistically.

## Replication guide

To onboard a new street:

1. Copy [templates/street-audit.md](../templates/street-audit.md) and fill
   in the street's display name, Cyrillic name, and historical name (if
   known — otherwise leave it explicitly marked TODO).
2. Walk the street per the procedure above and fill in the Attributes,
   Issues, Assets, Trivia, and Official Context sections.
3. Convert the filled-in template into a JSON record under
   `data/streets/<street-id>.json`, following the structure used by
   `data/streets/ana-ventura.json`. The template's sections map directly
   onto the JSON schema's blocks, so this is a mechanical conversion, not a
   rewrite.
4. Add or update the street's entry in `data/tutrakan-streets.geojson`:
   set `status` and `audited` to reflect the new record, and update
   `observations_count` and `issues_open` to match.
5. Confirm the street renders correctly on the map and that its detail
   panel loads before considering the audit published.
