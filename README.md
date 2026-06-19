# street-by-street

**street-by-street (SBS)** is a street-level civic audit methodology, piloted
in Tutrakan, Bulgaria. It is a repeatable way to document a town one street
at a time, capturing both *issues* (potholes, litter, overgrown vegetation,
hazards) and *assets* (shops, green space, infrastructure, heritage) at the
exact location they occur. This repository is also a learning-in-public
project: the documentation, decisions, and data model are kept open so the
process itself can be inspected, questioned, and replicated.

## Why this model

SBS borrows its core idea from [iNaturalist](https://www.inaturalist.org/):
an individual **observation** is the atomic, citable record. Observations
accumulate into a richer picture of a place without anyone having to design
that picture up front. Where iNaturalist rolls observations up into species
and locations, SBS rolls them up into streets, and streets up into a town.

## The three-level model

1. **City** — Tutrakan. The map entry point and the level at which official
   Bulgarian statistics (population, housing stock, registered businesses)
   are available.
2. **Street** — the primary organising unit. A street is both something you
   can navigate to and a container for everything observed along it. Streets
   carry their own slow-changing **attributes** (length, dwelling count,
   parking spaces, bus stops, lighting, surface type, official and historical
   name) separately from the **observations** logged on them — see
   [docs/data-taxonomy.md](docs/data-taxonomy.md) for why that split matters.
3. **Observation** — the atomic record. A single pothole, a single tree, a
   single shop. Each observation has a type (`issue` or `asset`), a category,
   a status, and a date.

A second, deliberate part of the method is **juxtaposing official data
against ground truth**: official Bulgarian statistics stop at the
municipality or settlement level, so they are used as town-level context,
while street-level reality comes entirely from the audit itself. See
[docs/architecture.md](docs/architecture.md) and
[docs/data-sources.md](docs/data-sources.md) for the detail and the
constraint this implies.

## Repository structure

```text
street-by-street/
├── index.html              interactive map of Tutrakan (Leaflet)
├── assets/                  CSS and JS for the map
├── data/                    GeoJSON street base layer + per-street JSON records
├── docs/                    charter, taxonomy, methodology, architecture, data sources
├── decisions/               architecture decision records (ADRs)
└── templates/               blank street-audit template for onboarding a new street
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
browsers block under the `file://` protocol. You need to serve the directory
over HTTP, for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 in a browser
```

Any other static file server (`npx serve`, VS Code's Live Server, etc.)
works equally well.

## Deploying to GitHub Pages

This project needs no build step, so GitHub Pages can serve it directly from
the repository:

1. Go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Select the `main` branch and the `/ (root)` folder, then save.

Once enabled, the site is published at:

```text
https://<github-username>.github.io/street-by-street/
```

(substituting the account or organisation that owns this repository).

## Tooling and process

The current tool stack (Google Sheets, Google My Maps, Felt, Facebook,
Instagram, Mapillary) and the static-site architecture are recorded as
formal decisions in [decisions/](decisions/). The day-to-day audit process —
how to walk a street, what to capture, how often to revisit — is documented
in [docs/methodology.md](docs/methodology.md).

## Licence

All content in this repository is released under
[CC BY 4.0](LICENSE) — you may copy, adapt, and reuse it for any purpose,
provided you give appropriate credit.
