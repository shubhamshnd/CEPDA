"""Berth layout editor: draw the berth boxes the dashboard plots vessels on.

Open a port's berth photo, draw one box per berth, name it, and save a JSON file
the port team can send along with their data.

    pip install PySide6
    python tools/berth_layout_editor.py [image-or-layout.json]

Box convention (the same one the dashboard reads from vw_port_overview_berth_layout
and jnpa_berths), all in the photo's own pixels, origin top-left, y down:

    cx, cy   centre of the box
    w        across the berth (water -> jetty)
    h        along the berth (its length)
    angle    degrees, clockwise
    jetty    the box's +x edge (drawn thick here) is the berth face. The dashboard
             puts the berth label just past it and moors vessels inward from it,
             so the rest of the box should be the water where vessels lie.

Mouse:  drag on empty photo = new berth | drag a box = move | drag the corner dot =
        resize | drag the top dot = rotate (Shift: 15 degree steps) | wheel = zoom |
        middle drag = pan
Keys:   Delete = remove | F = flip jetty side | [ ] = rotate 1 degree | arrows = nudge
"""
import json
import math
import sys
from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QAction, QBrush, QColor, QFont, QKeySequence, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication, QDoubleSpinBox, QFileDialog, QFormLayout, QGraphicsItem, QGraphicsPixmapItem,
    QGraphicsScene, QGraphicsView, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMainWindow,
    QMessageBox, QPushButton, QSplitter, QVBoxLayout, QWidget,
)

FORMAT = "jsw-berth-layout/1"
HANDLE = 6          # handle radius, screen-independent enough at normal zoom
ROT_GAP = 26        # how far the rotate handle sits beyond the box's top edge
MIN_SIDE = 8

FILL = QColor(54, 195, 255, 55)
FILL_SEL = QColor(54, 195, 255, 95)
EDGE = QColor(54, 195, 255)
JETTY = QColor(227, 176, 75)


class BerthItem(QGraphicsItem):
    """One berth box. Local frame: centre at (0, 0), x across the berth (+x = jetty), y along it."""

    def __init__(self, name, cx, cy, w, h, angle, berth_id="", on_change=None):
        super().__init__()
        self.name, self.berth_id = name, berth_id
        self.w, self.h = float(w), float(h)
        self.on_change = on_change or (lambda item: None)
        self._mode = None
        self.setPos(cx, cy)
        self.setRotation(angle)
        self.setFlags(QGraphicsItem.ItemIsSelectable | QGraphicsItem.ItemIsMovable
                      | QGraphicsItem.ItemSendsGeometryChanges | QGraphicsItem.ItemIsFocusable)
        self.setAcceptHoverEvents(True)

    # ── geometry ───────────────────────────────────────
    def rect(self):
        return QRectF(-self.w / 2, -self.h / 2, self.w, self.h)

    def corner(self):
        return QPointF(self.w / 2, self.h / 2)

    def rot_knob(self):
        return QPointF(0, -self.h / 2 - ROT_GAP)

    def boundingRect(self):
        m = HANDLE + 2
        r = self.rect().adjusted(-m, -m - ROT_GAP, m, m)
        return r.adjusted(-60, -20, 60, 20)       # room for the name label

    def shape(self):
        # Only the box and its handles take clicks, so a new berth can be drawn right beside it.
        path = QPainterPath()
        path.addRect(self.rect())
        if self.isSelected():
            for c in (self.corner(), self.rot_knob()):
                path.addEllipse(c, HANDLE + 3, HANDLE + 3)
        return path

    def to_dict(self, seq):
        return {
            "berth_id": self.berth_id or self.name, "berth_name": self.name, "sequence": seq,
            "cx": round(self.pos().x(), 2), "cy": round(self.pos().y(), 2),
            "w": round(self.w, 2), "h": round(self.h, 2),
            "angle": round(((self.rotation() + 180) % 360) - 180, 2),
        }

    def set_size(self, w, h):
        self.prepareGeometryChange()
        self.w, self.h = max(MIN_SIDE, w), max(MIN_SIDE, h)
        self.update()
        self.on_change(self)

    # ── drawing ────────────────────────────────────────
    def paint(self, p, option, widget=None):
        sel = self.isSelected()
        r = self.rect()
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(QPen(EDGE, 1.5 if sel else 1, Qt.SolidLine))
        p.setBrush(QBrush(FILL_SEL if sel else FILL))
        p.drawRect(r)
        # jetty side (+x edge): the berth face
        p.setPen(QPen(JETTY, 4, Qt.SolidLine, Qt.FlatCap))
        p.drawLine(QPointF(r.right(), r.top()), QPointF(r.right(), r.bottom()))
        # name, upright-ish along the box
        p.setPen(QColor(255, 255, 255))
        f = QFont("Segoe UI", 9, QFont.DemiBold)
        p.setFont(f)
        p.drawText(QRectF(-60, -10, 120, 20), Qt.AlignCenter, self.name)
        if sel:
            p.setPen(QPen(EDGE, 1, Qt.DashLine))
            p.drawLine(QPointF(0, r.top()), self.rot_knob())
            p.setPen(QPen(QColor(8, 18, 42), 1))
            p.setBrush(QBrush(QColor(255, 255, 255)))
            p.drawEllipse(self.corner(), HANDLE, HANDLE)
            p.setBrush(QBrush(JETTY))
            p.drawEllipse(self.rot_knob(), HANDLE, HANDLE)

    # ── mouse: move (default), resize (corner), rotate (knob) ──
    def mousePressEvent(self, e):
        local = e.pos()
        if self.isSelected() and _near(local, self.corner()):
            self._mode = "resize"
        elif self.isSelected() and _near(local, self.rot_knob()):
            self._mode = "rotate"
        else:
            self._mode = None
            super().mousePressEvent(e)
            return
        e.accept()

    def mouseMoveEvent(self, e):
        if self._mode == "resize":            # symmetric about the centre: cx, cy stay put
            self.set_size(2 * abs(e.pos().x()), 2 * abs(e.pos().y()))
        elif self._mode == "rotate":
            c, s = self.scenePos(), e.scenePos()
            ang = math.degrees(math.atan2(s.y() - c.y(), s.x() - c.x())) + 90   # knob sits at -y
            if e.modifiers() & Qt.ShiftModifier:
                ang = round(ang / 15) * 15
            self.setRotation(ang)
        else:
            super().mouseMoveEvent(e)

    def mouseReleaseEvent(self, e):
        self._mode = None
        super().mouseReleaseEvent(e)

    def itemChange(self, change, value):
        if change in (QGraphicsItem.ItemPositionHasChanged, QGraphicsItem.ItemRotationHasChanged):
            self.on_change(self)
        return super().itemChange(change, value)


def _near(a, b):
    return math.hypot(a.x() - b.x(), a.y() - b.y()) <= HANDLE + 3


class PhotoView(QGraphicsView):
    """Wheel zooms, middle button pans, a drag on empty photo draws a new berth."""
    drawn = Signal(QRectF)

    def __init__(self, scene):
        super().__init__(scene)
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setBackgroundBrush(QColor(8, 18, 42))
        self._start = self._band = self._pan = None

    def wheelEvent(self, e):
        f = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
        self.scale(f, f)

    def mousePressEvent(self, e):
        if e.button() == Qt.MiddleButton:
            self._pan = e.position()
            self.setCursor(Qt.ClosedHandCursor)
            return
        item = self.itemAt(e.position().toPoint())
        if e.button() == Qt.LeftButton and not isinstance(item, BerthItem) and self.scene().photo:
            self.scene().clearSelection()
            self._start = self.mapToScene(e.position().toPoint())
            self._band = self.scene().addRect(QRectF(self._start, self._start), QPen(JETTY, 1, Qt.DashLine))
            return
        super().mousePressEvent(e)

    def mouseMoveEvent(self, e):
        if self._pan is not None:
            d = e.position() - self._pan
            self._pan = e.position()
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - int(d.x()))
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - int(d.y()))
            return
        if self._band:
            self._band.setRect(QRectF(self._start, self.mapToScene(e.position().toPoint())).normalized())
            return
        super().mouseMoveEvent(e)

    def mouseReleaseEvent(self, e):
        if self._pan is not None:
            self._pan = None
            self.unsetCursor()
            return
        if self._band:
            r = self._band.rect()
            self.scene().removeItem(self._band)
            self._band = None
            if r.width() >= MIN_SIDE and r.height() >= MIN_SIDE:
                self.drawn.emit(r)
            return
        super().mouseReleaseEvent(e)


class Scene(QGraphicsScene):
    def __init__(self):
        super().__init__()
        self.photo = None


class Editor(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Berth layout editor")
        self.resize(1300, 860)
        self.scene = Scene()
        self.view = PhotoView(self.scene)
        self.view.drawn.connect(self.add_from_rect)
        self.scene.selectionChanged.connect(self.show_selected)
        self.image_path = None
        self.json_path = None
        self.dirty = False
        self._sync = False

        # side panel: list + fields
        self.list = QListWidget()
        self.list.currentRowChanged.connect(self.select_row)
        self.f_name, self.f_id = QLineEdit(), QLineEdit()
        self.f_id.setPlaceholderText("same as name")
        self.f = {k: QDoubleSpinBox() for k in ("cx", "cy", "w", "h", "angle")}
        for k, sb in self.f.items():
            sb.setDecimals(2)
            sb.setRange(-180, 180) if k == "angle" else sb.setRange(0, 100000)
            sb.setSingleStep(1)
            sb.valueChanged.connect(self.fields_changed)
        self.f_name.editingFinished.connect(self.fields_changed)
        self.f_id.editingFinished.connect(self.fields_changed)
        form = QFormLayout()
        form.addRow("Name", self.f_name)
        form.addRow("Berth ID", self.f_id)
        labels = {"cx": "Centre x", "cy": "Centre y", "w": "Width (across)", "h": "Length (along)", "angle": "Angle °"}
        for k, sb in self.f.items():
            form.addRow(labels[k], sb)
        flip = QPushButton("Flip jetty side (F)")
        flip.clicked.connect(self.flip)
        delete = QPushButton("Delete berth")
        delete.clicked.connect(self.delete_selected)
        self.info = QLabel("Open a berth photo to start (File > Open photo).")
        self.info.setWordWrap(True)
        self.info.setStyleSheet("color: #8899aa;")
        side = QVBoxLayout()
        side.addWidget(QLabel("Berths"))
        side.addWidget(self.list, 1)
        side.addLayout(form)
        row = QHBoxLayout()
        row.addWidget(flip)
        row.addWidget(delete)
        side.addLayout(row)
        side.addWidget(self.info)
        panel = QWidget()
        panel.setLayout(side)
        panel.setMinimumWidth(300)
        split = QSplitter()
        split.addWidget(self.view)
        split.addWidget(panel)
        split.setStretchFactor(0, 1)
        self.setCentralWidget(split)
        self.set_fields_enabled(False)

        m = self.menuBar().addMenu("&File")
        for text, key, fn in (("Open photo…", QKeySequence.Open, self.open_photo),
                              ("Open layout JSON…", "Ctrl+L", self.open_json),
                              ("Save layout JSON", QKeySequence.Save, self.save),
                              ("Save layout JSON as…", QKeySequence.SaveAs, self.save_as)):
            a = QAction(text, self)
            a.setShortcut(key)
            a.triggered.connect(fn)
            m.addAction(a)
        for key, fn in (("Delete", self.delete_selected), ("F", self.flip),
                        ("[", lambda: self.rotate_by(-1)), ("]", lambda: self.rotate_by(1)),
                        ("Left", lambda: self.nudge(-1, 0)), ("Right", lambda: self.nudge(1, 0)),
                        ("Up", lambda: self.nudge(0, -1)), ("Down", lambda: self.nudge(0, 1))):
            a = QAction(self)
            a.setShortcut(key)
            a.setShortcutContext(Qt.WidgetShortcut)   # only while the photo has focus, not while typing
            a.triggered.connect(fn)
            self.view.addAction(a)

    # ── berths ─────────────────────────────────────────
    def berths(self):
        return [i for i in self.scene.items(Qt.AscendingOrder) if isinstance(i, BerthItem)]

    def add_berth(self, name, cx, cy, w, h, angle, berth_id=""):
        item = BerthItem(name, cx, cy, w, h, angle, berth_id, on_change=self.item_changed)
        self.scene.addItem(item)
        self.refresh_list()
        return item

    def add_from_rect(self, r):
        n = len(self.berths()) + 1
        item = self.add_berth(f"BERTH {n}", r.center().x(), r.center().y(), r.width(), r.height(), 0)
        self.scene.clearSelection()
        item.setSelected(True)
        self.mark_dirty()

    def item_changed(self, item):
        self.mark_dirty()
        if item.isSelected() and not self._sync:
            self.show_selected()

    def selected(self):
        s = [i for i in self.scene.selectedItems() if isinstance(i, BerthItem)]
        return s[0] if s else None

    def refresh_list(self):
        self._sync = True
        cur = self.selected()
        self.list.clear()
        for i, b in enumerate(self.berths()):
            self.list.addItem(b.name)
            if b is cur:
                self.list.setCurrentRow(i)
        self._sync = False

    def select_row(self, row):
        if self._sync or row < 0:
            return
        items = self.berths()
        if row < len(items):
            self.scene.clearSelection()
            items[row].setSelected(True)
            self.view.ensureVisible(items[row])

    def show_selected(self):
        b = self.selected()
        self.set_fields_enabled(b is not None)
        if not b:
            return
        prev, self._sync = self._sync, True
        d = b.to_dict(0)
        self.f_name.setText(b.name)
        self.f_id.setText(b.berth_id)
        for k, sb in self.f.items():
            sb.setValue(d[k])
        self.list.setCurrentRow(self.berths().index(b))
        self._sync = prev

    def fields_changed(self):
        b = self.selected()
        if self._sync or not b:
            return
        v = {k: sb.value() for k, sb in self.f.items()}   # read everything before applying any of it
        self._sync = True
        b.name = self.f_name.text().strip() or b.name
        b.berth_id = self.f_id.text().strip()
        b.setPos(v["cx"], v["cy"])
        b.setRotation(v["angle"])
        b.set_size(v["w"], v["h"])
        self._sync = False
        self.refresh_list()
        self.mark_dirty()

    def set_fields_enabled(self, on):
        for w in (self.f_name, self.f_id, *self.f.values()):
            w.setEnabled(on)

    def delete_selected(self):
        b = self.selected()
        if b:
            self.scene.removeItem(b)
            self.refresh_list()
            self.mark_dirty()

    def flip(self):
        b = self.selected()
        if b:
            b.setRotation(b.rotation() + 180)

    def rotate_by(self, d):
        b = self.selected()
        if b:
            b.setRotation(b.rotation() + d)

    def nudge(self, dx, dy):
        b = self.selected()
        if b:
            b.moveBy(dx, dy)

    # ── files ──────────────────────────────────────────
    def load_photo(self, path):
        pix = QPixmap(str(path))
        if pix.isNull():
            QMessageBox.warning(self, "Berth layout editor", f"Could not open {path}")
            return False
        for b in self.berths():
            self.scene.removeItem(b)
        if self.scene.photo:
            self.scene.removeItem(self.scene.photo)
        self.scene.photo = QGraphicsPixmapItem(pix)
        self.scene.photo.setZValue(-1)
        self.scene.addItem(self.scene.photo)
        self.scene.setSceneRect(QRectF(pix.rect()).adjusted(-200, -200, 200, 200))
        self.image_path = Path(path)
        self.json_path = None
        self.view.fitInView(self.scene.photo, Qt.KeepAspectRatio)
        self.refresh_list()
        self.dirty = False
        self.update_title()
        self.info.setText(f"{self.image_path.name}: {pix.width()} x {pix.height()} px. "
                          "Drag on the photo to draw a berth.")
        return True

    def open_photo(self):
        if not self.ok_to_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Open berth photo", "", "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if path:
            self.load_photo(path)

    def load_json(self, path):
        path = Path(path)
        data = json.loads(path.read_text(encoding="utf-8"))
        img = path.parent / data.get("image", "")
        if not img.is_file():
            alt, _ = QFileDialog.getOpenFileName(self, f"Find the photo for {path.name}", str(path.parent),
                                                 "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
            if not alt:
                return False
            img = Path(alt)
        if not self.load_photo(img):
            return False
        for b in sorted(data.get("berths", []), key=lambda b: b.get("sequence", 0)):
            self.add_berth(b["berth_name"], b["cx"], b["cy"], b["w"], b["h"], b.get("angle", 0), b.get("berth_id", ""))
        self.json_path = path
        self.dirty = False
        self.update_title()
        return True

    def open_json(self):
        if not self.ok_to_discard():
            return
        path, _ = QFileDialog.getOpenFileName(self, "Open berth layout", "", "Berth layout (*.json)")
        if path:
            self.load_json(path)

    def layout_dict(self):
        pix = self.scene.photo.pixmap()
        return {
            "format": FORMAT,
            "image": self.image_path.name,
            "image_width": pix.width(),
            "image_height": pix.height(),
            "convention": "cx,cy = box centre; w = across the berth; h = along it; angle = degrees clockwise; "
                          "the box's +x edge is the jetty side (berth face). Photo pixels, origin top-left.",
            "berths": [b.to_dict(i + 1) for i, b in enumerate(self.berths())],
        }

    def write_json(self, path):
        Path(path).write_text(json.dumps(self.layout_dict(), indent=2), encoding="utf-8")
        self.json_path = Path(path)
        self.dirty = False
        self.update_title()

    def save(self):
        if not self.scene.photo:
            return
        if self.json_path:
            self.write_json(self.json_path)
        else:
            self.save_as()

    def save_as(self):
        if not self.scene.photo:
            return
        default = str(self.image_path.with_name(self.image_path.stem + "_berths.json"))
        path, _ = QFileDialog.getSaveFileName(self, "Save berth layout", default, "Berth layout (*.json)")
        if path:
            self.write_json(path)

    # ── housekeeping ───────────────────────────────────
    def mark_dirty(self):
        if not self.dirty:
            self.dirty = True
            self.update_title()

    def update_title(self):
        name = self.json_path.name if self.json_path else (self.image_path.name if self.image_path else "")
        self.setWindowTitle(f"Berth layout editor{' - ' + name if name else ''}{' *' if self.dirty else ''}")

    def ok_to_discard(self):
        if not self.dirty:
            return True
        r = QMessageBox.question(self, "Berth layout editor", "Discard unsaved changes?")
        return r == QMessageBox.Yes

    def closeEvent(self, e):
        e.accept() if self.ok_to_discard() else e.ignore()


def main(argv):
    app = QApplication(argv)
    app.setStyle("Fusion")
    w = Editor()
    w.show()
    if len(argv) > 1:
        arg = Path(argv[1])
        w.load_json(arg) if arg.suffix.lower() == ".json" else w.load_photo(arg)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
