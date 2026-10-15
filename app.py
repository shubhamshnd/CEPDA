import logging
import os
import struct
from urllib.parse import urlencode

from flask import Flask, abort, jsonify, render_template, url_for

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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
