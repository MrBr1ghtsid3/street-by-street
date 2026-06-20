# Street-By-Street

**Street-By-Street (SBS)** is a street-level civic audit methodology, piloted
in Tutrakan, Bulgaria. It is a repeatable way to document a town one street
at a time, capturing both *issues* (potholes, litter, overgrown vegetation,
hazards) and *assets* (shops, green space, infrastructure, heritage) at the
exact location they occur. This repository is also a learning-in-public
project: the documentation, decisions, and data model are kept open so the
process itself can be inspected, questioned, and replicated.

**Status:** active pilot, one street (Ana Ventura), work in progress. See
[Current status](#current-status) below.

**Live site:** <https://mrbr1ghtsid3.github.io/street-by-street/>

**Ethics:** this project documents people, animals, and places it does not
own. Read [docs/ethics.md](docs/ethics.md) before treating anything here as
a model to copy uncritically.

## Why this model

SBS borrows its core idea from [iNaturalist](https://www.inaturalist.org/):
an individual **observation** is the atomic, citable record. Observations
accumulate into a richer picture of a place without anyone having to design
that picture up front. Where iNaturalist rolls observations up into species
and locations, SBS rolls them up into streets, and streets up into a town.

## Two models: state and process

SBS keeps two systems deliberately separate — see
[docs/architecture.md](docs/architecture.md#two-models-state-and-process)
for the full reasoning:

1. **The state model** — City → Street → Observation, all of it in this
   repository's tracked JSON/GeoJSON files. It describes what's currently
   true about a street.
   - **City** — Tutrakan. The map entry point and the level at which
     official Bulgarian statistics (population, housing stock, registered
     businesses) are available.
   - **Street** — the primary organising unit. A street is both something
     you can navigate to and a container for everything observed along it.
     Streets carry their own slow-changing **attributes** (length, dwelling
     count, parking spaces, bus stops, lighting, surface type, official and
     historical name) separately from the **observations** logged on them —
     see [docs/data-taxonomy.md](docs/data-taxonomy.md) for why that split
     matters.
   - **Observation** — the atomic record. A single pothole, a single tree,
     a single shop. Each has a type (`issue` or `asset`), a category, a
     status, a date, and optionally a precise map coordinate.
2. **The process model** — Cases, tracked as GitHub Issues with a Project
   (v2) board on top, separate from the data files entirely. A Case follows
   an incident or request through triage, ownership, an interim workaround
   if any, and resolution. See
   [docs/case-tracking.md](docs/case-tracking.md) and
   [decisions/005-case-tracking.md](decisions/005-case-tracking.md).

A third, deliberate part of the method is **juxtaposing official data
against ground truth**: official Bulgarian statistics stop at the
municipality or settlement level, so they are used as town-level context,
while street-level reality comes entirely from the audit itself. See
[docs/architecture.md](docs/architecture.md) and
[docs/data-sources.md](docs/data-sources.md) for the detail and the
constraint this implies.

## What's actually built

- **Interactive map of Tutrakan** (Leaflet + OpenStreetMap), with streets
  styled by a three-tier status: not started, active, complete.
- **POI-style observation markers** — geotagged observations render as
  coloured pin markers directly on the map (coral for issues, teal for
  assets, with a category icon), independent of the side-panel cards for
  the selected street; clicking a card or a pin navigates to the other.
- **Tutrakan context modal** ("Context" in the header) — an Official Data
  tab (town crest, an oblast locator map generated from OSM data, a
  coordinates/"Get directions" block, and an official stats table) and an
  Unofficial Data tab (ground-observation info cards with issue/WIP
  warning labels).
- **Welcome screen** on first visit, dismissible and remembered via
  `localStorage`.
- **About modal**, including a dedicated link to
  [docs/ethics.md](docs/ethics.md).
- **`tools/coordinate-picker.html`** — a small internal workflow utility
  (not linked from the site navigation) for hand-capturing an
  observation's coordinates by clicking a map and copying the resulting
  JSON snippet. See [docs/methodology.md](docs/methodology.md).
- **Case tracking** via GitHub Issues (`.github/ISSUE_TEMPLATE/case.yml`)
  and a Project (v2) board, separate from the observation data — see
  [docs/case-tracking.md](docs/case-tracking.md).
- **Quarterly automated OSM data refresh** (`.github/workflows/refresh-data.yml`),
  landing as a pull request for human review rather than a direct commit —
  see [decisions/004-data-update-strategy.md](decisions/004-data-update-strategy.md).

## Repository structure

```text
street-by-street/
├── index.html              interactive map of Tutrakan (Leaflet)
├── assets/                  CSS, JS, and images for the map
├── data/                    GeoJSON street base layer + per-street JSON records
├── docs/                    charter, taxonomy, methodology, architecture, data sources, ethics, case tracking
├── decisions/               architecture decision records (ADRs)
├── templates/               blank street-audit template for onboarding a new street
├── tools/                   internal workflow utilities (e.g. the coordinate picker), not part of the public site
├── scripts/                 data-refresh and data-entry-support scripts (OSM refresh, freshness check, street-proximity)
└── .github/                 GitHub Actions workflows and the Case issue form
```

## Current status

The methodology is being piloted on a single street, **Ana Ventura**
(ul. "Ana Ventura", 7601 Tutrakan), as proof of concept — 1 of roughly 100
named streets in the town. Six seed observations (three issues, three
assets) have been logged. The street base layer underneath the map is real
OpenStreetMap geometry pulled via the Overpass API; everything other than
Ana Ventura is shown as not-yet-audited.

## Viewing the map locally

`index.html` loads `data/*.json` and `data/*.geojson` with `fetch()`, which
browsers block under the `file://` protocol — there is no build step, but
there is a same-origin HTTP requirement. You need to serve the directory
over HTTP, for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 in a browser
```

Any other static file server (`npx serve`, VS Code's Live Server, etc.)
works equally well.

## Deploying to GitHub Pages

This project needs no build step, but it does deploy via a GitHub Actions
workflow (`.github/workflows/deploy.yml`) rather than the "serve the branch
directly" Pages mode:

1. Go to **Settings → Pages**.
2. Under **Source**, choose **GitHub Actions** (not "Deploy from a
   branch") — see the deployment note in
   [decisions/002-static-site-architecture.md](decisions/002-static-site-architecture.md).
3. Push to `main` (or trigger the workflow manually). The workflow uploads
   the repository as-is and publishes it; no separate build is run.

Once enabled, the site is published at:

```text
https://<github-username>.github.io/street-by-street/
```

(substituting the account or organisation that owns this repository — for
this repository, that's the live-site link at the top of this file).

## Tooling and process

The original tool stack (Google Sheets, Google My Maps, Felt, Facebook,
Instagram, Mapillary) and the static-site architecture are recorded as
formal decisions in [decisions/](decisions/), along with the later
decisions to automate quarterly OSM refreshes and to track incidents/
requests ("Cases") via GitHub Issues and Projects rather than in the
observation data itself. The day-to-day audit process — how to walk a
street, what to capture, how often to revisit, and where Case tracking
fits in — is documented in [docs/methodology.md](docs/methodology.md).

## Licence

All content in this repository is released under
[CC BY 4.0](LICENSE) — you may copy, adapt, and reuse it for any purpose,
provided you give appropriate credit.
