/* Port summary panel: opens on marker click, refreshes while open. */
window.PortPanel = (function () {
  const CFG = window.PORTNET;
  const REFRESH_MS = 2 * 60 * 1000;
  const fmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const reduceMotionPanel = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CARGO_COLORS = {
    'IBRM': '#C97B5A',          // iron ore, rust
    'CBRM': '#8E9AA6',          // coal, graphite
    'FLUXES': '#D9D2B8',        // limestone, dolomite
    'CLINKER': '#7FA88A',
    'SLAG': '#A98CC9',
    'FINISH GOODS': '#6CC4F2',
    'OTHERS': '#5A6C7A',
    // liquid terminals (JNPA)
    'Edible Oil': '#E3B04B',
    'Chemical': '#A98CC9',
    'POL': '#EF8A63',
    'Other liquid': '#6CC4F2',
  };
  const TYPE_NAMES = {
    'IBRM': 'Iron-bearing raw material', 'CBRM': 'Carbon-bearing raw material',
    'FLUXES': 'Fluxes', 'CLINKER': 'Clinker', 'SLAG': 'Slag',
    'FINISH GOODS': 'Finished goods', 'OTHERS': 'Others',
  };

  // MBC voyage stages, in the order a round trip runs.
  const MBC_STAGES = [
    ['UNDER LOADING', 'Under loading'],
    ['LOADED : WAITING AT LOAD PORT', 'Loaded, waiting at load port'],
    ['LOADED : ON THE WAY TO GULL', 'Loaded, heading to Gull Island'],
    ['LOADED : WAITING AT GULL', 'Loaded, waiting at Gull Island'],
    ['LOADED : ON THE WAY TO DHARAMTAR', 'Loaded, heading to Dharamtar'],
    ['LOADED : WAITING AT DHARAMTAR', 'Loaded, waiting at Dharamtar'],
    ['UNDER DISCHARGE AT DHARAMTAR', 'Discharging at Dharamtar'],
    ['EMPTY : ON THE WAY TO JAIGAD', 'Empty, heading to Jaigad'],
    ['EMPTY : WAITING AT JAIGAD', 'Empty, waiting at Jaigad'],
    ['EMPTY : WAITING AT DHARAMTAR', 'Empty, waiting at Dharamtar'],
    ['EMPTY : WAITING AT LOAD PORT', 'Empty, waiting at load port'],
  ];
  const stageIndex = st => { const i = MBC_STAGES.findIndex(([k]) => k === String(st).toUpperCase()); return i < 0 ? 99 : i; };
  const stageLabel = st => { const m = MBC_STAGES.find(([k]) => k === String(st).toUpperCase()); return m ? m[1] : cap(st).replace(/ : /g, ', '); };

  const el = {
    panel: document.getElementById('panel'),
    hero: document.getElementById('panel-hero'),
    img: document.getElementById('panel-img'),
    title: document.getElementById('panel-title'),
    region: document.getElementById('panel-region'),
    meta: document.getElementById('panel-meta'),
    body: document.getElementById('panel-body'),
    close: document.getElementById('panel-close'),
  };

  let code = null, timer = null, data = null, mixPeriod = 'month', lastFocus = null;
  const api = { onClose: null, current: () => code, open, close };

  // ── utils ─────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mt = n => (n == null ? '–' : fmt.format(n));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const cap = s => String(s || '').toLowerCase().replace(/^\w/, c => c.toUpperCase());

  function parseLocal(s) {
    if (!s) return null;
    const d = new Date(String(s).trim().replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  function hm(d) { return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function dayTag(d, ref) {
    const a = new Date(d); a.setHours(0, 0, 0, 0);
    const b = new Date(ref); b.setHours(0, 0, 0, 0);
    const diff = Math.round((a - b) / 864e5);
    if (diff === 0) return '';
    if (Math.abs(diff) < 7) return ' ' + d.toLocaleDateString('en-IN', { weekday: 'short' });
    return ' ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function ago(d) {
    const m = Math.max(0, Math.round((Date.now() - d) / 6e4));
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} d ago`;
  }
  function mins(m) { const h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; }

  // ── sections ──────────────────────────────────────────
  function secToday(t, shift) {
    const s = t.today.by_shift;
    const max = Math.max(1, ...Object.values(s), ...Object.values(t.yesterday.by_shift));
    const bars = ['A', 'B', 'C'].map(k => {
      const h = Math.round((s[k] / max) * 100);
      const now = k === shift;
      return `<div class="shift${now ? ' now' : ''}">
        <div class="bar"><i style="height:${h}%"></i></div>
        Shift ${k}${now ? ', running' : ''}<b>${mt(s[k])}</b></div>`;
    }).join('');
    const need = t.today.needed;
    let line = `Yesterday: <strong>${mt(t.yesterday.total)} MT</strong>.`;
    if (need != null) {
      line += need > 0
        ? ` Needed today to stay on the month target: <strong>${mt(need)} MT</strong>.`
        : ` The month target is already met.`;
    }
    return `<section class="sec">
      <h3>Discharged today <small>op-day from 06:00</small></h3>
      <div><span class="fig fig-xl">${mt(t.today.total)}</span><span class="unit">MT</span></div>
      <div class="shifts">${bars}</div>
      <p class="note">${line}</p>
    </section>`;
  }

  function progressBlock(title, sub, total, target, elapsedShare, footer) {
    if (!target) {
      return `<section class="sec"><h3>${title} <small>${sub}</small></h3>
        <div><span class="fig fig-l">${mt(total)}</span><span class="unit">MT</span></div>
        <p class="note muted">No target has been set for this period.</p></section>`;
    }
    const p = pct(total, target);
    const behind = total < target * elapsedShare;
    return `<section class="sec">
      <h3>${title} <small>${sub}</small></h3>
      <div class="progress">
        <div><span class="fig fig-l">${mt(total)}</span><span class="unit">of ${mt(target)} MT</span></div>
        <span class="pct ${behind ? 'short' : 'good'}">${p}%</span>
      </div>
      <div class="meter" role="img" aria-label="${p}% of target, ${behind ? 'behind' : 'on or ahead of'} pace">
        <i class="${behind ? 'behind' : ''}" style="width:${Math.min(p, 100)}%"></i>
        <span class="pace" style="left:${(elapsedShare * 100).toFixed(1)}%" title="Where the total should be today"></span>
      </div>
      <p class="note">${footer}</p>
    </section>`;
  }

  function secMonth(t, opDate) {
    const m = t.month;
    const d = new Date(opDate + 'T00:00');
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const share = (dim - m.days_left) / dim;
    let foot = '';
    if (m.avg_per_day != null) foot += `Averaging <strong>${mt(m.avg_per_day)} MT</strong> a day so far. `;
    if (m.needed_per_day != null) {
      foot += m.needed_per_day > 0
        ? (m.days_left === 1
          ? `Needs <strong>${mt(m.needed_per_day)} MT</strong> today to reach the target.`
          : `Needs <strong>${mt(m.needed_per_day)} MT</strong> a day for the remaining ${m.days_left} days.`)
        : 'Target met.';
    }
    return progressBlock('This month', t.month_label, m.total, m.target, share, foot);
  }

  function secFY(t) {
    const f = t.fy;
    const start = Number(t.fy_label.split('-')[0]);
    const daysInFY = (new Date(start + 1, 2, 31) - new Date(start, 3, 1)) / 864e5 + 1;
    const share = (daysInFY - f.days_left) / daysInFY;
    const foot = f.needed_per_day == null ? '' : f.needed_per_day > 0
      ? `Needs <strong>${mt(f.needed_per_day)} MT</strong> a day for the remaining ${f.days_left} days.`
      : 'Financial-year target met.';
    return progressBlock('Financial year', `FY ${t.fy_label}`, f.total, f.target, share, foot)
      .replace('</section>', `<p class="note">All-time discharged at this port: <strong>${mt(t.cumulative)} MT</strong>.</p></section>`);
  }

  function secMix(t) {
    const src = { today: t.today.by_type, month: t.month.by_type, fy: t.fy.by_type }[mixPeriod] || {};
    const entries = Object.entries(src);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    const tab = (k, label) => `<button type="button" data-mix="${k}" aria-pressed="${mixPeriod === k}">${label}</button>`;
    const body = entries.length ? `
      <div class="stack" aria-hidden="true">${entries.map(([k, v]) =>
        `<i style="flex:${v};background:${CARGO_COLORS[k] || CARGO_COLORS.OTHERS}"></i>`).join('')}</div>
      <ul class="mix">${entries.map(([k, v]) => `<li>
        <span class="sw" style="background:${CARGO_COLORS[k] || CARGO_COLORS.OTHERS}"></span>
        <span title="${esc(TYPE_NAMES[k] || k)}">${esc(k === 'FINISH GOODS' ? 'Finished goods' : k === 'OTHERS' ? 'Others' : k)}</span>
        <span class="v">${mt(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span></li>`).join('')}</ul>`
      : `<p class="empty-note">Nothing discharged in this period yet.</p>`;
    return `<section class="sec" id="sec-mix">
      <h3>Cargo mix <span class="tabs">${tab('today', 'Today')}${tab('month', 'Month')}${tab('fy', 'FY')}</span></h3>
      ${body}</section>`;
  }

  // Vessels drawn on the port photo using each berth's box (image pixels) from
  // vw_port_overview_berth_layout. Same rules as PORTMAN port_overview: boats
  // stack outward from the berth face by bank tier, A/S innermost.
  // The photo is portrait; it is turned a quarter anticlockwise to sit landscape
  // in the panel: jetty on top, water below, Berth 1 on the right. Boats and berth
  // marks turn with it; names and berth labels are drawn upright on top.
  // kind 'bulk': barges and MBCs (PORTBIRD). kind 'tanker': one tanker per berth,
  // sized like PORTMAN2's jetty view (90% of the berth, beam a fifth of that).
  let plotBoats = [];                   // vessel + berth per boat, indexed by data-i
  const PLOT_H = 380;                   // css px, tallest the berth photo is drawn
  const KINDS = {
    bulk: {
      status: [['working', 'Discharging'], ['waiting', 'Waiting'], ['done', 'Completed']],
      cls: v => v.status === 'Under Discharge' ? 'working' : v.status === 'Discharge Completed' ? 'done' : 'waiting',
      size: (v, h) => { const len = v.type === 'MBC' ? 80 : Math.min(Math.max(h * 0.7, 14), 80); return [len, Math.max(len * 0.3, 6)]; },
      what: v => v.type === 'MBC' ? 'MBC' : 'barge',
      note: 'MBCs drawn longer than barges',
    },
    tanker: {
      status: [['working', 'Under operation'], ['waiting', 'Awaiting ops'], ['done', 'Ops completed']],
      cls: v => v.status === 'Under Operation' ? 'working' : v.status === 'Ops Completed' ? 'done' : 'waiting',
      size: (v, h) => { const len = Math.max(h * 0.9, 20); return [len, Math.max(len * 0.2, 8)]; },
      what: () => 'tanker',
      note: '',
    },
  };
  function berthPlot(berths, src, size, kind = 'bulk') {
    const K = KINDS[kind];
    const [iw, ih] = size, W = ih, H = iw;                    // landscape after the turn
    const turn = (x, y) => [y, iw - x];                        // photo px -> landscape px
    // Crop to the berths, with room either side for names, so boats draw larger.
    const xs = berths.map(b => b.box.cy), ys = berths.map(b => iw - b.box.cx);
    let vx = Math.max(0, Math.min(...xs) - 240), vx1 = Math.min(W, Math.max(...xs) + 240);
    const vy = Math.max(0, Math.min(...ys) - 230), vy1 = Math.min(H, Math.max(...ys) + 230);
    // Keep the crop landscape (at least 1.6:1): a short jetty on a small photo
    // would otherwise be blown up into a narrow, blurry strip.
    const need = Math.min(W, 1.6 * (vy1 - vy));
    if (vx1 - vx < need) {
      vx = Math.max(0, Math.min((vx + vx1) / 2 - need / 2, W - need));
      vx1 = vx + need;
    }
    // Shown at most PLOT_H css px tall (narrower than the panel if need be), so the
    // photo reads as an overview rather than a close-up.
    const cssW = Math.min(el.body.clientWidth - 48, PLOT_H * (vx1 - vx) / (vy1 - vy));
    const k = (vx1 - vx) / Math.max(320, cssW);                  // landscape px per css px
    const fs = 12 * k, turned = [], marks = [], labels = [], obstacles = [];
    const counts = { working: 0, waiting: 0, done: 0 };
    plotBoats = [];
    berths.forEach(b => {
      const { cx, cy, w = 60, h = 60, angle = 0 } = b.box;
      const th = angle * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th);
      // Berth marker on the jetty side, clear of the boats; its label just past it.
      const mx = cx + (w / 2 + 16) * cos, my = cy + (w / 2 + 16) * sin;
      turned.push(`<g transform="translate(${mx},${my}) rotate(${angle})"><line class="bm" y1="${-h / 2}" y2="${h / 2}"/></g>`);
      const [bx, by] = turn(mx + 14 * k, my);
      const markY = turn(mx, my)[1];     // boats sit on the water side of this; names go further out
      marks.push(`<text class="bl" x="${bx}" y="${by}" dy=".35em" text-anchor="middle" font-size="${fs * .9}">${esc(String(b.berth).replace(/^BERTH\s*/i, 'B'))}</text>`);
      let edge = w / 2;
      b.vessels.slice().sort((p, q) => (p.tier || 0) - (q.tier || 0)).forEach(v => {
        const [len, beam] = K.size(v, h);
        const off = edge - beam / 2;
        edge -= beam + 2;
        const x = cx + off * cos, y = cy + off * sin;
        const cls = K.cls(v);
        counts[cls]++;
        const i = plotBoats.push({ v, berth: b.berth, kind }) - 1;
        turned.push(`<rect class="boat ${cls}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(v.name)}, ${K.what(v)} at ${esc(b.berth)}"
          x="${-beam / 2}" y="${-len / 2}" width="${beam}" height="${len}" rx="${beam / 2}"
          transform="translate(${x},${y}) rotate(${angle})"/>`);
        const [sx, sy] = turn(x, y);                           // boats lie roughly along the landscape x axis
        obstacles.push([sx - len / 2, sy - beam / 2, sx + len / 2, sy + beam / 2]);
        const dir = sy >= markY ? 1 : -1;  // +1: water is below the berth on screen, -1: above
        labels.push({ x: sx, edge: sy + dir * beam / 2, dir, name: v.name, i });   // edge: the boat's water side
      });
    });

    // Names on the water side of their boats, each in the nearest row that is
    // free of other names and boats, with a leader line back to the boat.
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const placed = obstacles.slice(), names = [];
    labels.sort((a, b) => a.x - b.x).forEach(L => {
      const half = L.name.length * 3.2 * k + 3 * k;            // ~6.4 px a character at 12 px
      const x = Math.min(Math.max(L.x, vx + half + 4 * k), vx1 - half - 4 * k);
      let y = L.edge + (L.dir > 0 ? 16 : -6) * k, box;
      for (let r = 0; r < 14; r++, y += L.dir * 15 * k) {
        box = [x - half, y - 11 * k, x + half, y + 3 * k];
        if (!placed.some(p => hit(box, p))) break;
      }
      placed.push(box);
      names.push(`<line class="ld" x1="${x}" y1="${y + (L.dir > 0 ? -11 : 3) * k}" x2="${L.x}" y2="${L.edge}"/>
        <text class="vl" data-i="${L.i}" x="${x}" y="${y}" text-anchor="middle" font-size="${fs}">${esc(L.name)}</text>`);
    });

    return `<figure class="berth-plot" style="max-width:${Math.round(cssW)}px"><svg viewBox="${vx} ${vy} ${vx1 - vx} ${vy1 - vy}" role="group" aria-label="Berth layout with vessels at each berth">
      <g transform="translate(0,${iw}) rotate(-90)"><image href="${esc(src)}" width="${iw}" height="${ih}"/>${turned.join('')}</g>
      ${marks.join('')}${names.join('')}</svg>
      <figcaption class="plot-legend">${K.status.map(([c, l]) =>
        `<span><i class="${c}"></i>${l} <b>${counts[c]}</b></span>`).join('')}${K.note ? `<span class="plot-note">${K.note}</span>` : ''}</figcaption>
    </figure>`;
  }

  // Hover card for a boat (or its name label) on the berth plot.
  const tip = document.createElement('div');
  tip.className = 'boat-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;

  function tankerTip(v, berth) {
    const st = KINDS.tanker.cls(v);
    const pct = v.total > 0 ? Math.min(100, Math.round(v.handled / v.total * 100)) : 0;
    const etc = parseLocal(v.etc);
    const row = (k, val) => val ? `<dt>${k}</dt><dd>${val}</dd>` : '';
    const parcels = (v.parcels || []).map(p => {
      const pp = p.target > 0 ? Math.min(100, Math.round(p.done / p.target * 100)) : 0;
      return `<li><div class="bp-top"><span>${esc(p.parcel_no)} · ${esc(p.cargo)}</span><span>${mt(p.done)} / ${mt(p.target)}</span></div>
        <div class="bt-meter"><i class="${p.state === 'Completed' ? 'done' : ''}" style="width:${pp}%"></i></div>
        <small>${esc(p.state)}${p.pipeline ? ' · ' + esc(p.pipeline) : ''}${p.rate ? ` · ${mt(p.rate)} MT/h` : ''}</small></li>`;
    }).join('');
    return `<div class="bt-head"><b>${esc(v.name)}</b><span class="bt-type">Tanker</span></div>
      <div class="bt-where">${esc(berth)}${v.via ? ', VIA ' + esc(v.via) : ''}</div>
      <dl>
        ${row('Cargo', esc(v.cargo))}
        ${row('Consignee', esc(v.consigner))}
        <dt>Quantity</dt><dd>${mt(v.total)} MT</dd>
        <dt>Handled</dt><dd>${mt(v.handled)} MT</dd>
        <dt>Balance</dt><dd>${mt(v.balance)} MT</dd>
        ${row('Today', v.today ? `${mt(v.today)} MT` : '')}
        ${row(v.rate_planned ? 'Rate (planned)' : 'Rate', v.rate ? `${mt(v.rate)} MT/h` : '')}
        ${row('Expected done', etc ? hm(etc) + dayTag(etc, new Date()) : '')}
      </dl>
      <div class="bt-status ${st}"><i></i>${esc(v.status)}<span>${pct}% done</span></div>
      <div class="bt-meter"><i class="${st}" style="width:${pct}%"></i></div>
      ${parcels ? `<ul class="bt-parcels">${parcels}</ul>` : ''}`;
  }

  function tipHtml({ v, berth, kind }) {
    if (kind === 'tanker') return tankerTip(v, berth);
    const st = v.status === 'Under Discharge' ? 'working' : v.status === 'Discharge Completed' ? 'done' : 'waiting';
    const pct = v.done_pct != null ? v.done_pct : 0;
    return `<div class="bt-head"><b>${esc(v.name)}</b><span class="bt-type">${v.type === 'MBC' ? 'MBC' : 'Barge'}</span></div>
      <div class="bt-where">${esc(berth)}, ${esc(v.position || 'A/S')}</div>
      <dl>
        <dt>Cargo</dt><dd>${esc(v.cargo) || '–'}</dd>
        <dt>Quantity</dt><dd>${mt(v.total)} MT</dd>
        <dt>Balance</dt><dd>${mt(v.balance)} MT</dd>
      </dl>
      <div class="bt-status ${st}"><i></i>${esc(v.status)}${v.status !== 'Waiting' ? `<span>${pct}% done</span>` : ''}</div>
      ${v.status !== 'Waiting' ? `<div class="bt-meter"><i class="${st}" style="width:${pct}%"></i></div>` : ''}`;
  }

  // Next to the pointer, or beside the boat when focused by keyboard; kept on screen.
  function placeTip(x, y) {
    const r = tip.getBoundingClientRect(), pad = 14;
    let left = x + pad, top = y + pad;
    if (left + r.width > innerWidth - 8) left = x - pad - r.width;
    if (top + r.height > innerHeight - 8) top = y - pad - r.height;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function showTip(target, x, y) {
    const i = +target.dataset.i;
    if (tipFor !== i) {
      tipFor = i;
      tip.innerHTML = tipHtml(plotBoats[i]);
      tip.classList.toggle('wide', plotBoats[i].kind === 'tanker');
      el.body.querySelectorAll('.berth-plot .hot').forEach(n => n.classList.remove('hot'));
      el.body.querySelectorAll(`.berth-plot [data-i="${i}"]`).forEach(n => n.classList.add('hot'));
    }
    tip.hidden = false;
    placeTip(x, y);
  }
  function hideTip() {
    tip.hidden = true;
    tipFor = null;
    el.body.querySelectorAll('.berth-plot .hot').forEach(n => n.classList.remove('hot'));
  }

  el.body.addEventListener('pointermove', e => {
    const t = e.target.closest('.berth-plot [data-i]');
    if (t) showTip(t, e.clientX, e.clientY); else if (tipFor !== null) hideTip();
  });
  el.body.addEventListener('pointerleave', hideTip);
  el.body.addEventListener('focusin', e => {
    const t = e.target.closest('.berth-plot [data-i]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(t, r.right, r.top);
  });
  el.body.addEventListener('focusout', hideTip);
  el.panel.querySelector('.panel-scroll').addEventListener('scroll', hideTip, { passive: true });

  // ── liquid terminal (JNPA) sections ──────────────────
  function needFoot(p) {
    if (p.needed_per_day == null) return '';
    if (p.needed_per_day <= 0) return 'Target met.';
    return p.days_left === 1 ? `Needs <strong>${mt(p.needed_per_day)} MT</strong> today to reach the target.`
      : `Needs <strong>${mt(p.needed_per_day)} MT</strong> a day for the remaining ${p.days_left} days.`;
  }

  function secLiquid(t) {
    const today = `<section class="sec">
      <h3>Pumped today <small>op-day from 07:00</small></h3>
      <div><span class="fig fig-xl">${mt(t.today.total)}</span><span class="unit">MT</span></div>
      <p class="note">Yesterday: <strong>${mt(t.yesterday.total)} MT</strong>.</p>
    </section>`;
    const fy = progressBlock('Financial year', t.fy.label, t.fy.total, t.fy.target, t.fy.share, needFoot(t.fy))
      .replace('</section>', `<p class="note">All-time handled at this terminal: <strong>${mt(t.cumulative)} MT</strong>.</p></section>`);
    return today + progressBlock('This month', t.month.label, t.month.total, t.month.target, t.month.share, needFoot(t.month))
      + fy + secMix(t);
  }

  function secJetty(j, d, bob) {
    const placed = j.berths.filter(b => b.box);
    const plot = d.berth_image && d.berth_image_size && placed.length
      ? berthPlot(placed, d.berth_image, d.berth_image_size, 'tanker') : '';
    const listed = j.berths.filter(b => !plot || !b.box);   // berths without a box on the photo
    return `<section class="sec">
      <h3>At the jetty <small>${j.occupied_berths} of ${j.berths.length} occupied</small></h3>
      ${bob != null ? `<p class="note">Balance on board: <strong>${mt(bob)} MT</strong></p>` : ''}
      ${plot}
      ${listed.length ? `<ul class="rows">${listed.map(b => `<li><span>${esc(b.berth)}</span>
        <span class="r">${b.vessels.length ? b.vessels.map(v => esc(v.name)).join(', ') : '<span class="muted">Free</span>'}</span>
        ${b.vessels.map(v => `<span class="sub">${esc(v.status)}</span><span class="sub r">${mt(v.balance)} MT left</span>`).join('')}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  function secWaiting(w) {
    if (!w.count) {
      return `<section class="sec"><h3>Waiting and expected</h3><p class="empty-note">No tankers waiting or expected.</p></section>`;
    }
    return `<section class="sec">
      <h3>Waiting and expected <small>${w.anchored} at anchorage, ${w.count - w.anchored} expected</small></h3>
      <ul class="rows">${w.vessels.map(v => {
        const at = parseLocal(v.anchored);
        return `<li><span>${esc(v.name)}<span class="tag">${v.state === 'At Anchorage' ? 'Anchorage' : 'Expected'}</span></span>
          <span class="r">${v.qty ? mt(v.qty) + ' MT' : ''}</span>
          <span class="sub">${esc(v.cargo)}</span>
          <span class="sub r">${at ? 'Anchored ' + ago(at) : esc(v.agent)}</span></li>`;
      }).join('')}</ul>
      ${w.count > w.vessels.length ? `<p class="note muted">And ${w.count - w.vessels.length} more.</p>` : ''}
    </section>`;
  }

  function secPipelines(list) {
    const pumping = list.filter(p => p.state === 'pumping').length;
    const shown = list.filter(p => p.state !== 'inactive');
    const hydro = p => p.hydro === 'expired' ? '<span class="tag bad">Hydro test expired</span>'
      : p.hydro === 'due' ? `<span class="tag warn">Hydro test due in ${p.hydro_days} d</span>` : '';
    return `<section class="sec">
      <h3>Pipelines <small>${pumping} pumping of ${list.length}</small></h3>
      <ul class="pipes">${shown.map(p => `<li class="${esc(p.state)}">
        <div class="pp-top"><span class="pp-dot"></span><b>${esc(p.name)}</b>${hydro(p)}<span class="pp-q">${mt(p.month_qty)} MT this month</span></div>
        ${p.live ? `<div class="pp-live">${esc(p.live)}</div>` : ''}
        ${p.terminals ? `<div class="pp-term">To ${esc(p.terminals)}</div>` : ''}</li>`).join('')}</ul>
      ${list.length > shown.length ? `<p class="note muted">${list.length - shown.length} inactive pipelines not shown.</p>` : ''}
    </section>`;
  }

  function secAtPort(a, d) {
    const placed = a.berths.filter(b => b.box);
    const plot = d.berth_image && d.berth_image_size && placed.length ? berthPlot(placed, d.berth_image, d.berth_image_size) : '';
    const unplaced = a.berths.filter(b => !plot || !b.box);   // berths missing from the layout
    const berths = unplaced.map(b => {
      if (!b.vessels.length) return `<li class="berth empty"><div class="berth-name">${esc(b.berth)}</div></li>`;
      const vs = b.vessels.map(v => {
        const cls = v.status === 'Under Discharge' ? 'working' : v.status === 'Discharge Completed' ? 'done' : '';
        const state = v.status === 'Under Discharge' ? `${mt(v.balance)} MT left`
          : v.status === 'Discharge Completed' ? 'Discharge complete' : 'Waiting to start';
        return `<div class="vessel ${cls}">
          <span class="vn">${esc(v.name)}<em>${esc(v.type === 'MBC' ? 'MBC' : 'Barge')}, ${esc(v.position)}</em></span>
          <span class="vq">${mt(v.total)} MT</span>
          <span class="vc">${esc(v.cargo)}</span>
          <span class="vs">${state}</span>
          ${v.done_pct != null && v.status !== 'Waiting' ? `<span class="vm"><i style="width:${v.done_pct}%"></i></span>` : ''}
        </div>`;
      }).join('');
      return `<li class="berth"><div class="berth-name">${esc(b.berth)}</div>${vs}</li>`;
    }).join('');
    return `<section class="sec">
      <h3>At the berths <small>${a.occupied_berths} of ${a.berths.length} occupied</small></h3>
      <p class="note">Still to discharge at port: <strong>${mt(a.balance_to_discharge)} MT</strong></p>
      ${plot}
      ${unplaced.length ? `<ul class="berths">${berths}</ul>` : ''}
    </section>`;
  }

  function secInbound(list) {
    if (!list.length) {
      return `<section class="sec"><h3>On the way from Gull Island</h3>
        <p class="empty-note">No loaded barges or MBCs are under way right now.</p></section>`;
    }
    const total = list.reduce((a, v) => a + v.qty, 0);
    return `<section class="sec">
      <h3>On the way from Gull Island <small>${mt(total)} MT</small></h3>
      <ul class="rows">${list.map(v => {
        const d = parseLocal(v.departed);
        return `<li><span>${esc(v.name)}<span class="tag">${v.type === 'MBC' ? 'MBC' : 'Barge'}</span></span>
          <span class="r">${mt(v.qty)} MT</span>
          <span class="sub">${esc(v.cargo)}</span>
          <span class="sub r">${d ? 'Left ' + ago(d) : esc(v.departed)}</span></li>`;
      }).join('')}</ul></section>`;
  }

  function secDelays(dl) {
    if (!dl.top.length) {
      return `<section class="sec"><h3>Delays today</h3><p class="empty-note">No delays logged this op-day.</p></section>`;
    }
    const max = dl.top[0].minutes;
    return `<section class="sec">
      <h3>Delays today <small>${mins(dl.total_minutes)} in total</small></h3>
      <ul class="delay-bars">${dl.top.map(d => `<li>
        <div class="top"><span>${esc(d.label)}</span><span>${mins(d.minutes)}</span></div>
        <div class="track"><i style="width:${(d.minutes / max) * 100}%"></i></div></li>`).join('')}</ul>
      ${dl.count > dl.top.length ? `<p class="note muted">Top ${dl.top.length} of ${dl.count} delay types.</p>` : ''}
    </section>`;
  }

  function secTideWeather(tide, wx, asOf) {
    const ref = new Date(asOf);
    const tides = tide && tide.length ? `<ul class="tides">${tide.map(t => {
      const d = new Date(t.at);
      return `<li><span class="${t.type === 'HW' ? 'hw' : ''}">${t.type === 'HW' ? 'High' : 'Low'} ${t.meters} m</span><span>${hm(d)}<span class="muted">${dayTag(d, ref)}</span></span></li>`;
    }).join('')}</ul>` : `<p class="empty-note">No upcoming tides in the table.</p>`;

    let w = `<p class="empty-note">No weather cached.</p>`;
    if (wx) {
      w = `<div class="wx">${wx.icon ? `<img src="${esc(wx.icon)}" alt="" onerror="this.remove()">` : ''}
          <span class="fig fig-l">${Math.round(wx.temp)}°</span></div>
        <p class="note" style="margin-top:4px">${esc(wx.text || '')}<br>
          Wind ${Math.round(wx.wind)} km/h ${esc(wx.wind_dir || '')}${wx.gust ? `, gusts ${Math.round(wx.gust)}` : ''}<br>
          Humidity ${Math.round(wx.humidity)}%</p>
        ${wx.stale ? `<p class="note short">Last updated ${ago(new Date(wx.fetched))}</p>` : ''}`;
    }
    return `<section class="sec duo">
      <div><h3>Next tides</h3>${tides}</div>
      <div><h3>Weather</h3>${w}</div>
    </section>`;
  }

  function secFleet(fleet) {
    if (!fleet.length) return '';
    return `<section class="sec">
      <h3>MBC fleet <small>${fleet.reduce((a, g) => a + g.vessels.length, 0)} vessels</small></h3>
      <ul class="fleet">${[...fleet].sort((a, b) => stageIndex(a.status) - stageIndex(b.status)).map(g => `<li>
        <div class="st"><span>${esc(stageLabel(g.status))}</span><span>${g.vessels.length}</span></div>
        <div class="ns">${g.vessels.map(v => esc(v.name) + (v.cargo ? ` <span class="muted">(${esc(v.cargo)})</span>` : '')).join(', ')}</div>
      </li>`).join('')}</ul></section>`;
  }

  // ── render ────────────────────────────────────────────
  // Capacity, berths, draft and cargo from jswinfrastructure.in (config.FACTS).
  function secFacts(f, d) {
    if (!f) return '';
    return `<section class="sec facts">
      <h3>At a glance <small>${esc(d.status)}${d.overseas ? ', overseas' : ''}</small></h3>
      <div class="stats">${f.stats.map(([v, l]) =>
        `<div class="stat"><span class="fig">${esc(v)}</span><span>${esc(l)}</span></div>`).join('')}</div>
      ${f.about ? `<p class="note">${esc(f.about)}</p>` : ''}
      ${f.cargo.length ? `<div class="chips">${f.cargo.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      <p class="src">Source: <a href="${esc(f.url)}" target="_blank" rel="noopener">jswinfrastructure.in</a></p>
    </section>`;
  }

  function render() {
    const d = data;
    if (!d.connected) {
      el.body.innerHTML = secFacts(d.facts, d) + `<section class="sec">
        ${d.facts ? '' : `<h3>${esc(d.status)}${d.overseas ? ' <small>Overseas</small>' : ''}</h3>`}
        <p class="empty-note">Live operations data for this location is not connected to the dashboard yet.</p></section>`;
      el.body.classList.remove('loading');
      el.meta.textContent = '';
      return;
    }
    const parts = [secFacts(d.facts, d)];
    if (d.profile === 'liquid' && d.views_missing) {
      parts.push(`<section class="sec"><p class="empty-note">Live data for this terminal is not in the dashboard
        database yet. It will appear here automatically once its views are mirrored.</p></section>`);
    } else if (d.profile === 'liquid') {   // JNPA: tankers, parcels, pipelines
      if (d.liquid) parts.push(secLiquid(d.liquid));
      if (d.jetty) parts.push(secJetty(d.jetty, d, d.liquid ? d.liquid.balance_on_board : null));
      if (d.waiting) parts.push(secWaiting(d.waiting));
      if (d.pipelines) parts.push(secPipelines(d.pipelines));
    } else {                               // dry bulk: barges and MBCs
      if (d.throughput) {
        parts.push(secToday(d.throughput, d.shift), secMonth(d.throughput, d.op_date), secFY(d.throughput), secMix(d.throughput));
      }
      if (d.at_port) parts.push(secAtPort(d.at_port, d));
      if (d.inbound) parts.push(secInbound(d.inbound));
    }
    if (d.delays) parts.push(secDelays(d.delays));
    if (d.tide || d.weather) parts.push(secTideWeather(d.tide, d.weather, d.as_of));
    if (d.mbc_fleet) parts.push(secFleet(d.mbc_fleet));
    if (d.errors && d.errors.length) {
      parts.push(`<div class="errors">Some sections could not load: ${d.errors.map(e => `${esc(e.section)} (${esc(e.error)})`).join('; ')}</div>`);
    }
    el.body.innerHTML = parts.join('');
    el.body.classList.remove('loading');

    const synced = d.last_synced ? new Date(d.last_synced) : null;
    el.meta.textContent = synced ? `Data synced ${hm(synced)}${dayTag(synced, new Date())}, ${ago(synced)}` : 'No sync time recorded';
  }

  el.body.addEventListener('click', e => {
    const b = e.target.closest('[data-mix]');
    if (!b || !data) return;
    mixPeriod = b.dataset.mix;
    document.getElementById('sec-mix').outerHTML = secMix(data.liquid || data.throughput);
  });

  async function load() {
    if (!code) return;
    const want = code;
    el.body.classList.add('loading');
    try {
      const res = await fetch(CFG.summary.replace('__CODE__', encodeURIComponent(want)));
      if (!res.ok) throw new Error(`Summary returned ${res.status}`);
      const json = await res.json();
      if (want !== code) return;                 // user switched ports meanwhile
      data = json;
      render();
    } catch (e) {
      if (want !== code) return;
      el.body.classList.remove('loading');
      el.body.innerHTML = `<div class="errors">${esc(e.message)}. The panel will retry in two minutes, or close and reopen it to retry now.</div>`;
    }
  }

  // Crossfade the banner: fade the old one out while the new one loads, swap
  // only once it is decoded, then fade in. No blank frame, no half-drawn image.
  const FADE_MS = 200;
  function setHero(p) {
    el.title.textContent = p.name;
    el.region.textContent = p.region || '';
    const want = p.image || null;
    if (el.img.dataset.src === (want || '')) return;
    el.img.dataset.src = want || '';
    if (!want) { el.img.hidden = true; el.hero.classList.remove('has-img'); return; }
    el.img.classList.add('fading');
    const next = new Image();
    next.src = want;
    Promise.all([next.decode(), new Promise(r => setTimeout(r, el.img.hidden ? 0 : FADE_MS))])
      .then(() => {
        if (el.img.dataset.src !== want) return;     // switched again meanwhile
        el.img.src = want;
        el.img.hidden = false;
        el.hero.classList.add('has-img');
        requestAnimationFrame(() => el.img.classList.remove('fading'));
      })
      .catch(() => {
        if (el.img.dataset.src !== want) return;
        el.img.hidden = true; el.hero.classList.remove('has-img');
      });
  }

  function open(p) {
    if (!el.panel.classList.contains('open')) lastFocus = document.activeElement;
    if (code !== p.code) {
      // Keep the previous port's content, dimmed, until the new summary lands:
      // blanking it first made the panel collapse and spring back.
      data = null;
      el.body.classList.add('loading');
      el.meta.textContent = 'Loading summary';
      el.panel.querySelector('.panel-scroll').scrollTo({ top: 0, behavior: reduceMotionPanel ? 'auto' : 'smooth' });
    }
    code = p.code;
    setHero(p);
    el.panel.classList.add('open');
    el.panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
    el.panel.focus({ preventScroll: true });
    const url = new URL(location.href); url.searchParams.set('port', p.code);
    history.replaceState(null, '', url);
    clearInterval(timer);
    timer = setInterval(load, REFRESH_MS);
    load();
  }

  function close() {
    code = null;
    hideTip();
    clearInterval(timer);
    el.panel.classList.remove('open');
    el.panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    const url = new URL(location.href); url.searchParams.delete('port');
    history.replaceState(null, '', url);
    if (api.onClose) api.onClose();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  el.close.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && code) { e.preventDefault(); close(); } });

  return api;
})();
