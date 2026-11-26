import copy
import functools
import hashlib
import hmac
import json
import logging
import os
import struct
import tempfile
from datetime import datetime
from urllib.parse import urlencode

from flask import Flask, abort, jsonify, render_template, request, url_for
from jsonschema import Draft202012Validator

import config
from summary import fleet, port_pulse, port_summary
from summary_jnpa import jnpa_pulse, jnpa_summary

# Which view set a location's schema holds -> its summary and map-pulse readers.
READERS = {"jnpa": (jnpa_summary, jnpa_pulse)}
DEFAULT_READERS = (port_summary, port_pulse)


def _readers(loc):
    return READERS.get(loc.get("dashboard"), DEFAULT_READERS)

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
app.json.sort_keys = False   # keep cargo mix ordered largest first
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024   # a port feed is a few KB; refuse anything silly


def _png_size(path):
    # ponytail: PNG only (berth images are PNG); anything else gets no berth plot.
    with open(path, "rb") as f:
        head = f.read(24)
    return list(struct.unpack(">II", head[16:24])) if head[1:4] == b"PNG" else None


def _static(img):
    """Static URL and path for a configured image, or (None, None) if the file is missing."""
    path = img and os.path.join(app.static_folder, img)
    return (url_for("static", filename=img), path) if path and os.path.exists(path) else (None, None)


def _banner(loc):
    """The port's own photo, else a Google satellite view, else None."""
    url, _ = _static(loc.get("image"))
    if url or not config.GOOGLE_MAPS_KEY:
        return url
    return "https://maps.googleapis.com/maps/api/staticmap?" + urlencode({
        "center": f'{loc["lat"]},{loc["lng"]}', "zoom": 15, "size": "640x320", "scale": 2,
        "maptype": "satellite", "key": config.GOOGLE_MAPS_KEY,
    })


def _info(loc):
    berth_url, berth_path = _static(loc.get("berth_image"))
    return {
        "code": loc["code"],
        "name": loc["name"],
        "region": loc.get("region", ""),
        "status": loc.get("status", "Operational"),
        "kind": loc.get("kind", "terminal"),
        "overseas": bool(loc.get("overseas")),
        "connected": bool(loc.get("schema")),
        "facts": config.FACTS.get(loc["code"]),
        "image": _banner(loc),
        "berth_image": berth_url,
        "berth_image_size": _png_size(berth_path) if berth_path else None,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.webmanifest")
def manifest():
    """Lets phones install the dashboard to the home screen as a full-screen app."""
    icon = lambda n: {"src": url_for("static", filename=f"img/icon-{n}.png"), "sizes": f"{n}x{n}",
                      "type": "image/png", "purpose": "any maskable"}
    resp = jsonify({
        "name": "JSW Infrastructure Port network", "short_name": "JSW Ports",
        "start_url": url_for("index"), "scope": url_for("index"), "display": "standalone",
        "background_color": "#08122A", "theme_color": "#08122A",
        "icons": [icon(192), icon(512)],
    })
    resp.mimetype = "application/manifest+json"
    return resp


@app.route("/api/network")
def network():
    """Everything the map needs: head office, ports with a light pulse."""
    ports = []
    for loc in config.LOCATIONS:
        ports.append({
            **_info(loc),
            "lat": loc["lat"],
            "lng": loc["lng"],
            "pulse": _readers(loc)[1](loc) if loc.get("schema") else None,
        })
    return jsonify({
        "head_office": config.HEAD_OFFICE, "company": config.COMPANY, "ports": ports,
        "fleet": [m for loc in config.LOCATIONS if loc.get("mbc_fleet") and loc.get("schema") for m in fleet(loc)],
        "fleet_route": config.MBC_ROUTE,
    })


@app.route("/api/ports/<code>/summary")
def summary(code):
    loc = config.location(code)
    if not loc:
        abort(404)
    data = _readers(loc)[0](loc) if loc.get("schema") else {}
    return jsonify({**data, **_info(loc)})



# ---------------------------------------------------------------------------
# Port feeds: locations without a database schema POST docs/port_feed JSON.
# ---------------------------------------------------------------------------

def _doc(name):
    with open(os.path.join(app.root_path, "docs", "port_feed", name), encoding="utf-8") as f:
        return json.load(f)


FEED_VALIDATOR = Draft202012Validator(_doc("port_feed.schema.json"))
FEED_EXAMPLES = {"bulk": _doc("example_bulk_port.json"), "container": _doc("example_container_port.json")}
FEED_STALE_MIN = 15   # the format asks for a fresh document every 5 minutes


def _feed_locs():
    return [l for l in config.LOCATIONS if not l.get("schema")]


def _feed_key(code):
    # ponytail: per-port key derived from one secret, no key table; a leaked key is
    # fixed by rotating FEED_SECRET (every port gets a new key). Store keys if ports need rotating one at a time.
    return hmac.new(config.FEED_SECRET.encode(), code.encode(), hashlib.sha256).hexdigest()[:32]


def _feed_path(code):
    return os.path.join(config.FEED_DIR, f"{code}.json")   # code comes from config, never the URL


def _latest_feed(code):
    try:
        with open(_feed_path(code), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def _sample_feed(loc):
    doc = copy.deepcopy(FEED_EXAMPLES[loc.get("feed", "bulk")])
    doc["port"].update(code=loc["code"], name=loc["name"])
    if loc.get("overseas"):
        doc["port"]["timezone"] = "Asia/Dubai"
    return doc


def feed_errors(doc, code):
    """Why a posted document is refused (empty list = accepted)."""
    errors = [f'{"/".join(map(str, e.absolute_path)) or "(root)"}: {e.message}'
              for e in FEED_VALIDATOR.iter_errors(doc)]
    if not errors and doc["port"]["code"].upper() != code:
        errors.append(f'port/code: "{doc["port"]["code"]}" does not match this endpoint ({code})')
    return sorted(errors)[:20]


@app.post("/api/feed/<code>")
def feed(code):
    loc = config.location(code)
    if not loc or loc.get("schema"):
        abort(404)
    if not config.FEED_SECRET:
        return jsonify(ok=False, error="feeds are not enabled on this server"), 503
    if not hmac.compare_digest(request.headers.get("X-Feed-Key", "").encode(), _feed_key(loc["code"]).encode()):
        return jsonify(ok=False, error="missing or wrong X-Feed-Key"), 401
    doc = request.get_json(silent=True)
    if doc is None:
        return jsonify(ok=False, error="body must be JSON, sent with Content-Type: application/json"), 400
    errors = feed_errors(doc, loc["code"])
    if errors:
        return jsonify(ok=False, errors=errors), 422
    received = datetime.now().astimezone().isoformat(timespec="seconds")
    os.makedirs(config.FEED_DIR, exist_ok=True)
    # Write then rename, so a reader never sees half a file.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=config.FEED_DIR, suffix=".tmp", delete=False) as f:
        json.dump({"received_at": received, "feed": doc}, f)
    os.replace(f.name, _feed_path(loc["code"]))
    # ponytail: latest document only, no history; add a table when trends are needed.
    return jsonify(ok=True, received_at=received)


# ---------------------------------------------------------------------------
# /data: admin view of every location's data source (HTTP Basic, creds in .env).
# ---------------------------------------------------------------------------

def admin(view):
    @functools.wraps(view)
    def guarded(*args, **kwargs):
        if not (config.ADMIN_ID and config.ADMIN_PASS):
            return "Admin is disabled: set ADMIN_ID and ADMIN_PASS in .env", 503
        a = request.authorization
        ok = bool(a and a.type == "basic") and (
            hmac.compare_digest((a.username or "").encode(), config.ADMIN_ID.encode())
            & hmac.compare_digest((a.password or "").encode(), config.ADMIN_PASS.encode()))
        # ponytail: no lockout on repeated failures; put rate limiting in the reverse proxy.
        if not ok:
            return "Login required", 401, {"WWW-Authenticate": 'Basic realm="CEPDA data", charset="UTF-8"'}
        resp = app.make_response(view(*args, **kwargs))
        resp.headers["Cache-Control"] = "no-store"   # the page shows feed keys
        return resp
    return guarded


def _db_status(loc):
    summary_fn, pulse_fn = _readers(loc)
    try:
        s = summary_fn(loc)
    except Exception as e:   # database down: say so, keep the page up
        return {"ok": False, "error": str(e).strip().splitlines()[0], "errors": [], "pulse": None}
    errors = [f'{e["section"]}: {e["error"]}' for e in s.get("errors", [])]
    if s.get("views_missing"):
        errors.append("views not mirrored into the database")
    return {"ok": not errors, "error": None, "errors": errors,
            "last_synced": s.get("last_synced"), "pulse": pulse_fn(loc)}


def _feed_status(loc):
    got = _latest_feed(loc["code"])
    age = None
    if got:
        age = (datetime.now().astimezone() - datetime.fromisoformat(got["received_at"])).total_seconds() / 60
    return {
        "endpoint": url_for("feed", code=loc["code"], _external=True),
        "key": _feed_key(loc["code"]) if config.FEED_SECRET else None,
        "received_at": got and got["received_at"],
        "generated_at": got and got["feed"].get("generated_at"),
        "age_min": age,
        "state": "none" if not got else "live" if age <= FEED_STALE_MIN else "stale",
        "sample": json.dumps(_sample_feed(loc), indent=2, ensure_ascii=False),
    }


@app.route("/data")
@admin
def data():
    return render_template(
        "data.html",
        db=[{**loc, **_db_status(loc)} for loc in config.LOCATIONS if loc.get("schema")],
        feeds=[{**loc, **_feed_status(loc)} for loc in _feed_locs()],
        feeds_enabled=bool(config.FEED_SECRET), stale_min=FEED_STALE_MIN,
    )


@app.route("/data/<code>/<which>.json")
@admin
def data_json(code, which):
    """latest: what the port last sent. sample: the document it should send."""
    loc = config.location(code)
    if not loc or loc.get("schema") or which not in ("latest", "sample"):
        abort(404)
    doc = _sample_feed(loc) if which == "sample" else _latest_feed(loc["code"])
    if doc is None:
        abort(404)
    resp = jsonify(doc)
    if which == "sample":
        resp.headers["Content-Disposition"] = f'attachment; filename="{loc["code"]}_feed_sample.json"'
    return resp


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
