#!/usr/bin/env python3
"""Prepare a new observation and open its photo PR — the manual data-entry
workflow, automated up to (never past) "PR opened".

For one observation on one already-audited street, this: places the vetted
photo under assets/images/streets/{street_id}/, appends the observation to
data/streets/{street_id}.json, creates a branch, commits exactly those two
paths, pushes, and opens a PR via `gh`. It STOPS there — it never merges;
merge is the maintainer's manual review gate, same as any other PR.

This mirrors the photo PR half of the two-PR ingestion flow described in
docs/methodology.md#photo-ingestion: merging the PR this script opens is
what triggers scripts/photo_pipeline.py (via .github/workflows/
photo-pipeline.yml), which writes coordinates/photo from EXIF and opens the
second, data PR. That second PR still needs its own manual merge.

Never creates a street file (data/streets/{street_id}.json must already
exist), never sets coordinates (left null for the pipeline/coordinate
picker), never accepts a cover photo as an observation photo (covers are
Case-only — see docs/methodology.md#photo-ingestion), and never clobbers
an existing observation id.

Inputs, in order of precedence (flags override individual sidecar fields;
the sidecar is the base, not all-or-nothing):

    --sidecar path/to/X.sbs.json --photo path/to/X.jpg
        Sidecar shape: {"street_id": ..., "photo_filename": ...,
        "observation": {"id", "type", "category", "title", "description",
        "status"?}}. --photo is the actual image file; if omitted, the
        photo is resolved as sidecar_dir / photo_filename.

    --street --photo --id --type --category --title --description --status
        Full flags, no sidecar. `status` defaults to "open" for issues and
        "active" for assets if omitted.

Both forms build the same observation dict and go through the same
validation and PR-creation path (create_observation_pr), which is also
what tools/serve.py imports and calls for the button UI — this module is
the single source of truth for the operation; nothing here is
CLI-specific except argument parsing.

Usage:
    python scripts/new_observation.py --sidecar obs.sbs.json --photo obs.jpg
    python scripts/new_observation.py --dry-run --street ana-ventura --id 7 \\
        --photo ana-ventura__obs-7__new-bin.jpg --type asset \\
        --category cleanliness --title "New litter bin" \\
        --description "Outside no. 30"
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
STREETS_DIR = REPO_ROOT / "data" / "streets"
IMAGES_DIR = REPO_ROOT / "assets" / "images" / "streets"

# From docs/data-taxonomy.md — kept in sync by hand (same duplication
# tradeoff as tools/observation-form.html; this repo has no shared-constants
# module across Python/JS). One shared list for both issues and assets —
# category describes the observation's domain, not whether it's a problem
# or something of value (that's `type`). No "other" catch-all.
CATEGORIES = ["accessibility", "animal_welfare", "cleanliness"]
ISSUE_STATUSES = ["open", "in_progress", "resolved"]
ASSET_STATUSES = ["active", "inactive"]

# Kept in sync with assets/js/map.js's CATEGORY_ICON, so tools/serve.py can
# serve the exact same category->icon mapping the map uses, rather than a
# third hand-copied version alongside map.js's and observation-form.html's.
CATEGORY_ICON = {
    "accessibility": "ti-accessible",
    "animal_welfare": "ti-paw",
    "cleanliness": "ti-trash",
}

# Neutral fallback for a category with no icon mapping (e.g. old data still
# carrying a retired category). Never a real category's icon - falling back
# to one of those would silently mislabel the observation as something it
# isn't. Kept in sync by hand across all four CATEGORY_ICON copies (this
# one, assets/js/map.js, tools/observation-form.html, and
# tools/templates/observation_form_server.html via tools/serve.py's
# /taxonomy endpoint).
FALLBACK_ICON = "ti-dots"

OBS_FIELD_RE = re.compile(r"^obs-(\d+)$")
COVER_MARKER = "cover"


class ValidationError(Exception):
    """A precondition the caller can fix (bad input, id collision, cover
    photo, etc). No git/gh side effect has happened yet when this is
    raised, except in the one place noted in create_observation_pr where a
    post-checkout re-check fails — see the comment there."""


class GitOperationError(Exception):
    """A git/gh command failed. May carry a pushed branch — the message
    says so explicitly; see create_observation_pr's rollback handling."""


def parse_photo_filename(filename):
    """Return (street_id, observation_id, is_cover), or None if `filename`
    doesn't match {street-id}__obs-{id}__{description}.ext.

    Mirrors scripts/photo_pipeline.py's parse_filename: split on "__" with
    no cap on the description field (so a description containing "__"
    doesn't break parsing), is_cover true when "cover" appears anywhere in
    the description segment, case-insensitive.
    """
    stem = Path(filename).stem
    parts = stem.split("__")
    if len(parts) < 3:
        return None

    street_id, obs_field = parts[0], parts[1]
    match = OBS_FIELD_RE.match(obs_field)
    if not street_id or not match:
        return None

    description = "__".join(parts[2:])
    is_cover = COVER_MARKER in description.lower()
    return street_id, int(match.group(1)), is_cover


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


def _build_pr_body(street_id, observation, photo_name):
    return (
        "## Observation\n\n"
        f"- **Street:** {street_id}\n"
        f"- **Type / category:** {observation['type']} / {observation['category']}\n"
        f"- **Title:** {observation['title']}\n"
        f"- **Description:** {observation['description']}\n"
        f"- **Status:** {observation['status']}\n"
        f"- **Photo:** `assets/images/streets/{street_id}/{photo_name}`\n\n"
        "## Review checklist\n\n"
        "- [ ] Photo is vetted per docs/ethics.md (no identifiable faces/animals/plates)\n"
        "- [ ] Photo name matches this street id and observation id\n"
        "- [ ] Category, status, and description accurately describe what's on the street\n"
        "- [ ] Not a duplicate of an existing observation\n\n"
        "## What happens after merge\n\n"
        "Merging this PR triggers `photo-pipeline.yml`, which extracts GPS EXIF into "
        "this observation's `coordinates`, sets its `photo` field, strips EXIF from the "
        "served copy, and opens a second, **separate data PR** with those changes. That "
        "PR needs its own review and merge before this observation shows coordinates or "
        "a photo on the map — see docs/methodology.md#photo-ingestion.\n\n"
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


def create_observation_pr(street_id, observation, photo_path, dry_run=False, force=False):
    """Validate, then (unless dry_run) place the photo, insert the
    observation, branch, commit, push, and open a PR. Never merges.

    `observation` needs at minimum: id, type, category, title, description.
    `status` defaults to "open" (issue) / "active" (asset) if omitted.
    coordinates/resolved_date/tracking_issue/photo are always forced to
    null and nearby_streets is always omitted, regardless of what's passed
    in — those are pipeline/proximity-script/coordinate-picker territory,
    not this script's.

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

    street_file = STREETS_DIR / f"{street_id}.json"
    if not street_file.exists():
        raise ValidationError(
            f"No street record at data/streets/{street_id}.json — this tool never creates a new street."
        )

    if not photo_path.exists():
        raise ValidationError(f"Photo not found: {photo_path}")

    if photo_path.suffix.lower() not in (".jpg", ".jpeg"):
        raise ValidationError(f"Photo must be a .jpg/.jpeg file, got '{photo_path.suffix}'.")

    parsed = parse_photo_filename(photo_path.name)
    if parsed is None:
        raise ValidationError(
            f"Photo name '{photo_path.name}' doesn't match the naming convention "
            "{street-id}__obs-{id}__{description}.jpg."
        )
    parsed_street_id, parsed_obs_id, is_cover = parsed

    obs_id = observation.get("id")
    if not isinstance(obs_id, int) or obs_id < 1:
        raise ValidationError("Observation id must be a positive integer.")

    if parsed_street_id != street_id or parsed_obs_id != obs_id:
        raise ValidationError(
            f"Photo name implies {parsed_street_id}/obs-{parsed_obs_id}, but this is "
            f"{street_id}/obs-{obs_id} — rename the photo or fix the observation id."
        )
    if is_cover:
        raise ValidationError(
            "Refusing a cover photo as an observation photo — cover photos are Case-only "
            "(embedded on the linked Case's issue body) and never populate an observation's "
            "`photo` field. See docs/methodology.md#photo-ingestion for the Case-cover flow."
        )

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

    status = observation.get("status") or ("open" if obs_type == "issue" else "active")
    valid_statuses = ISSUE_STATUSES if obs_type == "issue" else ASSET_STATUSES
    if status not in valid_statuses:
        raise ValidationError(
            f"'{status}' is not a valid status for an {obs_type} — expected one of {', '.join(valid_statuses)}."
        )

    record = json.loads(street_file.read_text(encoding="utf-8"))
    existing_ids = {obs.get("id") for obs in record.get("observations", [])}
    if obs_id in existing_ids:
        suggested = max(existing_ids, default=0) + 1
        raise ValidationError(f"Observation id {obs_id} already exists on {street_id} — next free id is {suggested}.")

    dest_dir = IMAGES_DIR / street_id
    dest_path = dest_dir / photo_path.name
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

    branch = f"obs/{street_id}-{obs_id}"
    commit_message = f"obs: add {title} on {street_id}"
    dest_rel = dest_path.relative_to(REPO_ROOT)
    street_rel = street_file.relative_to(REPO_ROOT)

    actions = [
        f"Copy photo to {dest_rel}",
        f"Insert observation #{obs_id} into {street_rel}",
        f"Create branch {branch} off origin/main",
        f'Commit: "{commit_message}"',
        f"Push {branch} to origin",
        "Open a PR via gh pr create --base main (print the manual command instead if gh isn't available)",
    ]

    if dry_run:
        return {
            "dry_run": True,
            "branch": branch,
            "pr_url": None,
            "manual_pr_command": None,
            "compare_url": None,
            "actions": actions,
            "observation": new_observation,
            "photo_destination": str(dest_rel),
        }

    _run_git(["fetch", "origin", "main"])
    if _branch_exists(branch):
        raise ValidationError(f"Branch '{branch}' already exists (locally or on origin) — refusing to overwrite.")

    original_branch = _current_branch()
    pushed = False
    try:
        _run_git(["checkout", "-b", branch, "origin/main"])

        dest_dir.mkdir(parents=True, exist_ok=True)
        if dest_path.resolve() != photo_path.resolve():
            shutil.copyfile(photo_path, dest_path)

        # Re-read post-checkout: origin/main's copy of the street file is
        # now what's on disk, which may differ from the pre-checkout read
        # used for validation above (e.g. someone else merged an
        # observation in the meantime) — re-check the id collision against
        # what we're actually about to commit on top of.
        record = json.loads(street_file.read_text(encoding="utf-8"))
        observations = record.setdefault("observations", [])
        if any(obs.get("id") == obs_id for obs in observations):
            raise ValidationError(
                f"Observation id {obs_id} already exists on {street_id} on origin/main (added after this run's initial check)."
            )
        observations.append(new_observation)
        street_file.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        _run_git(["add", str(dest_rel), str(street_rel)])
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

    pr_url, manual_pr_command, compare_url = _open_pr(branch, street_id, new_observation, photo_path.name, commit_message)

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
    (valid category, id collisions, cover photos, ...) happens once,
    inside create_observation_pr — this just assembles the inputs."""
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
    if args.id is not None:
        observation["id"] = args.id
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

    if not street_id:
        raise SystemExit("Missing street id (--street, or street_id in --sidecar).")
    if not photo_path:
        raise SystemExit("Missing photo path (--photo, or photo_filename in --sidecar).")

    missing = [f for f in ("id", "type", "category", "title", "description") if observation.get(f) is None]
    if missing:
        raise SystemExit(f"Missing required observation field(s): {', '.join(missing)} (via --sidecar or flags).")

    return street_id, observation, photo_path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sidecar", help="Path to a *.sbs.json sidecar: {street_id, photo_filename, observation}.")
    parser.add_argument("--photo", help="Path to the photo file (required unless the sidecar's photo_filename resolves it).")
    parser.add_argument("--street", help="Street id. Overrides the sidecar's street_id.")
    parser.add_argument("--id", type=int, help="Observation id. Overrides the sidecar.")
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
        result = create_observation_pr(street_id, observation, photo_path, dry_run=args.dry_run, force=args.force)
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
