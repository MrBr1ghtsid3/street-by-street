# ADR 001: Tool Stack

## Status: Accepted

## Context

SBS needs a working set of tools for field data collection, internal
mapping, public-facing mapping, and community communication — all under a
€0 budget, run by a single person. The tools need to be usable without
custom development, since Phase 1 explicitly has no backend (see
[002](002-static-site-architecture.md)).

## Decision

Use free tools that the project already has familiarity with or that have
a low enough learning curve to adopt immediately, rather than building or
self-hosting equivalents.

## Tools Selected

- **Google Sheets** — the primary logging tool. Every observation is
  entered here first; it's the source of truth before anything is
  converted into the GeoJSON/JSON files this repository publishes.
- **Google My Maps** — the internal working map, used to visualise
  observations while they're still being collected and before a street's
  record is considered ready to publish.
- **Felt** — the public-facing map shared with residents and partners,
  used as a more polished, shareable alternative to Google My Maps for
  external audiences while the static site (this repository) matures.
- **Facebook Page** — the primary channel for reaching Bulgarian-speaking
  residents of Tutrakan. Facebook remains the dominant local social
  platform in this demographic, more so than newer platforms.
- **Instagram** — the visual storytelling channel, used for photo-led
  posts (before/after, street walks) that don't fit Facebook's format as
  well.
- **Mapillary** — the field photo-capture tool. Photos are geotagged
  automatically on capture, removing the need for manual location
  tagging, and the imagery is retained by Mapillary independently of this
  project, making it a durable record on its own.

## Consequences

- No tool in the stack requires payment at current scale, which matches
  the €0 budget constraint.
- All of these tools are manual and disconnected from each other — moving
  data from Google Sheets into this repository's GeoJSON/JSON files is a
  manual conversion step today. This is an accepted cost in Phase 1; see
  [002](002-static-site-architecture.md) for why automating that pipeline
  is deferred.
- Reliance on free tiers of third-party platforms (Google, Felt, Meta)
  means the project has no control over their availability, pricing, or
  feature changes. If any of them changes terms unfavourably, the
  affected piece of the stack would need to be replaced — but because
  each tool serves a narrow, swappable role, that's a contained risk
  rather than a project-wide one.
- Sheets-as-source-of-truth means there is currently no single
  version-controlled record of raw observations before they're converted
  to JSON. This is acceptable while the volume of data is small (six
  observations) but would need revisiting if and when conversion becomes
  a bottleneck.

## Alternatives Considered

- **Decidim** — an open-source participatory democracy platform. Rejected
  for Phase 1: it's built for structured participation workflows (proposals,
  voting, budgeting) rather than an observation-logging audit, would
  require self-hosting or a paid instance, and is significant operational
  overhead for a single-person project with six observations to manage.
  Worth reconsidering if SBS later needs structured resident participation
  features that a spreadsheet and a map genuinely can't support.
- **Self-hosted mapping (e.g. a custom Leaflet admin tool) instead of
  Google My Maps** — rejected for the internal working map specifically
  because it would mean building tooling before there's any data to
  justify it. The public map (this repository's `index.html`) is exactly
  that kind of tooling, but for the public-facing, already-published
  layer — not for the messier internal working stage.
