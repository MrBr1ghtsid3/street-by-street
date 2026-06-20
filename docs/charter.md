# Initiative Charter

## Problem Statement

Tutrakan, like many small Bulgarian towns, is documented at the municipal
level by national statistics but not at street level. Issues such as
deteriorating road surfaces, illegal dumping, and overgrown public land
accumulate without a record that's specific enough to act on, while local
assets — small businesses, mature trees, disused infrastructure with reuse
potential — go unrecorded and are easy to lose to neglect or redevelopment.
There is no existing public, structured, street-level record of either.

## Goal

Build a low-cost, repeatable method for documenting a town one street at a
time, producing a public record of issues and assets that residents,
local government, and civic groups can use, and that can be replicated by
anyone in any other town without specialist tools or budget.

This work operates under an explicit ethics commitment — see
[docs/ethics.md](ethics.md) — particularly around what gets published
about identifiable people and animals, as distinct from structural facts
about the place itself.

## Scope (In / Out)

**In scope:**

- The street as the unit of record: every street is both a navigable
  destination and a container for the observations made on it.
- Logging discrete, dated observations (issues and assets) tied to a street
  and, where possible, a location within it.
- Capturing slow-changing street attributes (length, dwelling count, surface
  type, and so on) separately from the observations themselves.
- Publishing an interactive map and per-street reports as a static site.
- Juxtaposing official town/municipality-level statistics against
  street-level observations to surface the gap between the official record
  and what's actually there.

**Out of scope, for now:**

- Official street-level data of any kind. Bulgarian open data
  (`data.egov.bg`, NSI, census releases) stops at municipality or
  settlement granularity — there is no authoritative street-level dataset to
  reconcile against. SBS observations are the only street-level record;
  they are not being checked against a government equivalent because none
  exists.
- A database or backend. Phase 1 is static files only (see
  [decisions/002-static-site-architecture.md](../decisions/002-static-site-architecture.md)).
- Resident-submitted data. Until there's a mechanism for accepting
  third-party submissions safely, all observations are logged by the
  project steward(s).
- Coverage of every street in Tutrakan. The pilot covers one street;
  expansion is deliberately incremental.

## Constraints

- **Solo capacity.** The project is currently run by one person. Tooling
  and process must work without a team.
- **Participation density.** Tutrakan's municipality population is
  approximately 11,726 (2023 est., NSI). A town this size cannot support a
  large volunteer base; the methodology has to produce value even with very
  few contributors, and ideally with just one.
- **Tool budget: €0.** Every tool in the current stack (Google Sheets,
  Google My Maps, Felt, Facebook, Instagram, Mapillary, GitHub Pages) is
  free at the scale this project currently operates at.

## Decisions Already Made

- **Tool stack** — Google Sheets for logging, Google My Maps for the
  internal working map, Felt for the public-facing map, Facebook as the
  primary Bulgarian-language channel, Instagram for visual storytelling,
  Mapillary for field photo capture. See
  [decisions/001-tool-stack.md](../decisions/001-tool-stack.md).
- **Static-site architecture** — Leaflet + GeoJSON + GitHub Pages, no
  backend, in Phase 1. See
  [decisions/002-static-site-architecture.md](../decisions/002-static-site-architecture.md).
- **Three-level data model** — City → Street → Observation, with street
  attributes and observations stored separately. See
  [decisions/003-data-model.md](../decisions/003-data-model.md).
- **Data update strategy** — quarterly automated OSM refresh via a
  reviewed pull request; official statistics flagged stale, never
  auto-updated. See
  [decisions/004-data-update-strategy.md](../decisions/004-data-update-strategy.md).
- **Case tracking** — GitHub Issues plus a Project (v2) board for
  triage/ownership/resolution, kept separate from the observation state
  model. See
  [decisions/005-case-tracking.md](../decisions/005-case-tracking.md).

## Open Questions

The Ana Ventura pilot is designed to answer these before the methodology is
extended to more streets:

- How long does a full audit of one street actually take, end to end
  (walk, log, write up)?
- Is the attributes/observations split sufficient, or do real streets
  surface fields that don't fit either bucket?
- Can street length and basic geometry be sourced reliably from
  OpenStreetMap, or does every street need a manual measurement?
- Does the official-vs-observed juxtaposition produce anything meaningful
  at the scale of a single street, given that official data only exists at
  municipality level?
- Is a single steward sustainable, or does the update cadence need to
  relax once more than a handful of streets are tracked?

## Success Criteria for the Ana Ventura PoC

- A complete street record exists: attributes captured where available,
  six observations logged with category, status, and date, and a sourced
  (or explicitly marked unverified) trivia note.
- The map renders Ana Ventura distinctly from the unaudited street network
  and the detail panel displays correctly when clicked.
- The process from "walk the street" to "published record" is documented
  well enough in [docs/methodology.md](docs/methodology.md) that a second
  person could repeat it on a different street without further
  instruction.
- At least one of the open questions above has a concrete answer recorded
  in this charter or in a follow-up decision record.

## Roadmap / Not yet implemented

In keeping with [docs/ethics.md](ethics.md)'s own commitment to not
overstate where things stand, a few things sometimes discussed for this
project are deliberately **not built yet** and shouldn't be read as
implied by anything elsewhere in these docs:

- **A public submission form for non-technical contributors.** Today,
  every observation is logged by the project steward via a direct JSON
  edit. There is no form, app, or other intake mechanism for a resident
  to submit a report themselves.
- **Automated, LLM-assisted inspection of public submissions, with
  mandatory human review before merge.** No such pipeline exists. If a
  submission form is ever built, anything resembling automated triage of
  incoming reports would need a human review gate before anything reaches
  the published record — not just as a nice-to-have, but as a hard
  requirement.
- **Photo capture with automatic privacy blurring at ingestion.** The
  observation popup on the map already reserves a UI slot for a photo
  with a caption describing this intent (see
  [docs/ethics.md](ethics.md)), but no image upload, storage, or
  face/animal-feature blurring pipeline exists. It's a placeholder, not a
  working feature.
