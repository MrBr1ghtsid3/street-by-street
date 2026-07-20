# Street-by-Street Methodology

## Overview

SBS audits a town one street at a time. Each audit produces a street record
made of two parts: a small set of slow-changing **attributes** about the
street, and a growing list of dated **observations** — issues and assets —
found on it. See [data-taxonomy.md](data-taxonomy.md) for the full field
and category reference, and [architecture.md](architecture.md) for how
these records flow into the map.

## Audit walk procedure

1. **Walk the full length of the street**, start to end, on foot. Take
   photos with Mapillary as you go — it geotags automatically and the
   imagery becomes a durable, reusable record independent of this project.
2. **Log observations as you find them**, rather than trying to remember
   everything afterwards. Each one needs: type (issue/asset), category,
   a short title, a description with a location note (nearest house
   number, junction, or landmark), and today's date as `reported_date`.
3. **Note anything you can't classify confidently.** Use category `other`
   rather than forcing a fit, and flag it for review — recurring `other`
   entries are a sign the taxonomy needs a new category.
4. **Don't try to be exhaustive on the first pass.** A street record that
   captures the obvious issues and assets is more useful published than a
   perfect record that never ships. Revisits add to it over time.

When an observation's exact location is wanted, open
`tools/coordinate-picker.html` locally (or via the deployed site if
accessible) — it's an internal workflow tool, not linked from the main
site. Click the matching point on the map, copy the resulting `{ "lat":
…, "lng": … }` snippet, and paste it into that observation's
`coordinates` field in its street's JSON file before committing. See
[data-taxonomy.md](data-taxonomy.md) for the field's exact shape.

After adding coordinates and before committing, run
`python3 scripts/compute_street_proximity.py` from the repo root. It
walks every street's geometry in `data/tutrakan-streets.geojson` and
writes a `nearby_streets` array back onto each geotagged observation,
flagging the closest street as `primary` and any other street within
50m as a secondary candidate. This is a manual, on-demand step in the
same data-entry workflow as the coordinate picker — it is **not** wired
into CI and never runs automatically, since which street is "primary"
for a borderline observation is ultimately a judgement call the script
only assists, it doesn't make.

## Where Case tracking fits in

Logging an observation and tracking it through to resolution are two
different steps, deliberately kept apart — see
[case-tracking.md](case-tracking.md) for the full state-vs-process
rationale. In the audit workflow specifically:

- Most observations need nothing further than what's described above —
  they're logged, and stay as a dated state record until a later revisit
  changes their `status`.
- When an observation needs active follow-up (it's urgent, it needs
  someone assigned, it needs a workaround while a proper fix is pending,
  or it's a recurrence of something already patched once), open a Case
  using the `case.yml` issue form rather than trying to track that
  process inside the JSON record. Reference the observation in the
  Case's description (`Tracks: streets/{street-id} observation #{id}`)
  and set that observation's `tracking_issue` field to the new Issue
  number.
- When the Case is closed, update the observation's `status` to
  `resolved` (and set `resolved_date`) as a manual step — closing the
  Case does not do this automatically.

### Resolution and status

When an intervention is worth recording publicly beyond a bare status
change — who did it, how long it took, what it cost — add a `resolution`
object to the observation (see
[data-taxonomy.md](data-taxonomy.md#resolution)). It's a hand-authored
summary, written from what actually happened, not copied automatically
from the Case.

`resolution.outcome` decides what to do with `status`, as a manual step
taken in the same edit:

- `outcome: "resolved"` — set `status` to `resolved` (and `resolved_date`,
  as above).
- `outcome: "partial"` or `"workaround"` — leave `status` as `open` (or
  `in_progress`); the resolution summary documents what was tried without
  claiming the observation is closed.

Nothing enforces this pairing in code — it's the same kind of judgement
call as setting `status` itself.

### Photo ingestion

Field photos live under `assets/images/streets/{street-id}/`, one folder
per street, named following the convention
`{street-id}__obs-{observationId}__{description}.jpg` — e.g.
`ana-ventura__obs-2__litter-before.jpg`. The `{description}` segment is
free text (kebab-case is conventional but not enforced); it's there so
several photos of the same observation stay distinguishable
(`...-before.jpg`, `...-after.jpg`) without colliding.

If `{description}` contains the word `cover` anywhere (case-insensitive —
`...__cover.jpg`, `...__litter-cover.jpg`), that photo is treated as the
linked Case's **cover photo**: instead of a plain comment, the pipeline
embeds it at the top of the Case's issue body, since GitHub Issues have
no dedicated cover-image field of their own. Naming a second photo
`cover` for the same Case replaces the first — the embed always reflects
whichever cover photo was most recently ingested. Every other photo keeps
the existing comment-only behaviour.

Photos must come straight off the camera/phone, not through a chat app —
Mapillary is still the primary field-capture tool per the walk procedure
above, but where a photo is committed directly to this repo for an
observation or a Case, it needs intact EXIF (in particular GPS) for the
ingestion pipeline to do anything with it. WhatsApp, Telegram, and most
chat apps re-encode images and strip EXIF (including GPS) on send —
transfer photos by cable, AirDrop, or a file-preserving method instead.

Ingestion is a two-PR flow, both requiring the usual review before
merge:

1. **Photo PR** — the photo file(s) are added under
   `assets/images/streets/{street-id}/` and merged to `main` like any
   other change.
2. **Pipeline run** — merging the photo PR triggers
   `.github/workflows/photo-pipeline.yml`, which runs
   `scripts/photo_pipeline.py` against the newly added files. For each
   photo it: extracts GPS EXIF and, if the observation has no
   `coordinates` yet, writes them; writes the observation's `photo` field
   to point at the image, unless it's a cover photo (covers are
   Case-only and never populate `photo` — last non-cover photo ingested
   for an observation wins, so it stays a single primary map photo);
   posts the photo to the observation's linked Case (`tracking_issue`),
   if any — as the cover embed if the filename marks it `cover`,
   otherwise as a plain comment; downscales and recompresses the image
   (longest edge capped at 2000px, JPEG quality 82, never upscaled) and
   strips EXIF from the served copy; and opens a second, **data PR** with
   the coordinate/image/`photo`-field changes for review. See
   [ADR 006](../decisions/006-photo-pipeline.md) for the full design and
   its limits (manual coordinates are never overwritten, no observation
   is ever created by the pipeline).

   Compression keeps the repository from accumulating full-resolution
   camera output (an unedited phone photo lands around 5–6 MB; a raw
   embed that size is slow to load in an issue or a future map popup)
   without needing a separate image host.

### Observation intake form

`tools/observation-form.html` is an internal workflow tool, alongside
`tools/coordinate-picker.html` — not linked from the main site. Open it
locally, fill in a new observation (street, id, type, category, title,
description, status) and attach an already-vetted photo. It **prepares** a
correct commit; it does not submit or upload anything:

- It fetches `data/tutrakan-streets.geojson` to populate the street
  dropdown, and `data/streets/{street-id}.json` on street selection to
  suggest the next non-colliding observation id (or flag a brand-new
  street, which starts at id 1).
- It renames the attached photo to
  `{street-id}__obs-{id}__{slugified-title}.jpg`, following the naming
  convention above.
- It assembles the observation object in the exact shape documented in
  [data-taxonomy.md](data-taxonomy.md), with `coordinates`, `resolved_date`,
  `tracking_issue`, and `photo` left `null` for the photo pipeline and
  later manual steps to fill in.
- It prints the `mv`/`git` commands to move the photo into place and open
  the photo PR.

It sits at the same point in the data-entry workflow as the coordinate
picker: after a photo has been vetted per [ethics.md](ethics.md) and
before the photo PR is opened. It does not shortcut the two-PR ingestion
flow described above — the maintainer still opens the photo PR by hand,
and the pipeline still opens the follow-up data PR once that's merged.

### Opening the photo PR: CLI or button UI

`scripts/new_observation.py` picks up where the intake form's output
leaves off: given an observation and its vetted photo, it places the
photo, inserts the observation into the street JSON, and creates a
branch, commit, push, and PR — the git/gh side of the workflow the
maintainer would otherwise do by hand from the intake form's printed
commands. Like the intake form, it **prepares** the photo PR; it never
merges, and it never touches `coordinates` (still pipeline/coordinate-picker
territory) or creates a street file.

Two ways to run it, both stopping at "PR opened":

- **CLI:**

  ```bash
  python scripts/new_observation.py --sidecar observation.sbs.json --photo observation.jpg
  ```

  (or the equivalent `--street --id --type --category --title --description`
  flags instead of a sidecar file — see the script's `--help`). Add
  `--dry-run` to print the planned actions and the JSON that would be
  inserted without touching git or the filesystem.

- **Button UI:** `tools/serve.py` is a local Flask wrapper around the same
  script — it imports and calls `create_observation_pr` directly rather
  than duplicating any of its logic:

  ```bash
  pip install flask
  python tools/serve.py
  # open http://127.0.0.1:8765, fill in the form, tick "Dry run" to preview
  # first, then untick it and press Submit to actually branch/commit/push/PR
  ```

  It binds to `127.0.0.1` only, deliberately — the server runs `git`/`gh`
  with repo write access on every submit, with no authentication in front
  of it, so it must never be reachable from anything but this machine.

Either path stops at PR-opened. Review and merge are still the manual
gate they always were, and merging still only triggers the photo
pipeline's *second*, data PR (coordinates/photo from EXIF) — that one
needs its own separate merge too, per the two-PR flow above.

## Attribute capture

Attributes are captured once per street, ideally during or shortly after
the first walk:

- **Length and geometry** — use OpenStreetMap rather than measuring by
  hand. The `data/tutrakan-streets.geojson` base layer in this repository
  is pulled directly from OSM via the Overpass API, and street length is
  derived from that geometry. This is free, already reasonably accurate
  for a small town, and means attribute capture doesn't require any
  surveying equipment.
- **Traffic** — record a qualitative band (`low` / `medium` / `high`)
  rather than a count. A solo steward walking a street once cannot produce
  a reliable traffic count, and a precise-looking number that's actually a
  guess is worse than an honest qualitative estimate.
- **Everything else** (dwellings, parking spaces, bus stops, lighting,
  surface type, road class) — captured by direct observation during the
  walk. Where a figure genuinely isn't known yet, leave it `null` rather
  than guessing, and note it as a TODO in the street's record.

> **Outstanding TODO:** the current `data/tutrakan-streets.geojson` only
> includes named `highway` ways pulled from OSM — unnamed tracks and
> driveways are excluded since they don't correspond to an addressable
> street. If OSM coverage for a given street turns out to be incomplete or
> wrong, correct it upstream in OpenStreetMap where possible, since that
> benefits everyone who uses the data, not just this project.

## Steward role

Each street has a named steward responsible for keeping its record
current. In the pilot phase, with a single contributor, the steward role
exists mostly as a placeholder in the schema (`meta.steward` in each
street's JSON record) — but the intent is that, as the project grows past
one person, ownership of a street can be handed to whoever is best placed
to keep visiting it (a resident, a local group). The steward field is
deliberately separate from the observations so that ownership can change
without rewriting history.

## Update cadence

There's no fixed schedule yet — this is one of the open questions the
Ana Ventura pilot is meant to inform (see
[charter.md](charter.md#open-questions)). Until a cadence is set, treat a
street as due for revisit whenever something is reported informally (a
Facebook comment, a conversation) that contradicts the current record, and
otherwise revisit opportunistically.

## Replication guide

To onboard a new street:

1. Copy [templates/street-audit.md](../templates/street-audit.md) and fill
   in the street's display name, Cyrillic name, and historical name (if
   known — otherwise leave it explicitly marked TODO).
2. Walk the street per the procedure above and fill in the Attributes,
   Issues, Assets, Trivia, and Official Context sections.
3. Convert the filled-in template into a JSON record under
   `data/streets/<street-id>.json`, following the structure used by
   `data/streets/ana-ventura.json`. The template's sections map directly
   onto the JSON schema's blocks, so this is a mechanical conversion, not a
   rewrite.
4. Add or update the street's entry in `data/tutrakan-streets.geojson`:
   set `status` and `audited` to reflect the new record, and update
   `observations_count` and `issues_open` to match.
5. Confirm the street renders correctly on the map and that its detail
   panel loads before considering the audit published.
