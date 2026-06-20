# Architecture

## Two models: state and process

SBS is built from two separate systems, not one hierarchy with an extra
level bolted on:

- **The state model** — City → Street → Observation, described below.
  Everything in it lives in this repository's tracked JSON/GeoJSON files,
  and it describes *what's currently true* about a street.
- **The process model** — Cases, tracked as GitHub Issues with a Project
  (v2) board on top (see [decisions/005-case-tracking.md](../decisions/005-case-tracking.md)
  and [case-tracking.md](case-tracking.md)). It describes *what's being
  done about* something, separately from whether the underlying
  observation has been marked resolved.

A Case is not a fourth level of the state hierarchy. It lives in a
different system (GitHub's issue tracker, not this repo's data files) and
links back to an observation by a documented text convention
(`tracking_issue` on the observation, `Tracks:`/`Follows-from:` in the
Issue body) rather than a shared schema or a foreign key. The two systems
are kept deliberately separate so that "is this fixed" (state) and "who's
working on it and what's been tried" (process) don't get conflated into
one record that tries to do both jobs.

## The three-level hierarchy

SBS organises everything into three levels:

- **City** — Tutrakan. The map's entry point, and the only level at which
  official Bulgarian statistics exist.
- **Street** — the primary unit. Each street has its own slow-changing
  attributes and its own list of observations.
- **Observation** — the atomic record: a single issue or asset, dated and
  located as precisely as possible.

City rolls up from streets; streets roll up from observations. Nothing is
recorded at the city level directly except official context figures, which
exist because no street-level equivalent is available (see
[data-sources.md](data-sources.md)).

## Static-site data flow

Phase 1 has no backend (see
[decisions/002-static-site-architecture.md](../decisions/002-static-site-architecture.md)).
The whole site is static files served by GitHub Pages, and the data flow on
page load is:

1. **`index.html`** loads Leaflet from a pinned CDN URL and initialises a
   map centred on Tutrakan, with a greyscale base tile layer.
2. **`assets/js/map.js`** runs `fetch('data/tutrakan-streets.geojson')` and
   renders every street as a line on the map. Streets are styled by
   `properties.status` — unaudited streets render as thin, muted grey
   lines; audited streets render in the brand accent colour at a heavier
   weight, so the one or two completed streets visually stand out against
   the rest of the town.
3. **On click of an audited street**, the JS does
   `fetch('data/streets/{id}.json')` and renders the result into a side
   panel: the street's trivia, attributes, official context, and
   observations list, colour-coded by issue/asset and status.
4. Unaudited streets are clickable but show a short "not yet audited"
   message rather than attempting to fetch a JSON record that doesn't
   exist yet.

This flow has no server-side moving parts: every fetch is a static file,
versioned in Git, and the entire site can be cloned and served from any
static host.

## POI markers and street proximity

Beyond the street's detail panel, observations with a non-null
`coordinates` field render as individual point markers on the map itself,
not just as cards in the panel:

- **Rendering** (`assets/js/map.js`) — for the currently selected street
  only, each geotagged observation gets a teardrop-shaped `L.divIcon` pin
  (coral for issues, teal for assets, matching the existing legend
  colours), with a Tabler icon inset for its category. Markers are held
  in a single `L.layerGroup` that's cleared every time a different street
  is clicked, so pins never accumulate across streets. Clicking a pin
  opens a popup with the observation's title, category, status, a photo
  placeholder (see [ethics.md](ethics.md) — no image upload or blurring
  pipeline exists yet, this is a reserved UI slot), its date, any nearby
  streets, and its Case link if one exists. Clicking the matching card in
  the side panel does the same thing in reverse: `map.flyTo()` to the
  marker's coordinates and opens its popup, giving the panel and the map
  two-way navigation between the same observation.
- **Street proximity** (`scripts/compute_street_proximity.py`) — a
  stdlib-only script, run manually as part of the data-entry workflow
  (see [methodology.md](methodology.md)), not in CI. For every geotagged
  observation, it projects the point and every street's geometry from
  `data/tutrakan-streets.geojson` onto a local equirectangular plane and
  computes point-to-segment distance, writing a `nearby_streets` array
  back onto the observation: the closest street as `primary: true`, and
  any other street within 50m flagged as a secondary candidate. This is a
  signal for a human to consider, not an automatic reassignment of which
  street "owns" an observation.

## Data model

Two JSON shapes carry all the data: the GeoJSON base layer (one feature per
street, used for rendering the map) and the per-street detail record (one
file per audited street, used for the detail panel).

**`data/tutrakan-streets.geojson`** — a `FeatureCollection` of
`LineString`/`MultiLineString` features, one per street, each with these
properties:

```json
{
  "id": "ana-ventura",
  "name": "Ana Ventura",
  "name_bg": "Ана Вентура",
  "name_historical": null,
  "status": "active",
  "audited": true,
  "length_m": 1901.2,
  "observations_count": 6,
  "issues_open": 3,
  "last_updated": "2026-06-12"
}
```

`id` is the slug used to look up the matching file in `data/streets/`.
`status` and `audited` drive map styling; `observations_count` and
`issues_open` let the map show a count without a second fetch.

**`data/streets/<id>.json`** — the full street record, split into the
blocks described in [data-taxonomy.md](data-taxonomy.md):

```json
{
  "meta": { "id": "...", "name": "...", "name_bg": "...", "name_historical": null,
            "status": "active", "last_updated": "...", "steward": { "name": "...", "contact": "..." } },
  "attributes": { "length_m": null, "dwellings": null, "parking_spaces": null,
                   "bus_stops": null, "lighting_count": null, "surface_type": null,
                   "road_class": null },
  "trivia": { "text": "...", "sources": [], "verified": false },
  "official_context": [ { "metric": "...", "value": "...", "source": "...",
                            "source_date": "...", "level": "municipality" } ],
  "observations": [ { "id": 1, "type": "issue", "category": "road", "title": "...",
                        "description": "...", "coordinates": null, "status": "open",
                        "reported_date": "...", "resolved_date": null } ]
}
```

`meta` and `attributes` correspond to the street-attributes half of the
taxonomy; `observations` is the observations half. `trivia` and
`official_context` are additional blocks specific to the detail record —
trivia carries a `verified` flag so unsourced claims are visibly marked as
such, and official context carries a mandatory `source` and `source_date`
on every entry. `official_context` is real, supported end-to-end by the
rendering code (`map.js` renders it conditionally when present) — but as
of writing, `data/streets/ana-ventura.json` has no `official_context`
entries yet, so the only official figures currently visible on the live
site are the ones hardcoded into the Tutrakan context modal in
`index.html` (population, administration, distances, etc.), which is
city-level context, not a per-street `official_context` block. The two
are separate, legitimate uses of "official context" at different levels
of the hierarchy; neither has been populated for a street yet.

## Deployment

Two GitHub Actions workflows run this project; neither requires a manual
step under normal operation:

- **`.github/workflows/deploy.yml`** — triggers on every push to `main`
  (and via manual `workflow_dispatch`). It uses GitHub's native Pages
  actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`),
  which means the repository's **Settings → Pages → Source** must be set
  to **"GitHub Actions"**, not "Deploy from a branch" — see the
  deployment note in
  [decisions/002-static-site-architecture.md](../decisions/002-static-site-architecture.md).
  There is no build step; the entire repository is uploaded as the Pages
  artifact as-is.
- **`.github/workflows/refresh-data.yml`** — runs quarterly on a cron
  schedule (and via manual `workflow_dispatch`), re-running
  `scripts/refresh_osm.py` and `scripts/check_data_freshness.py`, then
  opening a pull request with any changes rather than committing to
  `main` directly (see [decisions/004-data-update-strategy.md](../decisions/004-data-update-strategy.md)).
  Merging that PR is an ordinary push to `main`, which the deploy workflow
  above picks up automatically — the two workflows don't call each other
  directly.

## Official-vs-observed juxtaposition

A core part of SBS is putting official statistics next to what's actually
observed on the ground, so the gap between the two becomes visible — for
example, registered businesses at the municipality level next to which
shops on a given street are actually open.

**The constraint this runs into immediately: official Bulgarian data does
not go below municipality (община) or settlement level.** There is no
official dataset broken down by street. This means:

- Every `official_context` entry in a street record is necessarily
  **town- or municipality-level context**, not a street-level figure being
  verified. It tells you what's true for Tutrakan as a whole, not what's
  true for Ana Ventura specifically.
- The juxtaposition this project can actually do is: *"the municipality
  reports X; here is what one street within it looks like."* That's a
  meaningfully different (and weaker) claim than *"the municipality
  reports X for this street; we observed Y,"* and the documentation and UI
  should never blur the two.
- Street-level reality, in this model, only ever comes from SBS's own
  observations. There's nothing official to check it against, which is
  also exactly why recording it has value.

See [data-sources.md](data-sources.md) for the specific sources this
applies to and the citation rule that keeps the distinction visible in the
data itself.
