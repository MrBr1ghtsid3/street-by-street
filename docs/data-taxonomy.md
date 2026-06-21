# Data Taxonomy

Every record in SBS is either a **street attribute** (a property of the
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
  "category": "litter",
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

## Issue categories

| Category | Covers |
| --- | --- |
| `road` | Surface damage, potholes, drainage, kerbing. |
| `litter` | Dumping, accumulated rubbish, fly-tipping. |
| `vegetation` | Overgrowth obstructing pavements, sightlines, or signage. |
| `hazard` | Anything posing immediate risk to safety (exposed wiring, unstable structures, open holes). |
| `structure` | Damage to buildings, walls, fences, or other built structures. |
| `other` | Anything that doesn't fit the above; use sparingly and consider whether a new category is warranted. |

## Asset categories

| Category | Covers |
| --- | --- |
| `business` | Shops, services, anything trading. |
| `green_space` | Trees, gardens, verges, parks. |
| `infrastructure` | Wells, bus stops, benches, lighting — built features of public value. |
| `service` | Public or community services not captured under `business` (e.g. a community hall). |
| `heritage` | Anything of historical or cultural significance. |
| `other` | As above — use sparingly. |

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
- `complete` — audit finished; the record is complete and maintained
  (rendered green, labelled "Fully documented").
