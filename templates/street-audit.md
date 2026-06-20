# Street Audit Template

Copy this file when onboarding a new street. Its sections mirror the JSON
record structure used in `data/streets/<id>.json` (see
[docs/architecture.md](../docs/architecture.md#data-model)), so converting
a filled-in template into the published JSON record is mechanical.

**Street name (display):**

**Street name (Cyrillic):**

**Street name (historical, pre-1944 if known — otherwise write `TODO: unknown`):**

**Steward name:**

**Steward contact:**

**Last updated:**

## Attributes

These describe the street itself and change rarely. Leave a field blank
and mark it `TODO` if it isn't known yet — don't guess.

| Field | Value |
| --- | --- |
| Length (m) | |
| Dwellings | |
| Parking spaces | |
| Bus stops | |
| Lighting count | |
| Surface type | |
| Road class | |

## Issues

| ID | Category | Title | Description / location | Coordinates | Status | Reported | Resolved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Category: `road`, `litter`, `vegetation`, `hazard`, `structure`, `other`.
Status: `open`, `in_progress`, `resolved`. Coordinates are optional —
leave blank at audit time unless you've already used
`tools/coordinate-picker.html`; see the note below.

## Assets

| ID | Category | Title | Description / location | Coordinates | Status | Reported |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Category: `business`, `green_space`, `infrastructure`, `service`,
`heritage`, `other`. Status: `active`, `inactive`.

**Coordinates** (optional, both tables): only fill in if you've already
captured it with `tools/coordinate-picker.html` (see
[docs/methodology.md](../docs/methodology.md)) — paste the
`{ "lat": ..., "lng": ... }` snippet it copies. Leave blank otherwise;
most observations don't have one yet, and that's expected, not an
omission to fix. Before recording a coordinate for anything involving a
specific living being (an animal, in particular), check
[docs/ethics.md](../docs/ethics.md) first.

**Not filled in by hand, at audit time or ever:** `nearby_streets` is
computed later by `scripts/compute_street_proximity.py`, only once a
coordinate exists. `tracking_issue` is set later, only if a Case is
opened for that observation — see
[docs/case-tracking.md](../docs/case-tracking.md). Neither belongs in
this template.

## Trivia

**Text:**

**Sources** (leave empty if none yet — do not present unsourced trivia as fact):

**Verified:** `yes` / `no`

## Official context

Town- or municipality-level statistics relevant to this street's
surroundings. There is no official street-level data in Bulgaria — every
entry here is context, not a claim about the street itself. Every row
needs a source and a date; see [docs/data-sources.md](../docs/data-sources.md).

| Metric | Value | Source | Date | Level |
| --- | --- | --- | --- | --- |
| | | | | |
