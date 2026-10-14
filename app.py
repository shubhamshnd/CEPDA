import logging
import os

from flask import Flask, abort, jsonify, render_template, url_for

import config
from summary import port_pulse, port_summary

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)
app.json.sort_keys = False   # keep cargo mix ordered largest first


def _image_url(loc):
    img = loc.get("image")
    if img and os.path.exists(os.path.join(app.static_folder, img)):
        return url_for("static", filename=img)
    return None


def _info(loc):
    return {
        "code": loc["code"],
        "name": loc["name"],
        "region": loc.get("region", ""),
        "status": loc.get("status", "Operational"),
        "overseas": bool(loc.get("overseas")),
        "connected": bool(loc.get("schema")),
        "image": _image_url(loc),
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
            "site": loc.get("site", loc["name"]),
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
