#!/usr/bin/env python3
"""Prepare a new observation and open its photo PR — the manual data-entry
workflow, automated up to (never past) "PR opened".

For one observation, this: places the vetted photo under
assets/images/observations/, appends the observation to
data/observations.json (a single flat, globally-numbered store - see
ADR 011), creates a branch, commits exactly those two paths, pushes, and
opens a PR via `gh`. It STOPS there — it never merges; merge is the
maintainer's manual review gate, same as any other PR.

This mirrors the photo PR half of the two-PR ingestion flow described in
docs/methodology.md#photo-ingestion: merging the PR this script opens is
what triggers scripts/photo_pipeline.py (via .github/workflows/
photo-pipeline.yml), which writes coordinates/photo from EXIF and opens the
second, data PR. That second PR still needs its own manual merge.

No street record is required, or ever created here. `--street` is
entirely optional and, when given, is used only for human context in the
branch name, commit message, and PR body — it is never written into the
observation itself. street_id belongs nowhere on an observation; once the
observation has coordinates, scripts/compute_street_proximity.py computes
`nearby_streets` (with the closest street flagged `primary: true`), and
that's the only place a street relationship is recorded. A photo can
become a pin before any street owns it, and street, category, title, and
Case links can all be added afterwards, in any order.

The observation id is always derived, never supplied: it's
max(existing ids in data/observations.json) + 1, computed fresh from
origin/main immediately before writing (same "re-read after checkout"
pattern the id derivation always used, now applied to a counter instead
of a collision check — there is no counter to drift, per ADR 011). The
photo filename is generated from the title
(obs-{id}__{slugified-title}.jpg), not supplied or validated against a
pre-named file; never accepts a title that would slugify to a filename
containing "cover" (Case-cover photos are a separate, filename-only
concept scripts/photo_pipeline.py owns - see
docs/methodology.md#photo-ingestion), and never clobbers an existing
observation id, which is structurally impossible now: the id is only
ever read, incremented, and written once, inside this same operation.

Inputs, in order of precedence (flags override individual sidecar fields;
the sidecar is the base, not all-or-nothing):

    --sidecar path/to/X.json --photo path/to/X.jpg
        Sidecar shape: {"street_id"?: ..., "observation": {"type",
        "category", "title", "description", "status"?}}. --photo is the
        actual image file; if omitted, the sidecar must set
        "photo_filename" and the photo is resolved as sidecar_dir /
        photo_filename.

    --street --photo --type --category --title --description --status
        Full flags, no sidecar. `status` defaults to "open" for issues and
        "active" for assets if omitted. --street is optional.

Both forms build the same observation dict and go through the same
validation and PR-creation path (create_observation_pr), which is also
what tools/serve.py imports and calls for the button UI — this module is
the single source of truth for the operation; nothing here is
CLI-specific except argument parsing.

Usage:
    python3 scripts/new_observation.py --sidecar obs.json --photo obs.jpg
    python3 scripts/new_observation.py --dry-run --photo new-bin.jpg \\
        --type asset --category cleanliness --title "New litter bin" \\
        --description "Outside no. 30"
    python3 scripts/new_observation.py --dry-run --street ana-ventura \\
        --photo new-bin.jpg --type asset --category cleanliness \\
        --title "New litter bin" --description "Outside no. 30"
"""

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OBSERVATIONS_PATH = REPO_ROOT / "data" / "observations.json"
IMAGES_DIR = REPO_ROOT / "assets" / "images" / "observations"
TAXONOMY_PATH = REPO_ROOT / "data" / "taxonomy.json"

# data/taxonomy.json is the single source of truth for the category list,
# the category->icon mapping, the fallback icon, and the issue/asset status
# lists - read once at import time rather than declared inline, so this
# module, tools/serve.py's /taxonomy endpoint, assets/js/map.js, and
# tools/observation-form.html all read the exact same file instead of four
# hand-copied versions. docs/data-taxonomy.md is the human-readable
# companion to that file, not a fifth copy of the data.
_TAXONOMY = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
CATEGORIES = _TAXONOMY["categories"]
CATEGORY_ICON = _TAXONOMY["category_icon"]
FALLBACK_ICON = _TAXONOMY["fallback_icon"]
ISSUE_STATUSES = _TAXONOMY["issue_statuses"]
ASSET_STATUSES = _TAXONOMY["asset_statuses"]

COVER_MARKER = "cover"


class ValidationError(Exception):
    """A precondition the caller can fix (bad input, cover-photo slug,
    etc). No git/gh side effect has happened yet when this is raised,
    except in the one place noted in create_observation_pr where a
    post-checkout re-check fails — see the comment there."""


class GitOperationError(Exception):
    """A git/gh command failed. May carry a pushed branch — the message
    says so explicitly; see create_observation_pr's rollback handling."""


def slugify(title):
    """Mirrors tools/observation-form.html's client-side slugify(), so a
    title produces the same filename segment whether the photo PR is
    prepared by this script or by hand from that form's output."""
    cleaned = re.sub(r"['\"]", "", title.strip().lower())
    cleaned = re.sub(r"[^a-z0-9]+", "-", cleaned)
    return cleaned.strip("-")


def _same_content(path_a, path_b):
    return Path(path_a).read_bytes() == Path(path_b).read_bytes()


def _run_git(args):
    result = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise GitOperationError(f"git {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result


def _current_branch():
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True
    )
    return result.stdout.strip() if result.returncode == 0 else None


def _branch_exists(branch):
    local = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", branch], cwd=REPO_ROOT, capture_output=True, text=True
    )
    if local.returncode == 0:
        return True
    remote = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return remote.returncode == 0


def _remote_owner_repo():
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"], cwd=REPO_ROOT, capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    match = re.search(r"github\.com[:/]+([^/]+)/([^/.]+)(?:\.git)?/?$", result.stdout.strip())
    return f"{match.group(1)}/{match.group(2)}" if match else None


def _next_id(store):
    existing_ids = {obs.get("id") for obs in store.get("observations", [])}
    return max(existing_ids, default=0) + 1


def _build_pr_body(street_id, observation, photo_name):
    street_line = f"- **Street (context only, not stored):** {street_id}\n" if street_id else ""
    return (
        "## Observation\n\n"
        f"{street_line}"
        f"- **Type / category:** {observation['type']} / {observation['category']}\n"
        f"- **Title:** {observation['title']}\n"
        f"- **Description:** {observation['description']}\n"
        f"- **Status:** {observation['status']}\n"
        f"- **Photo:** `assets/images/observations/{photo_name}`\n\n"
        "## Review checklist\n\n"
        "- [ ] Photo is vetted per docs/ethics.md (no identifiable faces/animals/plates)\n"
        "- [ ] Category, status, and description accurately describe the observation\n"
        "- [ ] Not a duplicate of an existing observation\n\n"
        "## What happens after merge\n\n"
        "Merging this PR triggers `photo-pipeline.yml`, which extracts GPS EXIF into "
        "this observation's `coordinates`, sets its `photo` field, strips EXIF from the "
        "served copy, and opens a second, **separate data PR** with those changes. That "
        "PR needs its own review and merge before this observation shows coordinates or "
        "a photo on the map — see docs/methodology.md#photo-ingestion. Once it has "
        "coordinates, run scripts/compute_street_proximity.py to fill in `nearby_streets` "
        "— that's the only place a street relationship gets recorded.\n\n"
        "_Opened by `scripts/new_observation.py` — never auto-merged._\n"
    )


def _open_pr(branch, street_id, observation, photo_name, commit_message):
    """Return (pr_url, manual_pr_command, compare_url). pr_url is None
    (with manual_pr_command set instead) if gh is missing, unauthenticated,
    or fails — the branch is already pushed by the time this runs, so that
    is reported as a fallback, never a hard failure."""
    title = commit_message
    body = _build_pr_body(street_id, observation, photo_name)
    manual_command = "gh pr create --base main --head {} --title {} --body {}".format(
        shlex.quote(branch), shlex.quote(title), shlex.quote(body)
    )
    compare_owner_repo = _remote_owner_repo()
    compare_url = (
        f"https://github.com/{compare_owner_repo}/compare/main...{branch}?expand=1"
        if compare_owner_repo else None
    )

    gh_ready = shutil.which("gh") is not None
    if gh_ready:
        auth = subprocess.run(["gh", "auth", "status"], cwd=REPO_ROOT, capture_output=True, text=True)
        gh_ready = auth.returncode == 0

    if not gh_ready:
        print("gh CLI unavailable or unauthenticated — branch pushed, PR not opened automatically.")
        print(f"Open it manually with:\n  {manual_command}")
        if compare_url:
            print(f"Or via the compare URL: {compare_url}")
        return None, manual_command, compare_url

    result = subprocess.run(
        ["gh", "pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", body],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"gh pr create failed: {result.stderr.strip()}")
        print(f"Branch was pushed. Open the PR manually with:\n  {manual_command}")
        if compare_url:
            print(f"Or via the compare URL: {compare_url}")
        return None, manual_command, compare_url

    pr_url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else None
    return pr_url, None, compare_url


def create_observation_pr(observation, photo_path, street_id=None, dry_run=False, force=False):
    """Validate, then (unless dry_run) derive the id, place the photo,
    append the observation, branch, commit, push, and open a PR. Never
    merges.

    `observation` needs at minimum: type, category, title, description.
    `status` defaults to "open" (issue) / "active" (asset) if omitted.
    id/coordinates/resolved_date/tracking_issue/photo are always forced
    (id derived, the rest null) and nearby_streets is always omitted,
    regardless of what's passed in — those are pipeline/proximity-script/
    coordinate-picker territory, not this script's. `street_id`, if given,
    is used only for the branch name, commit message, and PR body — it is
    never written into the observation.

    Returns a dict: {dry_run, branch, pr_url, manual_pr_command,
    compare_url, actions, observation, photo_destination}. pr_url is None
    when gh isn't available/authenticated or `gh pr create` itself fails —
    manual_pr_command and compare_url are populated in that case instead
    (the branch is still pushed; this is a soft fallback, not a raised
    error). Raises ValidationError for anything the caller can fix before
    touching git, GitOperationError if a git/gh step itself fails.
    """
    photo_path = Path(photo_path)
    observation = dict(observation)

    if not photo_path.exists():
        raise ValidationError(f"Photo not found: {photo_path}")

    if photo_path.suffix.lower() not in (".jpg", ".jpeg"):
        raise ValidationError(f"Photo must be a .jpg/.jpeg file, got '{photo_path.suffix}'.")

    obs_type = observation.get("type")
    if obs_type not in ("issue", "asset"):
        raise ValidationError(f"type must be 'issue' or 'asset', got {obs_type!r}.")

    category = observation.get("category")
    if category not in CATEGORIES:
        raise ValidationError(
            f"'{category}' is not a valid category — expected one of {', '.join(CATEGORIES)}."
        )

    title = (observation.get("title") or "").strip()
    description = (observation.get("description") or "").strip()
    if not title:
        raise ValidationError("title is required.")
    if not description:
        raise ValidationError("description is required.")

    slug = slugify(title)
    if not slug:
        raise ValidationError(f"Title {title!r} slugifies to an empty filename segment — pick a title with at least one letter or number.")
    if COVER_MARKER in slug:
        raise ValidationError(
            f"Title {title!r} slugifies to '{slug}', which contains 'cover' — "
            "scripts/photo_pipeline.py treats any photo filename containing "
            "'cover' as a Case cover photo, never an observation photo. "
            "Rephrase the title to avoid that word."
        )

    status = observation.get("status") or ("open" if obs_type == "issue" else "active")
    valid_statuses = ISSUE_STATUSES if obs_type == "issue" else ASSET_STATUSES
    if status not in valid_statuses:
        raise ValidationError(
            f"'{status}' is not a valid status for an {obs_type} — expected one of {', '.join(valid_statuses)}."
        )

    store = json.loads(OBSERVATIONS_PATH.read_text(encoding="utf-8"))
    preview_id = _next_id(store)
    preview_filename = f"obs-{preview_id}__{slug}.jpg"

    actions = [
        f"Copy photo to assets/images/observations/{preview_filename}",
        f"Append observation #{preview_id} to data/observations.json",
        "Create a branch off origin/main",
        "Commit, push, and open a PR (gh pr create --base main, or print the manual command if gh isn't available)",
    ]

    if dry_run:
        new_observation = {
            "id": preview_id,
            "type": obs_type,
            "category": category,
            "title": title,
            "description": description,
            "coordinates": None,
            "status": status,
            "reported_date": observation.get("reported_date") or date.today().isoformat(),
            "resolved_date": None,
            "tracking_issue": None,
            "photo": None,
        }
        return {
            "dry_run": True,
            "branch": f"obs/{street_id}-{preview_id}" if street_id else f"obs/{preview_id}",
            "pr_url": None,
            "manual_pr_command": None,
            "compare_url": None,
            "actions": actions,
            "observation": new_observation,
            "photo_destination": f"assets/images/observations/{preview_filename}",
        }

    _run_git(["fetch", "origin", "main"])
    branch = f"obs/{street_id}-{preview_id}" if street_id else f"obs/{preview_id}"
    if _branch_exists(branch):
        raise ValidationError(f"Branch '{branch}' already exists (locally or on origin) — refusing to overwrite.")

    original_branch = _current_branch()
    pushed = False
    try:
        _run_git(["checkout", "-b", branch, "origin/main"])

        # Re-read post-checkout: origin/main's copy of the store is now
        # what's on disk, which may differ from the pre-checkout read used
        # for the dry-run preview above (e.g. someone else merged an
        # observation in the meantime) — derive the id fresh against what
        # we're actually about to commit on top of, same "re-read after
        # checkout" reasoning the old per-street id-collision check used.
        store = json.loads(OBSERVATIONS_PATH.read_text(encoding="utf-8"))
        obs_id = _next_id(store)
        filename = f"obs-{obs_id}__{slug}.jpg"
        dest_path = IMAGES_DIR / filename

        if dest_path.exists() and not force and not _same_content(dest_path, photo_path):
            raise ValidationError(
                f"{dest_path.relative_to(REPO_ROOT)} already exists with different content — pass force=True to overwrite."
            )

        new_observation = {
            "id": obs_id,
            "type": obs_type,
            "category": category,
            "title": title,
            "description": description,
            "coordinates": None,
            "status": status,
            "reported_date": observation.get("reported_date") or date.today().isoformat(),
            "resolved_date": None,
            "tracking_issue": None,
            "photo": None,
        }

        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        if dest_path.resolve() != photo_path.resolve():
            shutil.copyfile(photo_path, dest_path)

        store.setdefault("observations", []).append(new_observation)
        OBSERVATIONS_PATH.write_text(json.dumps(store, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        commit_message = f"obs: add {title} on {street_id}" if street_id else f"obs: add {title}"
        dest_rel = dest_path.relative_to(REPO_ROOT)
        observations_rel = OBSERVATIONS_PATH.relative_to(REPO_ROOT)

        _run_git(["add", str(dest_rel), str(observations_rel)])
        _run_git(["commit", "-m", commit_message])
        _run_git(["push", "-u", "origin", branch])
        pushed = True
    except Exception as e:
        if not pushed:
            if original_branch:
                subprocess.run(["git", "checkout", original_branch], cwd=REPO_ROOT, capture_output=True, text=True)
            subprocess.run(["git", "branch", "-D", branch], cwd=REPO_ROOT, capture_output=True, text=True)
            raise GitOperationError(f"{e}\n\nRolled back local branch '{branch}' — nothing was pushed.") from e
        raise GitOperationError(f"{e}\n\nNOTE: branch '{branch}' was already pushed to origin before this failure — it exists remotely; resolve manually rather than re-running.") from e

    pr_url, manual_pr_command, compare_url = _open_pr(branch, street_id, new_observation, filename, commit_message)

    return {
        "dry_run": False,
        "branch": branch,
        "pr_url": pr_url,
        "manual_pr_command": manual_pr_command,
        "compare_url": compare_url,
        "actions": actions,
        "observation": new_observation,
        "photo_destination": str(dest_rel),
    }


def _load_observation_and_photo(args):
    """CLI-only: apply sidecar-then-flags precedence and return
    (street_id, observation_dict, photo_path). All semantic validation
    (valid category, title, cover-slug, ...) happens once, inside
    create_observation_pr — this just assembles the inputs."""
    street_id = None
    observation = {}
    photo_path = None

    if args.sidecar:
        sidecar_path = Path(args.sidecar)
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        street_id = sidecar.get("street_id")
        observation = dict(sidecar.get("observation") or {})
        photo_filename = sidecar.get("photo_filename")
        if photo_filename:
            photo_path = sidecar_path.parent / photo_filename

    if args.street:
        street_id = args.street
    if args.type:
        observation["type"] = args.type
    if args.category:
        observation["category"] = args.category
    if args.title:
        observation["title"] = args.title
    if args.description:
        observation["description"] = args.description
    if args.status:
        observation["status"] = args.status
    if args.photo:
        photo_path = Path(args.photo)

    if not photo_path:
        raise SystemExit("Missing photo path (--photo, or photo_filename in --sidecar).")

    missing = [f for f in ("type", "category", "title", "description") if observation.get(f) is None]
    if missing:
        raise SystemExit(f"Missing required observation field(s): {', '.join(missing)} (via --sidecar or flags).")

    return street_id, observation, photo_path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sidecar", help="Path to a sidecar JSON file: {street_id?, photo_filename, observation}.")
    parser.add_argument("--photo", help="Path to the photo file (required unless the sidecar's photo_filename resolves it).")
    parser.add_argument("--street", help="Street id, for branch/commit/PR context only — never written into the observation. Optional.")
    parser.add_argument("--type", choices=["issue", "asset"], help="Observation type. Overrides the sidecar.")
    parser.add_argument("--category", help="Observation category. Overrides the sidecar.")
    parser.add_argument("--title", help="Observation title. Overrides the sidecar.")
    parser.add_argument("--description", help="Observation description. Overrides the sidecar.")
    parser.add_argument("--status", help="Observation status. Overrides the sidecar; defaults issue->open, asset->active.")
    parser.add_argument("--dry-run", action="store_true", help="Print every planned action; touch nothing.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing photo of the same name if its content differs.")
    args = parser.parse_args()

    street_id, observation, photo_path = _load_observation_and_photo(args)

    try:
        result = create_observation_pr(observation, photo_path, street_id=street_id, dry_run=args.dry_run, force=args.force)
    except (ValidationError, GitOperationError) as e:
        print(f"ERROR: {e}")
        return 1

    if result["dry_run"]:
        print("DRY RUN — no files, commits, or pushes were made.\n")
        print("Planned actions:")
        for action in result["actions"]:
            print(f"  - {action}")
        print("\nObservation JSON that would be inserted:")
        print(json.dumps(result["observation"], indent=2, ensure_ascii=False))
    else:
        print(f"Branch: {result['branch']}")
        if result["pr_url"]:
            print(f"PR opened: {result['pr_url']}")
        else:
            print("Branch pushed, but the PR was not opened automatically (see message above).")
        print("\nSTOPPED at PR-opened — review and merge are manual next steps.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
