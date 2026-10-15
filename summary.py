"""Summary stats for one port, read from its mirrored views.

Each section is fetched independently: if one view is missing or broken the
panel still shows everything else, and the failure is listed under 'errors'.
"""
import calendar
import logging
from datetime import date, datetime, timedelta

from config import BASELINE_CUTOFF, WEATHER_STALE_HOURS
from db import SchemaQuery, connection

log = logging.getLogger(__name__)

SHIFTS = ("A", "B", "C")
TP = "{s}.vw_port_overview_cargo_throughput"


# ---------------------------------------------------------------------------
# Calendar helpers (op-day runs 06:00 -> 06:00, FY April -> March)
# ---------------------------------------------------------------------------

def operational_date(now):
    d = now.date()
    return d - timedelta(days=1) if now.hour < 6 else d


def current_shift(now):
    h = now.hour
    if 6 <= h < 14:
        return "A"
    if 14 <= h < 22:
        return "B"
    return "C"


def fy_start_year(d):
    return d.year if d.month >= 4 else d.year - 1


def fy_label(start):
    return f"{start}-{start + 1}"


def _f(v):
    return round(float(v or 0), 2)


def _norm_type(t):
    t = (t or "OTHERS").strip().upper()
    return "OTHERS" if t in ("OTHER", "") else t


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

def _by_type(q, start, end):
    rows = q.all(f"""
        SELECT COALESCE(cargo_type, 'OTHERS') AS cargo_type, SUM(quantity) AS qty
        FROM {TP}
        WHERE counts_toward_fy AND entry_date BETWEEN %(a)s AND %(b)s
        GROUP BY 1
    """, {"a": start, "b": end})
    out = {}
    for r in rows:
        k = _norm_type(r["cargo_type"])
        out[k] = out.get(k, 0) + float(r["qty"] or 0)
    return {k: round(v, 2) for k, v in sorted(out.items(), key=lambda kv: -kv[1]) if v > 0}


def _by_shift(q, day):
    rows = q.all(f"""
        SELECT UPPER(TRIM(shift)) AS shift, SUM(quantity) AS qty
        FROM {TP}
        WHERE counts_toward_fy AND entry_date = %(d)s
        GROUP BY 1
    """, {"d": day})
    got = {r["shift"]: _f(r["qty"]) for r in rows}
    return {s: got.get(s, 0) for s in SHIFTS}


def _baseline_total(q):
    # The baseline carries OTHER and OTHERS as the same bucket; count it once.
    rows = q.all("""
        SELECT cargo_type, qty_till_mar_2026 AS qty
        FROM {s}.vw_port_overview_cargo_baseline
    """)
    seen = {}
    for r in rows:
        seen.setdefault(_norm_type(r["cargo_type"]), float(r["qty"] or 0))
    return sum(seen.values())


def throughput(q, today, now):
    fy = fy_start_year(today)
    fyl = fy_label(fy)
    month_start = today.replace(day=1)
    yesterday = today - timedelta(days=1)
    fy_start = date(fy, 4, 1)
    fy_end = date(fy + 1, 3, 31)
    days_in_month = calendar.monthrange(today.year, today.month)[1]

    today_types = _by_type(q, today, today)
    month_types = _by_type(q, month_start, today)
    fy_types = _by_type(q, fy_start, today)
    yday_types = _by_type(q, yesterday, yesterday)

    today_total = sum(today_types.values())
    month_total = sum(month_types.values())
    fy_total = sum(fy_types.values())

    month_target = _f(q.scalar("""
        SELECT effective_target FROM {s}.vw_port_overview_fy_targets
        WHERE financial_year = %(fy)s AND month_num = %(m)s
    """, {"fy": fyl, "m": today.month}))
    fy_target = _f(q.scalar("""
        SELECT SUM(effective_target) FROM {s}.vw_port_overview_fy_targets
        WHERE financial_year = %(fy)s
    """, {"fy": fyl}))

    # Required per day counts today as a day still to work, so the achieved
    # figure excludes today (same rule as RP01's required-daily card).
    month_done_before = month_total - today_total
    fy_done_before = fy_total - today_total
    month_days_left = days_in_month - today.day + 1
    fy_days_left = (fy_end - today).days + 1
    month_needed = max(month_target - month_done_before, 0) / month_days_left if month_target else None
    fy_needed = max(fy_target - fy_done_before, 0) / fy_days_left if fy_target else None

    # Average over completed op-days this month (today is still in progress).
    done_days = today.day - 1
    month_avg = (month_done_before / done_days) if done_days else None

    baseline = _baseline_total(q)
    since_baseline = float(q.scalar(f"""
        SELECT SUM(quantity) FROM {TP}
        WHERE counts_toward_fy AND entry_date > %(c)s AND entry_date <= %(t)s
    """, {"c": BASELINE_CUTOFF, "t": today}))

    return {
        "fy_label": fyl,
        "month_label": today.strftime("%B %Y"),
        "today": {
            "total": _f(today_total),
            "by_shift": _by_shift(q, today),
            "by_type": today_types,
            "needed": _f(month_needed) if month_needed is not None else None,
        },
        "yesterday": {
            "total": _f(sum(yday_types.values())),
            "by_shift": _by_shift(q, yesterday),
        },
        "month": {
            "total": _f(month_total),
            "target": month_target,
            "by_type": month_types,
            "days_left": month_days_left,
            "avg_per_day": _f(month_avg) if month_avg is not None else None,
            "needed_per_day": _f(month_needed) if month_needed is not None else None,
        },
        "fy": {
            "total": _f(fy_total),
            "target": fy_target,
            "by_type": fy_types,
            "days_left": fy_days_left,
            "needed_per_day": _f(fy_needed) if fy_needed is not None else None,
        },
        "cumulative": _f(baseline + since_baseline),
    }


def at_port(q):
    counts = q.all("""
        SELECT status, asset_type, COUNT(*) AS n, SUM(balance_qty) AS balance
        FROM {s}.vw_port_overview_live_assets
        GROUP BY 1, 2
    """)
    summary = {"Waiting": 0, "Under Discharge": 0, "Discharge Completed": 0}
    balance = 0.0
    for r in counts:
        summary[r["status"] or "Waiting"] = summary.get(r["status"] or "Waiting", 0) + int(r["n"])
        balance += float(r["balance"] or 0)

    berths = q.all("""
        SELECT berth_name, berth_sequence, cx, cy, w, h, angle
        FROM {s}.vw_port_overview_berth_layout
        ORDER BY berth_sequence NULLS LAST, berth_name
    """)
    occ = q.all("""
        SELECT UPPER(TRIM(berth)) AS berth, name, asset_type, cargo, position, tier,
               total_qty, balance_qty, status
        FROM {s}.vw_port_overview_berth_occupancy
        WHERE is_latest_layout
        ORDER BY berth, tier, name
    """)
    by_berth = {}
    for r in occ:
        total = float(r["total_qty"] or 0)
        bal = float(r["balance_qty"] or 0)
        by_berth.setdefault(r["berth"], []).append({
            "name": r["name"],
            "type": (r["asset_type"] or "").upper(),
            "cargo": r["cargo"] or "",
            "position": r["position"] or "",
            "tier": int(r["tier"] or 0),
            "status": r["status"] or "Waiting",
            "total": _f(total),
            "balance": _f(bal),
            "done_pct": round((total - bal) / total * 100) if total else None,
        })

    ordered = []
    seen = set()
    for b in berths:
        key = (b["berth_name"] or "").strip().upper()
        seen.add(key)
        ordered.append({
            "berth": b["berth_name"],
            "vessels": by_berth.get(key, []),
            # Box on the port image, in image pixels; the panel plots vessels on it.
            "box": {k: _f(b[k]) for k in ("cx", "cy", "w", "h", "angle")} if b["cx"] is not None else None,
        })
    for key, vessels in by_berth.items():   # placed at a berth not in the layout
        if key not in seen:
            ordered.append({"berth": key, "vessels": vessels, "box": None})

    return {
        "status": summary,
        "balance_to_discharge": _f(balance),
        "berths": ordered,
        "occupied_berths": sum(1 for b in ordered if b["vessels"]),
    }


def inbound(q):
    rows = q.all("""
        SELECT asset_type, name, cargo, qty, departed_gull_island
        FROM {s}.vw_port_overview_upcoming_arrivals
        ORDER BY departed_gull_island
    """)
    return [{
        "type": (r["asset_type"] or "").upper(),
        "name": r["name"],
        "cargo": r["cargo"] or "",
        "qty": _f(r["qty"]),
        "departed": r["departed_gull_island"] or "",
    } for r in rows]


def delays(q, today):
    rows = q.all("""
        SELECT delay_label, SUM(total_minutes) AS minutes, COUNT(*) AS n
        FROM {s}.vw_port_overview_delays
        WHERE entry_date = %(d)s AND in_top_delays
        GROUP BY delay_label
        HAVING SUM(total_minutes) > 0
        ORDER BY minutes DESC
    """, {"d": today.strftime("%Y-%m-%d")})
    items = [{"label": r["delay_label"] or "Unlabelled", "minutes": int(r["minutes"]), "count": int(r["n"])}
             for r in rows]
    return {"total_minutes": sum(i["minutes"] for i in items), "top": items[:5], "count": len(items)}


def shift_info(q, today, shift):
    rows = q.all("""
        SELECT shift_incharge, note_no, note
        FROM {s}.vw_port_overview_shift_notes
        WHERE report_date = %(d)s AND UPPER(shift) = %(sh)s
        ORDER BY note_no NULLS LAST
    """, {"d": today, "sh": shift})
    incharge = next((r["shift_incharge"] for r in rows if r["shift_incharge"]), "")
    notes = [r["note"] for r in rows if r["note_no"] is not None and (r["note"] or "").strip()]
    return {"shift": shift, "incharge": (incharge or "").strip(), "notes": notes}


def mbc_fleet(q):
    rows = q.all("""
        SELECT mbc_name, cargo_name, mbc_status
        FROM {s}.vw_port_overview_mbc_status
        ORDER BY mbc_status, mbc_name
    """)
    groups = {}
    for r in rows:
        groups.setdefault(r["mbc_status"] or "Unknown", []).append(
            {"name": r["mbc_name"], "cargo": r["cargo_name"] or ""})
    return [{"status": k, "vessels": v} for k, v in groups.items()]


def tide(q, now):
    rows = q.all("""
        SELECT tide_at, tide_meters, tide_type
        FROM {s}.vw_port_overview_tide
        WHERE tide_at >= %(now)s
        ORDER BY tide_at
        LIMIT 3
    """, {"now": now})
    return [{
        "at": r["tide_at"].strftime("%Y-%m-%dT%H:%M"),
        "meters": _f(r["tide_meters"]),
        "type": (r["tide_type"] or "").upper(),
    } for r in rows]


def weather(q, now):
    r = q.one("""
        SELECT fetched_at, temp_c, feelslike_c, condition_text, condition_icon,
               wind_kph, gust_kph, wind_dir, humidity, vis_km
        FROM {s}.vw_port_overview_weather
        ORDER BY fetched_at DESC NULLS LAST
        LIMIT 1
    """)
    if not r:
        return None
    fetched = r["fetched_at"]
    stale = bool(fetched and (now - fetched) > timedelta(hours=WEATHER_STALE_HOURS))
    icon = r["condition_icon"] or ""
    if icon.startswith("//"):
        icon = "https:" + icon
    return {
        "temp": r["temp_c"], "feels": r["feelslike_c"], "text": r["condition_text"],
        "icon": icon, "wind": r["wind_kph"], "gust": r["gust_kph"], "wind_dir": r["wind_dir"],
        "humidity": r["humidity"], "vis": r["vis_km"],
        "fetched": fetched.strftime("%Y-%m-%dT%H:%M") if fetched else None,
        "stale": stale,
    }


def last_synced(q):
    ts = q.scalar(f"SELECT MAX(_synced_at) FROM {TP}", default=None)
    return ts.isoformat() if ts else None


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def _run(errors, name, fn, *args):
    try:
        return fn(*args)
    except Exception as e:   # one broken view must not blank the panel
        log.exception("section %s failed", name)
        errors.append({"section": name, "error": str(e).strip().splitlines()[0]})
        return None


def port_summary(loc, now=None):
    now = now or datetime.now()
    today = operational_date(now)
    shift = current_shift(now)
    errors = []
    with connection() as conn:
        q = SchemaQuery(conn, loc["schema"])
        return {
            "code": loc["code"],
            "name": loc["name"],
            "region": loc.get("region", ""),
            "op_date": today.isoformat(),
            "shift": shift,
            "as_of": now.strftime("%Y-%m-%dT%H:%M:%S"),
            "last_synced": _run(errors, "sync", last_synced, q),
            "throughput": _run(errors, "throughput", throughput, q, today, now),
            "at_port": _run(errors, "at_port", at_port, q),
            "inbound": _run(errors, "inbound", inbound, q),
            "delays": _run(errors, "delays", delays, q, today),
            "shift_info": _run(errors, "shift_info", shift_info, q, today, shift),
            "mbc_fleet": _run(errors, "mbc_fleet", mbc_fleet, q),
            "tide": _run(errors, "tide", tide, q, now),
            "weather": _run(errors, "weather", weather, q, now),
            "errors": errors,
        }


def port_pulse(loc, now=None):
    """Light numbers for the map label: today's total and vessels working."""
    now = now or datetime.now()
    today = operational_date(now)
    try:
        with connection() as conn:
            q = SchemaQuery(conn, loc["schema"])
            total = q.scalar(f"""
                SELECT SUM(quantity) FROM {TP}
                WHERE counts_toward_fy AND entry_date = %(d)s
            """, {"d": today})
            working = q.scalar("""
                SELECT COUNT(*) FROM {s}.vw_port_overview_live_assets
                WHERE status = 'Under Discharge'
            """)
            inbound_n = q.scalar("SELECT COUNT(*) FROM {s}.vw_port_overview_upcoming_arrivals")
        return {"ok": True, "today": _f(total), "working": int(working), "inbound": int(inbound_n)}
    except Exception as e:
        log.exception("pulse failed for %s", loc["code"])
        return {"ok": False, "error": str(e).strip().splitlines()[0]}
