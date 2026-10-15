import logging
import os
import struct
from urllib.parse import urlencode

from flask import Flask, abort, jsonify, render_template, url_for

import config
from summary import port_pulse, port_summary

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
app.json.sort_keys = False   # keep cargo mix ordered largest first


def _png_size(path):
    # ponytail: PNG only (all local port images are PNG); anything else gets no berth plot.
    with open(path, "rb") as f:
        head = f.read(24)
    return list(struct.unpack(">II", head[16:24])) if head[1:4] == b"PNG" else None


def _image(loc):
    """(url, [w, h]) for the port's own photo, else a Google satellite view, else (None, None)."""
    img = loc.get("image")
    path = img and os.path.join(app.static_folder, img)
    if path and os.path.exists(path):
        return url_for("static", filename=img), _png_size(path)
    if config.GOOGLE_MAPS_KEY:
        return "https://maps.googleapis.com/maps/api/staticmap?" + urlencode({
            "center": f'{loc["lat"]},{loc["lng"]}', "zoom": 15, "size": "640x320", "scale": 2,
            "maptype": "satellite", "key": config.GOOGLE_MAPS_KEY,
        }), None
    return None, None


def _info(loc):
    url, size = _image(loc)
    return {
        "code": loc["code"],
        "name": loc["name"],
        "region": loc.get("region", ""),
        "status": loc.get("status", "Operational"),
        "overseas": bool(loc.get("overseas")),
        "connected": bool(loc.get("schema")),
        "image": url,
        "image_size": size,
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
            "pulse": port_pulse(loc) if loc.get("schema") else None,
        })
    return jsonify({"head_office": config.HEAD_OFFICE, "ports": ports})


@app.route("/api/ports/<code>/summary")
def summary(code):
    loc = config.location(code)
    if not loc:
        abort(404)
    data = port_summary(loc) if loc.get("schema") else {}
    return jsonify({**data, **_info(loc)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
