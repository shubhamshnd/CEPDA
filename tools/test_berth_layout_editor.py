"""Headless check for the berth layout editor: python tools/test_berth_layout_editor.py

Loads Dharamtar's live berth boxes onto dppl.png, saves them back, and checks
nothing drifts; then edits a box through the side panel and checks it sticks.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
sys.path.insert(0, str(Path(__file__).parent))
from berth_layout_editor import QApplication, Editor  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# vw_port_overview_berth_layout, 16 Oct 2026: name, cx, cy, w, h, angle
DPPL = [("BERTH 1", 601.82, 1272.03, 100, 70, -8), ("BERTH 2", 591.31, 1198.95, 99.7, 70, -9),
        ("BERTH 3", 579.54, 1125.01, 99, 75, -9), ("BERTH 4", 566.94, 1049.24, 100, 77, -9),
        ("BERTH 5", 550.56, 970.22, 99, 70, -10), ("BERTH 5A", 538.02, 902.35, 99, 60, -11),
        ("BERTH 6", 521.9, 812.02, 98, 120, -12), ("BERTH 7", 495.76, 696.84, 98, 120, -15),
        ("BERTH 8", 466.75, 605.52, 98, 75, -18), ("BERTH 8A", 445.14, 534.81, 95, 70, -19),
        ("BERTH 9", 412.71, 445.2, 98, 120, -19), ("BERTH 10", 348.14, 306.06, 65, 120, -42),
        ("BERTH 11", 267.88, 212.68, 65, 120, -40), ("BERTH 12", 191.72, 118.73, 60, 120, -39)]


def main():
    app = QApplication(sys.argv)
    ed = Editor()
    with tempfile.TemporaryDirectory() as tmp:
        img = Path(tmp) / "dppl.png"
        img.write_bytes((ROOT / "static/img/dppl.png").read_bytes())
        src = Path(tmp) / "dppl_berths.json"
        src.write_text(json.dumps({"image": "dppl.png", "berths": [
            {"berth_name": n, "sequence": i, "cx": cx, "cy": cy, "w": w, "h": h, "angle": a}
            for i, (n, cx, cy, w, h, a) in enumerate(DPPL, 1)]}), encoding="utf-8")

        assert ed.load_json(src), "layout did not load"
        out = Path(tmp) / "out.json"
        ed.write_json(out)
        data = json.loads(out.read_text(encoding="utf-8"))
        assert (data["image_width"], data["image_height"]) == (941, 1672), data["image_width"]
        got = [(b["berth_name"], b["cx"], b["cy"], b["w"], b["h"], b["angle"]) for b in data["berths"]]
        assert got == [tuple(map(lambda v: v if isinstance(v, str) else round(v, 2), r)) for r in DPPL], got

        # side-panel edit: change every field at once; none may be lost to field refreshes
        b = ed.berths()[0]
        b.setSelected(True)
        ed.f["angle"].setValue(-20)
        ed.f["w"].setValue(80)
        ed.f["cx"].setValue(610)
        d = b.to_dict(1)
        assert (d["angle"], d["w"], d["cx"]) == (-20, 80, 610), d

        ed.flip()                                   # jetty side flips by 180 degrees
        assert b.to_dict(1)["angle"] == 160, b.to_dict(1)

    print("berth layout editor: ok")


if __name__ == "__main__":
    main()
