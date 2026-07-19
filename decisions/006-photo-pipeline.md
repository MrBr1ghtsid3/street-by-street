# ADR 006: Photo Pipeline

## Status: Accepted

## Context

Field photos are already part of the workflow — the audit walk procedure
(`docs/methodology.md`) has stewards shooting with Mapillary, and the
observation popup on the map has reserved a UI slot for a photo since
before any image pipeline existed (`docs/ethics.md`). Two things are true
at once:

- A geotagged photo already carries, in its own EXIF, exactly the GPS
  coordinate the coordinate-picker tool otherwise requires a person to
  click out by hand — that's a source of coordinate data sitting unused.
- A linked Case (`tracking_issue`) benefits from a photographic record of
  what was actually found, alongside its text description.

Two platforms were compared as the ingestion point. A photo attached
directly to a GitHub Issue has its EXIF stripped by GitHub on upload
(verified) — the GPS data simply isn't there to extract. A photo
committed to this repository keeps its EXIF intact through git. That
makes the repo, not the Issue, the only place GPS extraction is possible
at all — so `assets/images/streets/{street-id}/`, already the home for
observation photos, is the natural ingestion point.

## Decision

Field photos are named `{street-id}__obs-{observationId}__{description}.jpg`
and committed under `assets/images/streets/{street-id}/`. On merge to
`main`, `.github/workflows/photo-pipeline.yml` identifies the newly added
files and runs `scripts/photo_pipeline.py`, which for each photo:

- Extracts GPS from EXIF and writes it to the matching observation's
  `coordinates` field — **only** if that field is currently null. A
  manually-set coordinate (from the coordinate-picker tool) always wins;
  the pipeline never overwrites it.
- **Never creates or deletes an observation or a street file.** A
  filename that doesn't resolve to an existing street and observation id
  is logged and skipped.
- Strips EXIF from the copy of the image the site actually serves, so
  the published file carries no GPS/device metadata of its own — the
  coordinate, where one is published, is published deliberately as
  reviewed JSON data, not incidentally as a leftover image artifact.
- Comments the photo onto the observation's linked Case, if one exists
  (`tracking_issue`), giving the Case a visual record alongside its text.
- Queues all of the above as a **second, separate data PR** (coordinate
  writes + stripped photo re-saves) for human review before merge — the
  photo PR and the data PR it produces are always two distinct review
  points, never one.

This is treated as an **interim measure**. The intended eventual shape is
an intake service (a form, backed by a small function, opening the same
kind of PR) that doesn't require a contributor to know the filename
convention or use git directly. Building that is out of scope here; this
ADR covers the git-commit-triggered version that works today with zero
new infrastructure.

## Alternatives Considered

- **Extract GPS from a GitHub Issue photo attachment instead of a repo
  file** — not viable: GitHub strips EXIF (including GPS) from uploaded
  issue images, confirmed by inspection. There's nothing to extract once
  a photo has gone through an Issue upload.
- **Publish photos with EXIF intact** — rejected outright. GPS/device
  metadata in a served image is exactly the kind of "collect what the
  record needs, not everything it's possible to collect" case
  `docs/ethics.md` argues against — the coordinate the project wants
  public is the one that's been through the same review as the rest of
  the JSON record, not whatever a phone happened to embed.
- **Auto-populate coordinates even when one is already set (EXIF as the
  higher-trust source)** — rejected. The coordinate picker is a
  deliberate, reviewed human action; EXIF GPS accuracy varies by device
  and can be off by tens of metres. Manual data wins, unconditionally.
- **One combined PR for both the photo and the resulting data change** —
  rejected because it collapses two different review questions ("is this
  photo appropriate to publish" vs. "is this extracted coordinate/Case
  comment correct") into one, and because the pipeline can only run once
  the photo already exists on `main` to diff against.

## Consequences

- Publishing a field photo is a **two-PR flow**: the photo PR (human-
  authored, reviewed like any other change) merges first; the pipeline's
  data PR (coordinates + stripped photos) follows automatically and gets
  reviewed second. A steward adding a photo should expect a follow-up PR
  to appear, not treat the first merge as the end of the process.
- Case comments post **immediately** on the pipeline run, ahead of the
  data PR being reviewed or merged — they are not gated on that review.
  This is intentional: the comment is just "here's a photo for this
  Case," not a claim that survives being wrong, whereas the coordinate
  write is a change to the published record and does warrant the extra
  gate.
- The **original, EXIF-intact photo persists in git history** on the
  merged photo-PR commit, even after the pipeline re-saves a stripped
  copy — git doesn't rewrite history to remove it. This is accepted for
  now: these are the project's own photos of public streets whose
  coordinates are, by the project's own choice, published data anyway
  (see `docs/ethics.md`'s structural-fact/individually-identifying-detail
  line). It would matter more, and would need a harder answer, before
  accepting photos from outside the steward's own hand.
- **Public display of the photo on the map itself remains out of
  scope.** The pipeline strips EXIF and leaves the file sitting in
  `assets/images/streets/`, but `index.html`, `assets/js/map.js`, and
  `assets/css/style.css` are untouched by this change — the map's photo
  slot stays a placeholder until the automated face/animal-feature
  blurring pipeline `docs/ethics.md` calls for actually exists.

## Amendment: cover photos and compression

GitHub Issues have no dedicated cover-image field. A photo whose
`{description}` filename segment contains `cover` (case-insensitive) is
now treated as its linked Case's cover: instead of a plain comment, the
pipeline embeds it at the top of the issue body, between
`<!-- sbs-cover-start -->` / `<!-- sbs-cover-end -->` marker comments.
Idempotency is the marker block itself — a run finding existing markers
**replaces** everything between them; a run finding none **prepends** the
block. This means the embed always reflects whichever cover photo was
most recently ingested for that Case, with no duplicate blocks
accumulating on repeat runs. Every non-cover photo keeps the existing
comment-only behaviour, and a cover photo never also gets a comment —
one record per photo, not two.

Separately, every newly-ingested photo (cover or not) is now downscaled
(longest edge capped at 2000px, **never upscaled** — a photo already
under the cap is left alone) and recompressed at JPEG quality 82 during
the same re-save that strips EXIF. This was added because the first real
photo through the pipeline landed at ~5.6 MB unedited-camera-output size:
fine for git to store once, but slow to load as an issue embed and a
future map popup image, and a needless amount of repo bloat for
what the record actually needs. EXIF-stripping behaviour is unchanged by
this — it's the same re-save, just now resizing/recompressing as well as
dropping EXIF, and it now runs unconditionally rather than only when EXIF
was present.

The one real photo ingested before this amendment (merged via PR #18)
predates compression and still sits at its stripped-but-uncompressed
size. It is not touched retroactively by this change — the pipeline only
processes newly added files. A one-off manual re-run against it remains
open as a follow-up, not done here.

## Amendment: detecting renamed/moved photos, and why a git-history trick can't fix an already-stuck one

The trigger step originally filtered on `--diff-filter=A` (added files
only) as its idempotency guard against reprocessing the pipeline's own
re-saves. That filter was too narrow: a photo moved or renamed into its
correct folder shows up in git as `R` (renamed), not `A`, so it was
silently invisible to the pipeline. This actually happened —
`ana-ventura__obs-2__litter.jpg` was relocated into place across two
PRs, never triggered ingestion, and its observation's `photo` field
stayed unset with no error or warning anywhere.

The filter is now `--diff-filter=ACR` (added, copied, renamed). `M`
(modified) stays excluded — that's still the actual idempotency guard,
since it's the pipeline's own EXIF-strip/compression re-save that must
not retrigger itself, and a same-path content change is always `M`,
never `A`/`C`/`R`. For a rename or copy, `git diff --name-only` reports
only the destination path, which is exactly what the script needs.

This class of bug can't be fixed retroactively by re-triggering history
after the fact — specifically, "remove the stuck file, commit, re-add it
identically, commit again" does **not** work in this repo, verified by
simulating it in a scratch git repository: this project merges
exclusively via GitHub's squash-merge, which collapses every PR into one
commit relative to the prior tip. A file that starts and ends a PR at
the same path with the same bytes produces **zero diff entries** once
squashed - not `A`, not `R`, not even `M` - no matter how many
intermediate commits moved it around within the PR branch; squash-merge
only ever diffs the two tree states at the endpoints. A photo already
stuck at its correct path before this fix landed has to be resolved by
directly writing its `photo` field (and re-running the compress/strip
step) in the same PR that ships the filter fix, rather than by any
git-history trick. The filter fix only prevents the *next* rename from
getting lost the same way — it doesn't and can't reach into history for
one that's already landed.
