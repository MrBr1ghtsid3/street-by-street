# Data Taxonomy

Every record in Plainsight is either a **street attribute** (a property of the
street itself) or an **observation** (a point-in-time record of something
on the street). Mixing the two in a single flat schema is the single
easiest way to make this data hard to use later, so the split is treated as
a hard rule rather than a stylistic choice — see
[decisions/003-data-model.md](../decisions/003-data-model.md) for the
reasoning.

## Street attributes vs. observations

**Street attributes** describe the street as a whole. They are captured
once, during the initial audit, and only change when something structural
happens (a resurfacing, a new bus stop). They live in the `attributes`
block of a street's JSON record.

| Field | Description |
| --- | --- |
| `length_m` | Street length in metres. |
| `dwellings` | Number of dwellings fronting the street. |
| `parking_spaces` | Count of formal/informal parking spaces. |
| `bus_stops` | Number of bus stops on the street. |
| `lighting_count` | Number of street lighting fixtures. |
| `surface_type` | e.g. asphalt, cobble, unpaved. |
| `road_class` | Functional classification (e.g. residential, tertiary). |

Alongside attributes, each street record carries identity fields that are
also slow-changing but aren't really "attributes" of the physical street:
official display name, the Cyrillic name, and any historical (e.g.
pre-1944) name, where known.

**Observations** describe things found on the street at a point in time.
They are added continuously as the street is revisited, and each one is
independently dated and statused. They live in the `observations` array of
a street's JSON record.

### Canonical observation example

The schema has grown incrementally (`coordinates`, `tracking_issue`,
`nearby_streets`, `reported_time`), so here is one fully-annotated example
showing every field that currently exists. This is illustrative, not a
literal record — most real observations today don't have most of the
optional fields populated; see the note after the table.

```json
{
  "id": 2,
  "type": "issue",
  "category": "cleanliness",
  "title": "Litter build-up at the corner",
  "description": "Junction with the lane to the river",
  "coordinates": { "lat": 44.042045, "lng": 26.614071 },
  "status": "open",
  "reported_date": "2026-06-10",
  "reported_time": "09:15",
  "resolved_date": null,
  "tracking_issue": 14,
  "nearby_streets": [
    { "street_id": "ana-ventura", "distance_m": 29.7, "primary": true },
    { "street_id": "panayot-volov", "distance_m": 37.6, "primary": false }
  ]
}
```

| Field | Required? | Description |
| --- | --- | --- |
| `id` | Required | Unique identifier within the street. |
| `type` | Required | `issue` or `asset`. |
| `category` | Required | See category lists below. |
| `title` | Required | Short label. |
| `description` | Required | Free-text detail, including location notes. |
| `coordinates` | Optional | `{ "lat": <number>, "lng": <number> }` if geotagged, otherwise `null`. See below. |
| `status` | Required | See status values below. |
| `reported_date` | Required | Date first logged. |
| `reported_time` | Optional | Time first logged, `HH:MM`, alongside `reported_date`. Rendered if present; its absence is handled gracefully, it is never required at audit time. |
| `resolved_date` | Required (value nullable) | Date resolved, if applicable; otherwise `null`. |
| `tracking_issue` | Optional | GitHub Issue number of the Case tracking this observation, once one exists. Integer or `null`/absent. |
| `nearby_streets` | Optional | Array of `{ "street_id", "distance_m", "primary" }`, written by `scripts/compute_street_proximity.py`. Absent until that script has been run for a geotagged observation. |
| `resolution` | Optional | Hand-curated public summary of an intervention (people, time, cost, outcome). Absent until the observation has actually been acted on. See [Resolution](#resolution) below. |
| `photo` | Optional | Repo-relative path to this observation's primary photo (e.g. `assets/images/streets/ana-ventura/ana-ventura__obs-2__litter.jpg`), rendered on the map popup. Written by `scripts/photo_pipeline.py` for the most recently ingested non-cover photo targeting this observation; absent until one exists. |

Verified against `data/streets/ana-ventura.json`, the one real record that
exists today: every observation has the seven required fields plus
`coordinates`, which is `null` on five of six and a real value on one
(observation #2). That same geotagged observation also carries a
`tracking_issue` (linking it to a Case) and a `nearby_streets` array
(written by `scripts/compute_street_proximity.py`). No observation
currently uses `reported_time` — it stays documented ahead of use.

`coordinates` carries an additional constraint beyond its shape: per
[docs/ethics.md](ethics.md), do not record a precise, persistent
coordinate for an observation that would locate a specific living being
(for example, a particular stray animal, as opposed to "litter accumulates
at this junction," which is a structural fact about the place). Nothing in
the coordinate-picker tool or the renderer enforces this — it's a
judgement call at data-entry time, the same way category and status are.

`tracking_issue` is optional. It is present on observation #2 of
`ana-ventura.json` (tracked by a Case) and absent from the rest — see
[docs/case-tracking.md](case-tracking.md) for the linking convention. Add
it only when a Case is actually opened for an observation; do not backfill
it onto observations that have no Case.

`photo` is optional and populated automatically, never hand-edited: the
photo pipeline sets it when a non-cover photo named for this observation
is ingested (see [methodology.md](methodology.md#photo-ingestion)). A
**cover** photo (named with `cover` in its description segment) is
Case-only — it embeds on the linked Case's issue body and deliberately
never touches this field, so an observation can have a Case cover photo
without having a map photo, and vice versa. Publishing a real photo here
currently relies on the manual pre-commit vetting described in
[docs/ethics.md](ethics.md), not on any automated redaction — treat that
as a constraint on what gets committed, not something this field or the
map renderer enforces.

### Resolution

`resolution` is an optional object, absent by default. It appears on an
observation once the underlying problem (or, for an asset, some notable
change) has actually been acted on — walked out to, cleared, repaired,
patched. It is a hand-curated **public summary** of that intervention, not
an automated sync of the linked Case: the GitHub Case
(`tracking_issue`/`case_ref`) stays the private source of truth for full
process detail (who, exact itemised spend, internal discussion), and the
`resolution` object is a deliberately smaller, published account of the
same event. Authoring it by hand — rather than generating it from the
Case — is what keeps the two from drifting apart; see
[ADR 007](../decisions/007-intervention-data.md) for the reasoning.

```json
"resolution": {
  "date": "2026-06-22",
  "outcome": "resolved",
  "people": "3 volunteers",
  "person_hours": 4.5,
  "equipment": ["litter pickers", "refuse bags", "gloves"],
  "cost_eur": 12.50,
  "cost_note": "bags and gloves; pickers borrowed",
  "after_photo": "ana-ventura__obs-2__after.jpg",
  "case_ref": 5,
  "summary": "Corner cleared; recurrence likely without a bin nearby."
}
```

| Field | Required? | Description |
| --- | --- | --- |
| `date` | Required (when `resolution` present) | Date of the intervention, ISO (`YYYY-MM-DD`). |
| `outcome` | Required (when `resolution` present) | One of `resolved`, `partial`, `workaround` — see below for how this maps to the observation's `status`. |
| `summary` | Required (when `resolution` present) | One-line public narrative of what was done. Include an honest patch-vs-fix note where relevant (e.g. "cleared, not a permanent fix") rather than implying more than was done. |
| `people` | Optional | Free-form string describing who did the work — `"1 — me"`, `"3 volunteers"`, or names if the contributors are comfortable being named. Deliberately a string, not a structured array: effort varies too much in kind (a lone steward vs. an organised group) to force into one shape. |
| `person_hours` | Optional | Number. People × hours each — the single aggregatable measure of human effort across POIs, kept numeric specifically so it can be summed/averaged later even though `people` itself is free text. |
| `equipment` | Optional | Array of strings naming what was used. |
| `cost_eur` | Optional | Number, in euros (the project's cost unit throughout, not BGN/lev). |
| `cost_note` | Optional | Free text for itemisation or context the bare number doesn't capture (what was bought vs. borrowed, etc). |
| `after_photo` | Optional | Filename of an after photo, following the same `{street-id}__obs-{id}__after.{ext}` naming convention as other observation photos, stored under `assets/images/streets/{street-id}/`. Absent if no after photo was taken. |
| `case_ref` | Optional | The GitHub issue number of the Case with full private detail — the same value as the observation's own `tracking_issue`, duplicated here so the resolution record is self-contained even if read apart from the rest of the observation. |

The `resolution` object as a whole is absent on every observation that
hasn't been acted on yet — do not add an empty or placeholder `resolution`
object ahead of an actual intervention.

`resolution.outcome` and the observation's `status` are related by a
manual convention, not enforced by code:

- `outcome: "resolved"` — set the observation's `status` to `resolved` as
  part of the same edit that adds the `resolution` object.
- `outcome: "partial"` or `"workaround"` — the observation's `status`
  stays `open` (or `in_progress`); the `resolution` object annotates that
  something was tried without fully closing it out.

See [methodology.md](methodology.md#resolution-and-status) for this same
rule in the data-entry workflow.

`nearby_streets` lists every street within 50m of the observation's
`coordinates`, closest first, with the closest marked `primary: true` — a
signal that more than one street might be involved, not an assertion of
responsibility. It's computed, not hand-entered; see
[methodology.md](methodology.md) for when and how to run the script that
fills it in.

The practical test for which bucket a field belongs in: if it can change
every time someone walks the street, it's an observation; if it only
changes when the street itself physically changes, it's an attribute.

## Observation type

- `issue` — a problem.
- `asset` — something of value.

## Categories

One shared list of categories applies to both issues and assets — a
category describes the *domain* of an observation, not whether it's a
problem or something of value (that's what `type` is for):

| Category | Covers |
| --- | --- |
| `accessibility` | Walkability; day vs. night lighting conditions; seasonal impacts; public transport availability; navigation for people with disabilities. |
| `animal_welfare` | Monitoring dogs and cats; distinguishing owned from unowned animals; mapping clusters. |
| `cleanliness` | Recurring littering; access to bins and collection points; collection intervals; air quality. |

There is no `other` catch-all — only these three pillars, for now.

## Status values

**Observation status — issues:**

- `open` — logged, not yet addressed.
- `in_progress` — work or follow-up under way.
- `resolved` — fixed or no longer present.

**Observation status — assets:**

- `active` — present and in use/maintained.
- `inactive` — present but disused, abandoned, or closed.

**Street status** (distinct from observation status — describes audit
progress, not the street's physical condition):

- `not_started` — not yet audited.
- `active` — audit under way; the street record is being actively built
  (rendered amber, labelled "Audit in progress").
- `normal` — the steady, default state once a street has an established
  record (rendered green, labelled "Documented"). This is not a claim
  that the street is "finished" — recurring conditions (litter, wear)
  mean no street audit is ever truly complete, so `normal` just means
  the record exists and is being kept current, not that there's nothing
  left to find.
