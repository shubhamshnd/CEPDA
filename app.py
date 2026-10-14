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


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/network")
def network():
    """Everything the map needs: head office, ports with a light pulse."""
    ports = []
    for loc in config.LOCATIONS:
        ports.append({
            "code": loc["code"],
            "name": loc["name"],
            "region": loc.get("region", ""),
            "lat": loc["lat"],
            "lng": loc["lng"],
            "image": _image_url(loc),
            "pulse": port_pulse(loc),
        })
    return jsonify({
        "head_office": config.HEAD_OFFICE,
        "ports": ports,
        "places": config.REFERENCE_PLACES,
    })


@app.route("/api/ports/<code>/summary")
def summary(code):
    loc = config.location(code)
    if not loc:
        abort(404)
    data = port_summary(loc)
    data["image"] = _image_url(loc)
    return jsonify(data)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
