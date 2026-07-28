# Street Audit Template

Copy this file when onboarding a new street. Its **Attributes**, **Trivia**,
and **Official context** sections mirror `data/streets/<id>.json` (see
[docs/architecture.md](../docs/architecture.md#data-model)); its **Issues**
and **Assets** sections instead become entries appended to the flat
`data/observations.json` store, not to the street's own file — see
[decisions/011-flat-observation-store.md](../decisions/011-flat-observation-store.md).
Converting a filled-in template into the published records is mechanical
either way.

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
| Road class | *(OSM-derived — leave blank; filled in automatically by `scripts/refresh_osm.py`, not by hand)* |
| Road character | |

**Road character** is the field for what "Road class" can't capture — a
free-text description of what the street actually is (e.g. "tertiary /
residential, mixed along its length"), from what you saw walking it.
Unlike Road class, this one is never touched by the automated refresh; see
[ADR 010](../decisions/010-osm-owned-attributes.md).

## Issues

| ID | Category | Title | Description / location | Coordinates | Status | Reported | Resolved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Category: `accessibility`, `animal_welfare`, `cleanliness`.
Status: `open`, `in_progress`, `resolved`. Coordinates are optional —
leave blank at audit time unless you've already used
`tools/coordinate-picker.html`; see the note below. Leave **ID** blank
too — it's derived as `max(existing ids) + 1` across the whole
`data/observations.json` store when the entry is actually written, not
assigned by hand or scoped to this street.

## Assets

| ID | Category | Title | Description / location | Coordinates | Status | Reported |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Category: `accessibility`, `animal_welfare`, `cleanliness`.
Status: `active`, `inactive`.

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
coordinate exists — it's also the *only* place a street relationship is
recorded on an observation; there is no separate `street_id` field.
`tracking_issue` is set later, only if a Case is opened for that
observation — see [docs/case-tracking.md](../docs/case-tracking.md).
`photo` is set later by the photo-ingestion pipeline. None of these
belong in this template.

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

## Taxonomy gaps

Leave this section empty if everything you found fits `accessibility`,
`animal_welfare`, or `cleanliness` — most audits will. If something
genuinely doesn't fit any of the three, don't force it into an
observation; record it here instead. See
[docs/methodology.md](../docs/methodology.md) step 3.

| What was seen | Where | Date | Why it fits none of the three categories |
| --- | --- | --- | --- |
| | | | |
