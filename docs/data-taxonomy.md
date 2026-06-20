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

| Field | Description |
| --- | --- |
| `id` | Unique identifier within the street. |
| `type` | `issue` or `asset`. |
| `category` | See category lists below. |
| `title` | Short label. |
| `description` | Free-text detail, including location notes. |
| `coordinates` | `{ "lat": <number>, "lng": <number> }` if geotagged, otherwise `null` pending field capture. |
| `status` | See status values below. |
| `reported_date` | Date first logged. |
| `resolved_date` | Date resolved, if applicable; otherwise `null`. |
| `tracking_issue` | *(optional)* GitHub Issue number of the Case tracking this observation, once one exists. Integer or `null`. |
| `nearby_streets` | *(optional)* Array of `{ "street_id", "distance_m", "primary" }`, written by `scripts/compute_street_proximity.py`. Absent until that script has been run for a geotagged observation. |

`coordinates` is an object with `lat`/`lng` keys, not a bare `[lat, lon]`
pair, so the two axes can't be silently transposed when read back. For
example:

```json
"coordinates": { "lat": 44.038200, "lng": 26.619950 }
```

The long-term intent is for this to be populated automatically from
Mapillary/EXIF photo metadata captured during the audit walk (see
[methodology.md](methodology.md)), once that pipeline exists. Until then,
it's entered by hand using `tools/coordinate-picker.html` — click the
matching point on the map, copy the generated snippet, and paste it into
the observation's `coordinates` field. Most existing observations
predate this field and are `null`; that's expected, not a data-quality
issue to fix retroactively.

`tracking_issue` is optional and absent from every existing observation
record — it is documented here so future Cases (see
[docs/case-tracking.md](case-tracking.md)) have a defined place to record
the link, not as a retroactive requirement. Do not backfill it onto
existing observations; add it only when a Case is actually opened for that
observation.

`nearby_streets` lists every street within 50m of the observation's
`coordinates`, closest first, with the closest marked `primary: true` —
a signal that more than one street might be involved, not an assertion
of responsibility. It's computed, not hand-entered; see
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
- `in_progress` — audit under way.
- `active` — audit complete and the street record is being maintained.
