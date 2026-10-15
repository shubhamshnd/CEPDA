"""Port network configuration.

Every location lives in the same database (viewmirror); each one gets its own
schema of mirrored views. To add a location, append an entry to LOCATIONS.
Entries without a "schema" are drawn on the map but show no live data.
"""
import os

from dotenv import load_dotenv

load_dotenv()  # real env vars win; .env only fills gaps

DATABASE_URL = os.environ["DATABASE_URL"]  # fail at startup, not on first query

# Google Static Maps key: satellite view for locations without their own image.
# Restrict it to your domain (HTTP referrer) in Google Cloud, it ships in page URLs.
GOOGLE_MAPS_KEY = os.environ.get("GOOGLE_MAPS_KEY", "")

# Where the arcs from every site converge.
HEAD_OFFICE = {
    "name": "JSW Infrastructure HQ",
    "city": "Mumbai",
    "lat": 19.0660,
    "lng": 72.8690,
}

# Source: jswinfrastructure.in sitemap + subsidiaries list (Oct 2026).
# ponytail: coordinates are approximate (terminal level, ~1 km); refine from survey data if needed.
DEV = "Under development"
LOCATIONS = [
    # ── Ports ──
    {"code": "DPPL", "name": "Dharamtar Port", "region": "Raigad, Maharashtra",
     "lat": 18.710037, "lng": 73.027488, "schema": "portbird_dppl", "image": "img/dppl.png"},
    {"code": "PNP", "name": "PNP Port", "region": "Raigad, Maharashtra",
     "lat": 18.7080, "lng": 72.9520},
    {"code": "JNPTL", "name": "JNPT Liquid Terminal", "region": "Navi Mumbai, Maharashtra",
     "lat": 18.9500, "lng": 72.9500},
    {"code": "JPL", "name": "Jaigarh Port", "region": "Ratnagiri, Maharashtra",
     "lat": 17.2960, "lng": 73.2170},
    {"code": "MURBE", "name": "Murbe Port", "region": "Palghar, Maharashtra",
     "lat": 19.7900, "lng": 72.7000, "status": DEV},
    {"code": "KENI", "name": "Keni Port", "region": "Uttara Kannada, Karnataka",
     "lat": 14.6600, "lng": 74.2800, "status": DEV},
    # ── Terminals ──
    {"code": "SWPL", "name": "South West Port", "region": "Mormugao, Goa",
     "lat": 15.4100, "lng": 73.7950},
    {"code": "MCT", "name": "Mangalore Coal Terminal", "region": "Panambur, Karnataka",
     "lat": 12.9250, "lng": 74.8070},
    {"code": "MCTL", "name": "Mangalore Container Terminal", "region": "Panambur, Karnataka",
     "lat": 12.9270, "lng": 74.8100},
    {"code": "VOC", "name": "NCB III, VOC Port", "region": "Thoothukudi, Tamil Nadu",
     "lat": 8.7600, "lng": 78.2000},
    {"code": "EBT", "name": "Ennore Bulk Terminal", "region": "Kamarajar Port, Tamil Nadu",
     "lat": 13.2620, "lng": 80.3300},
    {"code": "ECT", "name": "Ennore Coal Terminal", "region": "Kamarajar Port, Tamil Nadu",
     "lat": 13.2570, "lng": 80.3320},
    {"code": "PTIO", "name": "Paradip Terminal, Iron Ore", "region": "Paradip, Odisha",
     "lat": 20.2640, "lng": 86.6760},
    {"code": "PEQCT", "name": "Paradip East Quay Coal Terminal", "region": "Paradip, Odisha",
     "lat": 20.2680, "lng": 86.6800},
    {"code": "JATADHAR", "name": "Jatadhar Port", "region": "Jagatsinghpur, Odisha",
     "lat": 20.1800, "lng": 86.6200, "status": DEV},
    {"code": "KCT", "name": "Kolkata Container Terminal", "region": "Kolkata, West Bengal",
     "lat": 22.5400, "lng": 88.3100, "status": DEV},
    # ── Overseas ──
    {"code": "FUJ", "name": "Fujairah Terminal", "region": "Fujairah, UAE",
     "lat": 25.1700, "lng": 56.3600, "overseas": True},
    {"code": "FUJL", "name": "Fujairah Liquid Storage", "region": "Fujairah, UAE",
     "lat": 25.1350, "lng": 56.3550, "overseas": True},
    {"code": "DIBBA", "name": "Dibba Port", "region": "Dibba, UAE",
     "lat": 25.5950, "lng": 56.2750, "overseas": True},
]

# Cumulative totals in the baseline view run up to this date; everything
# after it comes from the throughput view.
BASELINE_CUTOFF = "2026-03-31"

# Weather older than this is shown as stale.
WEATHER_STALE_HOURS = 6


def location(code):
    code = (code or "").upper()
    return next((l for l in LOCATIONS if l["code"] == code), None)
