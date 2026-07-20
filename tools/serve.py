#!/usr/bin/env python3
"""Local-only button UI for scripts/new_observation.py.

Serves an observation intake form (adapted from tools/observation-form.html)
at "/", and on submit calls scripts/new_observation.create_observation_pr —
imported directly, not shelled out to as a CLI — so this file stays a thin
wrapper with no observation/git logic of its own. Same STOPS-at-PR-opened
guarantee as the script: this never merges anything.

Binds to 127.0.0.1 ONLY, never 0.0.0.0. This process runs `git`/`gh` with
repo write access whenever a browser hits /submit, so it must be
unreachable from anywhere but this machine — there is no auth of any kind
in front of it, which is only acceptable because it never listens beyond
localhost.

Requires Flask (stdlib otherwise):
    pip install flask

Usage:
    python tools/serve.py
    # then open http://127.0.0.1:8765
"""

import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
DATA_DIR = REPO_ROOT / "data"
ASSETS_DIR = REPO_ROOT / "assets"

# Refuse to run from anywhere but a checkout of this repo — create_observation_pr
# resolves every path off REPO_ROOT, so a wrong working directory would silently
# operate on (or fail against) the wrong tree.
if not (DATA_DIR / "streets").is_dir():
    print(f"ERROR: {DATA_DIR / 'streets'} not found.")
    print(f"tools/serve.py must be run from within a Project Plainsight checkout (resolved repo root: {REPO_ROOT}).")
    sys.exit(1)

sys.path.insert(0, str(SCRIPTS_DIR))

try:
    from flask import Flask, jsonify, render_template, request, send_from_directory
except ImportError:
    print("Flask is required and isn't installed: pip install flask")
    sys.exit(1)

from new_observation import (
    ASSET_CATEGORIES,
    ASSET_STATUSES,
    CATEGORY_ICON,
    ISSUE_CATEGORIES,
    ISSUE_STATUSES,
    GitOperationError,
    ValidationError,
    create_observation_pr,
)

HOST = "127.0.0.1"  # never 0.0.0.0 — see module docstring.
PORT = 8765

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("observation_form_server.html")


@app.route("/taxonomy")
def taxonomy():
    # Single source of truth is scripts/new_observation.py's constants —
    # served as JSON so the template's JS doesn't need its own third
    # hand-copied taxonomy/icon table alongside map.js's and
    # observation-form.html's.
    return jsonify(
        {
            "issue_categories": ISSUE_CATEGORIES,
            "asset_categories": ASSET_CATEGORIES,
            "issue_statuses": ISSUE_STATUSES,
            "asset_statuses": ASSET_STATUSES,
            "category_icon": CATEGORY_ICON,
        }
    )


@app.route("/data/<path:subpath>")
def serve_data(subpath):
    return send_from_directory(DATA_DIR, subpath)


@app.route("/assets/<path:subpath>")
def serve_assets(subpath):
    return send_from_directory(ASSETS_DIR, subpath)


@app.route("/submit", methods=["POST"])
def submit():
    try:
        street_id = (request.form.get("street_id") or "").strip()
        if not street_id:
            return jsonify({"ok": False, "error": "Street is required."}), 400

        try:
            obs_id = int(request.form.get("id", ""))
        except ValueError:
            return jsonify({"ok": False, "error": "Observation id must be a number."}), 400

        observation = {
            "id": obs_id,
            "type": request.form.get("type"),
            "category": request.form.get("category"),
            "title": (request.form.get("title") or "").strip(),
            "description": (request.form.get("description") or "").strip(),
            "status": request.form.get("status"),
        }
        dry_run = request.form.get("dry_run") == "true"

        photo = request.files.get("photo")
        if not photo or not photo.filename:
            return jsonify({"ok": False, "error": "A photo is required."}), 400

        with tempfile.TemporaryDirectory() as tmp_dir:
            # Preserve the uploaded filename verbatim: create_observation_pr
            # validates the photo's *name* against the street-id/obs-id
            # naming convention, so it must be the real target filename,
            # not a browser-generated temp name.
            tmp_photo_path = Path(tmp_dir) / photo.filename
            photo.save(tmp_photo_path)

            result = create_observation_pr(
                street_id=street_id,
                observation=observation,
                photo_path=tmp_photo_path,
                dry_run=dry_run,
                # No force option in this UI on purpose: the button path
                # always takes the safe default and never overwrites a
                # differing existing photo. --force stays CLI-only.
            )

        return jsonify({"ok": True, **result})
    except ValidationError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except GitOperationError as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    except Exception as e:  # noqa: BLE001 - surface unexpected errors to the page rather than a bare 500 HTML page
        return jsonify({"ok": False, "error": f"Unexpected error: {e}"}), 500


def main():
    print("Project Plainsight observation intake server")
    print(f"Repo root: {REPO_ROOT}")
    print(
        f"Binding to http://{HOST}:{PORT} (localhost only — this process runs git/gh "
        "with repo write access on request, so it must never be reachable from "
        "outside this machine)."
    )
    app.run(host=HOST, port=PORT, debug=False)


if __name__ == "__main__":
    main()
