"""Port network configuration.

Every location lives in the same database (viewmirror); each one gets its own
schema of mirrored views. To add a location, append an entry to LOCATIONS.
Entries without a "schema" are drawn on the map but show no live data.
"dashboard": "jnpa" reads PORTMAN2's jnpa_* liquid-terminal views (summary_jnpa.py);
otherwise the schema holds PORTBIRD's vw_port_overview_* dry-bulk views (summary.py).
"kind" is "port" for port concessions; everything else is a terminal.
"image" is the panel banner; "berth_image" is the photo the berth layout boxes
were drawn on (vessels are plotted over it).
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
    {"code": "DPPL", "kind": "port", "name": "Dharamtar Port", "region": "Raigad, Maharashtra",
     "lat": 18.710037, "lng": 73.027488, "schema": "portbird_dppl",
     "image": "img/dppl_drone.png", "berth_image": "img/dppl.png",
     "mbc_fleet": True},   # its schema has vw_port_overview_mbc_status: drawn at sea on the map
    {"code": "PNP", "kind": "port", "name": "PNP Port", "region": "Raigad, Maharashtra",
     "lat": 18.7080, "lng": 72.9520},
    {"code": "JNPTL", "name": "JNPT Liquid Terminal", "region": "Navi Mumbai, Maharashtra",
     "lat": 18.9500, "lng": 72.9500, "image": "img/jnpt_drone.jpg",
     # Mirrored jnpa_* tables; if they ever move schema, summary_jnpa finds them.
     "schema": "portbird_jnpa", "dashboard": "jnpa", "berth_image": "img/jjltpljetty.png"},
    {"code": "JPL", "kind": "port", "name": "Jaigarh Port", "region": "Ratnagiri, Maharashtra",
     "lat": 17.2960, "lng": 73.2170, "image": "img/jpl_drone.jpg"},
    {"code": "MURBE", "kind": "port", "name": "Murbe Port", "region": "Palghar, Maharashtra",
     "lat": 19.7900, "lng": 72.7000, "status": DEV},
    {"code": "KENI", "kind": "port", "name": "Keni Port", "region": "Uttara Kannada, Karnataka",
     "lat": 14.6600, "lng": 74.2800, "status": DEV},
    # ── Terminals ──
    {"code": "SWPL", "name": "South West Port", "region": "Mormugao, Goa",
     "lat": 15.4100, "lng": 73.7950, "image": "img/swpl_drone.png"},
    {"code": "MCT", "name": "Mangalore Coal Terminal", "region": "Panambur, Karnataka",
     "lat": 12.9250, "lng": 74.8070, "image": "img/mangalorecoal_drone.jpg"},
    {"code": "MCTL", "name": "Mangalore Container Terminal", "region": "Panambur, Karnataka",
     "lat": 12.9270, "lng": 74.8100, "image": "img/mangalore-container-terminal_drone.jpg"},
    {"code": "VOC", "name": "NCB III, VOC Port", "region": "Thoothukudi, Tamil Nadu",
     "lat": 8.7600, "lng": 78.2000},
    {"code": "EBT", "name": "Ennore Bulk Terminal", "region": "Kamarajar Port, Tamil Nadu",
     "lat": 13.2620, "lng": 80.3300},
    {"code": "ECT", "name": "Ennore Coal Terminal", "region": "Kamarajar Port, Tamil Nadu",
     "lat": 13.2570, "lng": 80.3320},
    {"code": "PTIO", "name": "Paradip Terminal, Iron Ore", "region": "Paradip, Odisha",
     "lat": 20.2640, "lng": 86.6760, "image": "img/paradip-iron-ore_drone.jpg"},
    {"code": "PEQCT", "name": "Paradip East Quay Coal Terminal", "region": "Paradip, Odisha",
     "lat": 20.2680, "lng": 86.6800, "image": "img/paradip-east-quay-coal_drone.jpg"},
    {"code": "JATADHAR", "kind": "port", "name": "Jatadhar Port", "region": "Jagatsinghpur, Odisha",
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

# MBC shuttle feeding Dharamtar: load at Jaigarh, sail up the coast to Gull Island
# (Kansa Rock, 18°50'N 72°54'E, Admiralty Sailing Directions Pub 173) at the mouth
# of Mumbai harbour, wait there, then run up the Amba river (Dharamtar creek) to
# discharge at Dharamtar, and sail back empty. The view only gives each MBC's stage,
# not when it started, so ships on a leg are spread evenly along it.
# Waypoints are [lat, lng] along the channel traced on the chart.
MBC_ROUTE = {
    "anchors": {
        "jaigarh_berth":   {"name": "Jaigarh", "lat": 17.297, "lng": 73.208},
        "jaigarh":         {"name": "Jaigarh anchorage", "lat": 17.3101083, "lng": 73.1607203},
        "gull":            {"name": "Gull Island", "lat": 18.840, "lng": 72.893, "label": True},
        "dharamtar":       {"name": "Dharamtar anchorage", "lat": 18.7192579, "lng": 73.0130969},
        "dharamtar_berth": {"name": "Dharamtar berths", "lat": 18.7065425, "lng": 73.0268662},
    },
    # The traced channel (Jaigarh -> open sea -> Gull Island -> Amba river -> Dharamtar),
    # split at Gull Island. Empty MBCs run it in reverse.
    "legs": {
        "to_gull": [[17.3101083, 73.1607203], [18.1812905, 72.7306946], [18.8378822, 72.7853589], [18.84, 72.893]],
        "to_dharamtar": [[18.84, 72.893], [18.8413313, 72.9347746], [18.8323214, 72.959388], [18.8060258, 72.9644391], [18.7898878, 72.980855], [18.7854276, 72.9934757], [18.7824945, 72.9979507], [18.77728, 72.9986392], [18.7697839, 72.9948526], [18.7652209, 72.9914103], [18.7570723, 72.986591], [18.7476195, 72.9855583], [18.7388181, 72.9896891], [18.7309943, 72.9945084], [18.7228441, 73.0020815], [18.7192579, 73.0130969], [18.7133893, 73.0213585], [18.7065425, 73.0268662]],
        "to_jaigarh": [[18.7065425, 73.0268662], [18.7133893, 73.0213585], [18.7192579, 73.0130969], [18.7228441, 73.0020815], [18.7309943, 72.9945084], [18.7388181, 72.9896891], [18.7476195, 72.9855583], [18.7570723, 72.986591], [18.7652209, 72.9914103], [18.7697839, 72.9948526], [18.77728, 72.9986392], [18.7824945, 72.9979507], [18.7854276, 72.9934757], [18.7898878, 72.980855], [18.8060258, 72.9644391], [18.8323214, 72.959388], [18.8413313, 72.9347746], [18.84, 72.893], [18.8378822, 72.7853589], [18.1812905, 72.7306946], [17.3101083, 73.1607203]],
    },
    "lanes": ["to_gull", "to_dharamtar"],
    "show_for": ["DPPL", "JPL"],             # the fleet is drawn only when one of these is selected   # drawn as the route line (to_jaigarh is the same water)
    # vw_port_overview_mbc_status.mbc_status -> where the ship is drawn
    "status": {
        "UNDER LOADING":                    ["at", "jaigarh_berth"],
        "LOADED : WAITING AT LOAD PORT":    ["at", "jaigarh"],
        "EMPTY : WAITING AT LOAD PORT":     ["at", "jaigarh"],
        "EMPTY : WAITING AT JAIGAD":        ["at", "jaigarh"],
        "LOADED : ON THE WAY TO GULL":      ["leg", "to_gull"],
        "LOADED : WAITING AT GULL":         ["at", "gull"],
        "LOADED : ON THE WAY TO DHARAMTAR": ["leg", "to_dharamtar"],
        "LOADED : WAITING AT DHARAMTAR":    ["at", "dharamtar"],
        "UNDER DISCHARGE AT DHARAMTAR":     ["at", "dharamtar_berth"],
        "EMPTY : WAITING AT DHARAMTAR":     ["at", "dharamtar"],
        "EMPTY : ON THE WAY TO JAIGAD":     ["leg", "to_jaigarh"],
    },
}

# Company-wide figures for the sidebar, from jswinfrastructure.in (home page
# and About us, Oct 2026). Update when new annual figures are out.
COMPANY = {
    "source": "https://www.jswinfrastructure.in/",
    "kpis": [
        {"value": "183", "unit": "MTPA", "label": "Operational capacity"},
    ],
    "period": "FY2026",
    "footprint": "3 port concessions and 11 terminals across Maharashtra, Goa, "
                 "Karnataka, Tamil Nadu, Odisha and the UAE",
}

# At-a-glance facts for the panel and the map's "Now viewing" callout. Taken from
# each port's page on jswinfrastructure.in (Oct 2026); Jaigarh and South West Port
# capacities from jsw.in/jsw-infrastructure. First stat is the headline.
# Ports under development have no page yet, so no facts.
_SITE = "https://www.jswinfrastructure.in/"
FACTS = {
    "DPPL": {"url": _SITE + "ports/dharamtar-port",
             "about": "Riverine port on the Amba River, 23 nautical miles from Mumbai Harbour. "
                      "Captive facility for JSW Steel and JSW Cement at Dolvi.",
             "stats": [("1,197 m", "Berth length"), ("8,000 DWT", "Vessel size"), ("269 m", "Mooring dolphin")],
             "cargo": ["Iron ore pellets", "Lumps", "Fines", "Coal", "Coke", "Limestone", "Dolomite",
                       "Finished steel", "Clinker", "Slag"]},
    "JPL": {"url": _SITE + "ports/jaigarh-port",
            "about": "JSW Infrastructure's flagship and largest port by capacity. "
                     "24/7 all-weather deep-water port between Mumbai and Goa.",
            "stats": [("55 MTPA", "Capacity"), ("7", "Berths"), ("17.5 m", "Draft"),
                      ("712 m", "Breakwater"), ("228 ha", "Backup area")],
            "cargo": ["Iron ore", "Sugar exports", "Fertilisers", "Project cargo", "LPG",
                      "Construction material", "Molasses", "Limestone", "LNG", "Containers"]},
    "PNP": {"url": _SITE + "ports/pnp-port",
            "about": "Near Mumbai's main gateways, MbPT and JNPT, with trimodal connectivity and a scalable land bank.",
            "stats": [("5 MTPA", "Capacity"), ("1,000 m", "Quay length")],
            "cargo": ["Dry bulk", "Break-bulk", "Liquid bulk", "Gases", "Containers"]},
    "JNPTL": {"url": _SITE + "terminals/jnpt-liquid-terminal",
              "about": "Liquid cargo terminal at JNPT with two berths and connected evacuation networks.",
              "stats": [("2 × 300 m", "Berths"), ("90,000 DWT", "Max vessel"), ("285 m", "Max LOA"),
                        ("14.8 / 11.8 m", "Depth below CD")],
              "cargo": ["Edible oil", "Phosphoric acid", "Chemicals", "POL", "CBFS"]},
    "SWPL": {"url": _SITE + "terminals/south-west-port",
             "about": "All-weather, fully mechanised bulk terminal in the protected Mormugao Harbour.",
             "stats": [("8.5 MTPA", "Capacity"), ("450 m", "Berth length (4A, 5A)"), ("14 m", "Draft"),
                       ("3", "Harbour cranes"), ("2", "Ship unloaders")],
             "cargo": ["Coal", "Limestone", "Steel products"]},
    "MCT": {"url": _SITE + "terminals/mangalore-coal-terminal",
            "about": "Fully mechanised bulk gateway at New Mangalore Port for steel, power and industry.",
            "stats": [("315 m", "Berth length"), ("14 m", "Draft"), ("2", "Unloaders"), ("21.4 acres", "Stockyard")],
            "cargo": ["Coal", "Gypsum", "Limestone", "Fertilisers"]},
    "MCTL": {"url": _SITE + "terminals/mangalore-container-terminal",
             "about": "Container and bulk gateway within New Mangalore Port, serving southern India.",
             "stats": [("3", "Mobile harbour cranes"), ("8", "Reach stackers"), ("2", "Mobile hoppers"),
                       ("1", "Empty handler")],
             "cargo": ["Containers", "Bulk cargo"]},
    "VOC": {"url": _SITE + "terminals/ncb-iii-voc-port",
            "about": "Dry bulk berth at VO Chidambaranar Port, Tamil Nadu's south-eastern gateway.",
            "stats": [("306 m", "Berth length"), ("14.2 m", "Draft"), ("2", "Ship loaders")],
            "cargo": ["Dry bulk"]},
    "EBT": {"url": _SITE + "terminals/ennore-bulk-terminal",
            "about": "Mechanised clean multi-cargo terminal in Kamarajar Port; deep-draft berth for "
                     "Post-Panamax and Baby-Cape vessels.",
            "stats": [("100,000 m²", "Storage"), ("4", "Covered warehouses"), ("16,800 m²", "Warehouse area"),
                      ("2", "Mobile harbour cranes")],
            "cargo": ["General cargo", "Multi cargo", "Clean cargo"]},
    "ECT": {"url": _SITE + "terminals/ennore-coal-terminal",
            "about": "Fully mechanised coal and coke import terminal at Kamarajar Port, built for cape-size vessels.",
            "stats": [("3,500 TPH", "Stacking"), ("2,000 TPH", "Reclaiming"), ("134,000 m²", "Storage")],
            "cargo": ["Coal", "Coke", "Limestone"]},
    "PTIO": {"url": _SITE + "terminals/paradip-terminal-iron-ore",
             "about": "East-coast iron ore export terminal, commissioned 2020. Loads Capesize vessels within 48 hours.",
             "stats": [("10 MTPA", "Capacity"), ("370 m", "Berth length"), ("17 m", "Draft"),
                       ("800,000 MTPA", "Storage capacity")],
             "cargo": ["Iron ore fines", "Pellets", "Lumps"]},
    "PEQCT": {"url": _SITE + "terminals/paradip-east-quay-coal-terminal",
              "about": "Deep-draft, cape-compliant, all-weather coal terminal at Paradip Port.",
              "stats": [("30 MTPA", "Capacity"), ("686 m", "Berth length"), ("15 m", "Draft"),
                        ("110,000 DWT", "Max vessel"), ("2", "Ship loaders")],
              "cargo": ["Coal"]},
    "FUJ": {"url": _SITE + "terminals/fujairah-terminal-uae",
            "about": "Dry bulk terminal run under a long-term O&M partnership with the Port of Fujairah, "
                     "with berth-to-yard conveyors.",
            "stats": [("24 MTPA", "Capacity")],
            "cargo": ["Aggregates", "Limestone"]},
    "FUJL": {"url": _SITE + "terminals/fujairah-terminal-uae",
             "about": "Liquid storage at Fujairah, linked to the berths by four dedicated pipelines.",
             "stats": [("465,000 CBM", "Capacity"), ("15", "Tanks (6 heavy, 9 light fuel)"), ("4", "Pipelines")],
             "cargo": ["Fuel oil", "Gas oil", "Diesel", "Naphtha"]},
    "DIBBA": {"url": _SITE + "terminals/dibba-port",
              "about": "Greenfield bulk export terminal on Fujairah's coastline.",
              "stats": [("650 m", "Berth length"), ("15.5 m", "Draft"), ("1", "Ship loader")],
              "cargo": ["Limestone", "Aggregates", "Clinker"]},
}

# Cumulative totals in the baseline view run up to this date; everything
# after it comes from the throughput view.
BASELINE_CUTOFF = "2026-03-31"

# Weather older than this is shown as stale.
WEATHER_STALE_HOURS = 6


def location(code):
    code = (code or "").upper()
    return next((l for l in LOCATIONS if l["code"] == code), None)
