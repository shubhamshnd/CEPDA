"""Summary for liquid terminals mirrored from PORTMAN2's jnpa_* views (JNPA).

A different data model from the dry-bulk ports: tankers alongside, each with
parcels pumped through pipelines, cargo split Edible Oil / Chemical / POL /
Other liquid. The views already reproduce the PORTMAN2 RP01 Port Overview
numbers (07:00 operational day); this module only reshapes them for the panel.

Mirrored views are snapshots, so "now" in them is the source's time at the
last sync, which keeps every number consistent with each other.
"""
import calendar
import logging
from datetime import datetime

from db import SchemaQuery, connection
from summary import _f, _run

log = logging.getLogger(__name__)

CATS = (("Edible Oil", "edible_oil"), ("Chemical", "chemical"), ("POL", "pol"), ("Other liquid", "other_liquid"))
WAITING_SHOWN = 8


def _iso(v):
    return v.strftime("%Y-%m-%dT%H:%M") if hasattr(v, "strftime") else (v or None)


def _num(v):
    return None if v is None else _f(v)


def throughput(q):
    c = q.one("SELECT op_date, month_days_left, fy_days_left, fy_start_year FROM {s}.jnpa_clock")
    cards = {r["card"]: r for r in q.all("SELECT * FROM {s}.jnpa_cargo_cards")}
    bob = q.scalar("SELECT SUM(qty) FROM {s}.jnpa_cargo_throughput WHERE period = 'balance_on_board'")

    def card(key):
        r = cards.get(key)
        if not r:
            return {"label": "", "total": 0, "by_type": {}}
        return {
            "label": r["label"],
            "total": _f(r["total_qty"]),
            "by_type": {name: _f(r[col]) for name, col in CATS if r[col]},
            "target": _num(r["target"]),
            "needed_per_day": _num(r["required_daily"]),
        }

    # Share of the period already gone, for the pace marker on the progress bars.
    op_date = c["op_date"]
    dim = calendar.monthrange(op_date.year, op_date.month)[1]
    fy_days = (datetime(c["fy_start_year"] + 1, 3, 31) - datetime(c["fy_start_year"], 4, 1)).days + 1
    month = {**card("current_month"), "days_left": int(c["month_days_left"]),
             "share": (dim - int(c["month_days_left"])) / dim}
    fy = {**card("current_fy"), "days_left": int(c["fy_days_left"]),
          "share": (fy_days - int(c["fy_days_left"])) / fy_days}
    return {
        "today": card("today"), "yesterday": card("yesterday"), "month": month, "fy": fy,
        "cumulative": card("all_time")["total"], "balance_on_board": _f(bob),
    }


def berths(q):
    layout = q.all("SELECT berth_name, cx, cy, w, h, angle FROM {s}.jnpa_berths ORDER BY berth_name")
    vessels = q.all("SELECT * FROM {s}.jnpa_vessels_on_berth")
    parcels = {}
    if vessels:
        for p in q.all("""
            SELECT vcn_id, parcel_no, cargo_name, pipeline_name, terminal_name, target_qty,
                   logged_qty, remaining_qty, avg_rate, state
            FROM {s}.jnpa_parcels
            WHERE vcn_id = ANY(%(ids)s) AND state <> 'Removed'
            ORDER BY parcel_op_id
        """, {"ids": [v["vcn_id"] for v in vessels]}):
            parcels.setdefault(p["vcn_id"], []).append({
                "parcel_no": p["parcel_no"], "cargo": p["cargo_name"] or "", "pipeline": p["pipeline_name"] or "",
                "terminal": p["terminal_name"] or "", "target": _f(p["target_qty"]), "done": _f(p["logged_qty"]),
                "balance": _f(p["remaining_qty"]), "rate": _f(p["avg_rate"]), "state": p["state"],
            })

    by_berth = {}
    for v in vessels:
        by_berth.setdefault((v["berth_name"] or "").strip().upper(), []).append({
            "name": v["vessel_name"], "via": v["via_number"], "cargo": v["cargo"] or "",
            "consigner": v["consigner"] or "", "pipeline": v["pipeline"] or "", "terminal": v["terminal"] or "",
            "agent": v["agent"] or "", "loa": _num(v["loa"]),
            "alongside": _iso(v["alongside_at"]), "commenced": _iso(v["ops_commenced"]),
            "total": _f(v["total_qty"]), "handled": _f(v["handled_qty"]), "balance": _f(v["balance_qty"]),
            "today": _f(v["today_qty"]), "rate": _f(v["flow_rate"]), "rate_planned": bool(v["flow_rate_is_planned"]),
            "etc": _iso(v["expected_completion"]), "remarks": v["remarks"] or "", "status": v["status"],
            "parcels": parcels.get(v["vcn_id"], []),
        })

    out = [{
        "berth": b["berth_name"],
        "vessels": by_berth.get((b["berth_name"] or "").strip().upper(), []),
        # Box in jjltpljetty.png pixels; berths without one are listed under the plot.
        "box": {k: _f(b[k]) for k in ("cx", "cy", "w", "h", "angle")} if b["cx"] is not None else None,
    } for b in layout]
    return {"berths": out, "occupied_berths": sum(1 for b in out if b["vessels"])}


def waiting(q):
    rows = q.all("""
        SELECT vessel_name, cargo, total_quantity, state, anchored_at, agent
        FROM {s}.jnpa_waiting_vessels
        WHERE TRIM(COALESCE(vessel_name, '')) <> ''
        ORDER BY state = 'At Anchorage' DESC, anchored_at NULLS LAST, doc_date DESC NULLS LAST
    """)
    return {
        "anchored": sum(1 for r in rows if r["state"] == "At Anchorage"),
        "count": len(rows),
        "vessels": [{"name": r["vessel_name"], "cargo": r["cargo"] or "", "qty": _f(r["total_quantity"]),
                     "state": r["state"], "anchored": _iso(r["anchored_at"]), "agent": r["agent"] or ""}
                    for r in rows[:WAITING_SHOWN]],
    }


def pipelines(q):
    rows = q.all("""
        SELECT pipeline_name, state, live_detail, terminals, month_qty, hydro_status, hydro_days_left
        FROM {s}.jnpa_pipelines
        ORDER BY state = 'pumping' DESC, is_active DESC, pipeline_name
    """)
    return [{"name": r["pipeline_name"], "state": r["state"], "live": r["live_detail"] or "",
             "terminals": r["terminals"] or "", "month_qty": _f(r["month_qty"]),
             "hydro": r["hydro_status"], "hydro_days": r["hydro_days_left"]} for r in rows]


def delays(q):
    rows = q.all("SELECT label, minutes FROM {s}.jnpa_delays_today ORDER BY minutes DESC")
    items = [{"label": r["label"] or "Unlabelled", "minutes": int(r["minutes"]), "count": 1} for r in rows]
    return {"total_minutes": sum(i["minutes"] for i in items), "top": items[:5], "count": len(items)}


def tide(q):
    rows = q.all("""
        SELECT tide_at, height_m, tide_type FROM {s}.jnpa_tide
        WHERE is_upcoming ORDER BY tide_at LIMIT 3
    """)
    return [{"at": _iso(r["tide_at"]), "meters": _f(r["height_m"]), "type": r["tide_type"]} for r in rows]


def weather(q):
    r = q.one("""
        SELECT fetched_at, is_fresh, temp_c, feelslike_c, condition_text, condition_icon,
               wind_kph, gust_kph, wind_dir, humidity, vis_km
        FROM {s}.jnpa_weather ORDER BY fetched_at DESC NULLS LAST LIMIT 1
    """)
    if not r:
        return None
    icon = r["condition_icon"] or ""
    if icon.startswith("//"):
        icon = "https:" + icon
    return {
        "temp": r["temp_c"], "feels": r["feelslike_c"], "text": r["condition_text"], "icon": icon,
        "wind": r["wind_kph"], "gust": r["gust_kph"], "wind_dir": r["wind_dir"],
        "humidity": r["humidity"], "vis": r["vis_km"], "fetched": _iso(r["fetched_at"]),
        "stale": not r["is_fresh"],
    }


def last_synced(q):
    ts = q.scalar("SELECT MAX(_synced_at) FROM {s}.jnpa_clock", default=None)
    return ts.isoformat() if ts else None


def jnpa_summary(loc, now=None):
    now = now or datetime.now()
    errors = []
    with connection() as conn:
        q = SchemaQuery(conn, loc["schema"])
        return {
            "profile": "liquid",
            "as_of": now.strftime("%Y-%m-%dT%H:%M:%S"),
            "last_synced": _run(errors, "sync", last_synced, q),
            "liquid": _run(errors, "throughput", throughput, q),
            "jetty": _run(errors, "berths", berths, q),
            "waiting": _run(errors, "waiting", waiting, q),
            "pipelines": _run(errors, "pipelines", pipelines, q),
            "delays": _run(errors, "delays", delays, q),
            "tide": _run(errors, "tide", tide, q),
            "weather": _run(errors, "weather", weather, q),
            "errors": errors,
        }


def jnpa_pulse(loc, now=None):
    """Light numbers for the map label: today's pumped total and tankers working."""
    try:
        with connection() as conn:
            q = SchemaQuery(conn, loc["schema"])
            total = q.scalar("SELECT total_qty FROM {s}.jnpa_cargo_cards WHERE card = 'today'")
            working = q.scalar("SELECT COUNT(*) FROM {s}.jnpa_vessels_on_berth WHERE status = 'Under Operation'")
            inbound = q.scalar("SELECT COUNT(*) FROM {s}.jnpa_waiting_vessels WHERE state = 'At Anchorage'")
        return {"ok": True, "today": _f(total), "working": int(working), "inbound": int(inbound)}
    except Exception as e:
        log.exception("pulse failed for %s", loc["code"])
        return {"ok": False, "error": str(e).strip().splitlines()[0]}
