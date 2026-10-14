"""Port network configuration.

Every location lives in the same database (viewmirror); each one gets its own
schema of mirrored views. To add a location, append an entry to LOCATIONS
with its schema name and coordinates. Nothing else needs to change.
"""
import os

from dotenv import load_dotenv

load_dotenv()  # real env vars win; .env only fills gaps

DATABASE_URL = os.environ["DATABASE_URL"]  # fail at startup, not on first query

# Where the arcs from every port converge.
HEAD_OFFICE = {
    "name": "Head office",
    "city": "Mumbai",
    "lat": 19.0660,
    "lng": 72.8690,
}

LOCATIONS = [
    {
        "code": "DPPL",
        "name": "Dharamtar Port",
        "region": "Raigad, Maharashtra",
        "schema": "portbird_dppl",
        "lat": 18.710037,
        "lng": 73.027488,
        # Shown at the top of the port panel. Hidden automatically if missing.
        "image": "img/dppl.png",
    },
    # {
    #     "code": "JPL",
    #     "name": "Jaigarh Port",
    #     "region": "Ratnagiri, Maharashtra",
    #     "schema": "portbird_jpl",
    #     "lat": 17.2960,
    #     "lng": 73.2170,
    #     "image": "img/jpl.png",
    # },
]

# Reference towns drawn faintly on the map for orientation when zoomed in.
REFERENCE_PLACES = [
    {"name": "Pune", "lat": 18.5204, "lng": 73.8567},
    {"name": "Nashik", "lat": 19.9975, "lng": 73.7898},
    {"name": "Ratnagiri", "lat": 16.9902, "lng": 73.3120},
    {"name": "Alibag", "lat": 18.6414, "lng": 72.8722},
    {"name": "Panaji", "lat": 15.4909, "lng": 73.8278},
    {"name": "Surat", "lat": 21.1702, "lng": 72.8311},
]

# Cumulative totals in the baseline view run up to this date; everything
# after it comes from the throughput view.
BASELINE_CUTOFF = "2026-03-31"

# Weather older than this is shown as stale.
WEATHER_STALE_HOURS = 6


def location(code):
    code = (code or "").upper()
    return next((l for l in LOCATIONS if l["code"] == code), None)
