"""Self-check for the port feed endpoint and the /data admin page.

Run: python tools/test_feed.py   (no database needed; DB locations show as unreachable)
"""
import base64
import os
import sys
import tempfile

os.environ.update(DATABASE_URL="postgresql://x@127.0.0.1:1/x", ADMIN_ID="admin", ADMIN_PASS="pw",
                  FEED_SECRET="s3cret", FEED_DIR=tempfile.mkdtemp())
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402
from app import _feed_key, _sample_feed, app, feed_errors  # noqa: E402

c = app.test_client()
auth = {"Authorization": "Basic " + base64.b64encode(b"admin:pw").decode()}

# Every feed location's sample is a valid document for its own endpoint.
for loc in config.LOCATIONS:
    if not loc.get("schema"):
        assert feed_errors(_sample_feed(loc), loc["code"]) == [], loc["code"]

ok = _sample_feed(config.location("SWPL"))
url, key = "/api/feed/SWPL", {"X-Feed-Key": _feed_key("SWPL")}
assert c.post(url, json=ok).status_code == 401                                  # no key
assert c.post(url, json=ok, headers={"X-Feed-Key": _feed_key("MCT")}).status_code == 401   # another port's key
assert c.post("/api/feed/DPPL", json=ok, headers=key).status_code == 404        # DB port takes no feed
assert c.post(url, data="nope", headers=key).status_code == 400
bad = {**ok, "berths": "x"}
r = c.post(url, json=bad, headers=key)
assert r.status_code == 422 and any(e.startswith("berths") for e in r.json["errors"]), r.json
r = c.post(url, json={**ok, "port": {**ok["port"], "code": "MCT"}}, headers=key)
assert r.status_code == 422 and "does not match" in r.json["errors"][0], r.json
assert c.post(url, json=ok, headers=key).status_code == 200

assert c.get("/data").status_code == 401
assert c.get("/data", headers={"Authorization": "Basic " + base64.b64encode(b"admin:no").decode()}).status_code == 401
page = c.get("/data", headers=auth)
assert page.status_code == 200 and b"Live" in page.data and b"Unreachable" in page.data
assert c.get("/data/SWPL/latest.json", headers=auth).json["feed"] == ok
assert c.get("/data/MCT/latest.json", headers=auth).status_code == 404
assert c.get("/data/MCTL/sample.json", headers=auth).json["port"]["type"] == "container"
print("ok")
