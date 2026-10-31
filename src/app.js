(function () {
  'use strict';
  const E = window.LoomEngine;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const n0 = v => nf.format(Math.round(v));
  const n1 = v => (Math.round(v * 10) / 10).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function inr(v) {
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e7) return sg + '₹' + (a / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return sg + '₹' + (a / 1e5).toFixed(1) + ' L';
    return sg + '₹' + nf.format(a);
  }
  const dFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateStr = d => d < 1 ? 'Start of run' : dFmt.format(E.dateOf(d));
  const dateShort = d => d < 1 ? 'Start' : dShort.format(E.dateOf(d));
  const SC = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];   // stage colours
  const STAGE_NAMES = E.STAGES.map(s => s.name);
  const prodOf = id => E.PRODUCTS.find(p => p.id === id);

  /* ---------------- state ---------------- */
  const UI = { tab: 'overview', day: 90, playing: false, timer: null, cfg: null, sim: null, base: null, ser: null, isBase: true,
    oFilter: 'all', oProd: 'all', poFilter: 'all', cmp: { key: '', data: null, busy: false }, lev: { key: '', data: null, busy: false },
    draft: null, dataError: '' };
  UI.cfg = Object.assign({}, E.DEFAULTS);
  UI.cfg.cap = Object.assign({}, E.DEFAULTS.cap);

  /* ---------------- persistence, files, notices ---------------- */
  const STORE = 'loomline.v1';
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify({ cfg: UI.cfg, data: E.dataInfo().custom ? E.getData() : null })); } catch (e) { /* storage unavailable */ }
  }
  function restore() {
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!o) return;
      if (o.data) E.setData(o.data);
      if (o.cfg) UI.cfg = sanitizeCfg(o.cfg);
    } catch (e) { try { localStorage.removeItem(STORE); } catch (e2) { /* ignore */ } E.resetData(); }
  }
  function sanitizeCfg(c) {
    const out = Object.assign({}, E.DEFAULTS, c || {});
    out.cap = Object.assign({}, E.DEFAULTS.cap, (c && c.cap) || {});
    SL.forEach(s => { let v = s.get(out); if (!isFinite(v)) v = s.get(E.DEFAULTS); s.set(out, clamp(v, s.min, s.max)); });
    if (!['edd', 'fifo', 'campaign'].includes(out.rule)) out.rule = 'edd';
    out.seed = clamp(parseInt(out.seed, 10) || 7, 1, 9999);
    return out;
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csv = rows => '\ufeff' + rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
  const iso = d => d < 1 ? '' : E.dateOf(d).toISOString().slice(0, 10);
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2800);
  }
  function renderChip() {
    const c = $('#dataChip'), custom = E.dataInfo().custom;
    c.textContent = custom ? 'Custom data' : 'Demo data'; c.className = 'demo-chip' + (custom ? ' custom' : '');
  }
  const cmpKey = () => JSON.stringify(UI.cfg) + '|' + E.dataInfo().version;

  function sameSettings(a, b) {
    return ['demand', 'supplierLT', 'lateProb', 'safetyDays', 'breakdown', 'rule'].every(k => a[k] === b[k]) &&
      Object.keys(E.DEFAULTS.cap).every(k => a.cap[k] === b.cap[k]);
  }
  function recompute() {
    const atEnd = !UI.sim || UI.day >= UI.sim.H;
    UI.sim = E.simulate(UI.cfg);
    const bc = Object.assign({}, E.DEFAULTS, { horizon: UI.cfg.horizon, seed: UI.cfg.seed });
    bc.cap = Object.assign({}, E.DEFAULTS.cap);
    UI.isBase = sameSettings(UI.cfg, bc);
    UI.base = UI.isBase ? UI.sim : E.simulate(bc);
    UI.ser = E.buildSeries(UI.sim);
    UI.day = atEnd ? UI.sim.H : Math.min(UI.day, UI.sim.H);
  }

  /* ---------------- charts ---------------- */
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 4, 4.8, 6, 8, 10]) if (m * p >= v * 1.02) return m * p;
    return 10 * p;
  }
  function lineChart(host, o) {
    const W = Math.max(260, Math.floor(host.clientWidth || 640)), Hh = o.h || 200;
    const m = { l: o.ml || 46, r: 14, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = Hh - m.t - m.b, n = o.n, S = o.series;
    let ymax = o.ymax;
    if (ymax == null) {
      ymax = 0;
      if (o.stack) { for (let i = 0; i < n; i++) { let t = 0; for (const s of S) t += s.data[i] || 0; ymax = Math.max(ymax, t); } }
      else for (const s of S) for (const v of s.data) if (v != null) ymax = Math.max(ymax, v);
      for (const r of (o.ref || [])) ymax = Math.max(ymax, r.y);
      ymax = niceMax(ymax || 1);
    }
    const X = i => m.l + (n > 1 ? i / (n - 1) * iw : 0), Y = v => m.t + ih - clamp(v / ymax, 0, 1) * ih;
    const yf = o.yfmt || n0;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const y = Y(ymax * k / 4);
      g += `<line class="${k ? 'gl' : 'base'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 7}" y="${y + 4}" text-anchor="end">${yf(ymax * k / 4)}</text>`;
    }
    const step = Math.max(1, Math.ceil((n - 1) / (W < 460 ? 4 : 6)));
    for (let i = 0; i < n; i += step) g += `<text class="ax" x="${X(i)}" y="${Hh - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${o.xlab(i)}</text>`;
    for (const r of (o.ref || [])) g += `<line class="rf" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}"/>` + (r.label ? `<text class="ax" x="${W - m.r}" y="${Y(r.y) - 4}" text-anchor="end">${esc(r.label)}</text>` : '');
    if (o.stack) {
      const base = new Array(n).fill(0);
      for (const s of S) {
        const top = base.map((b, i) => b + (s.data[i] || 0));
        let d = 'M' + X(0) + ' ' + Y(base[0]);
        for (let i = 0; i < n; i++) d += ' L' + X(i).toFixed(1) + ' ' + Y(top[i]).toFixed(1);
        for (let i = n - 1; i >= 0; i--) d += ' L' + X(i).toFixed(1) + ' ' + Y(base[i]).toFixed(1);
        g += `<path d="${d}Z" style="fill:${s.color};fill-opacity:.92;stroke:var(--surface);stroke-width:1.5"/>`;
        for (let i = 0; i < n; i++) base[i] = top[i];
      }
    } else {
      for (const s of S) {
        let d = '', first = true, lastX = 0, firstX = 0;
        for (let i = 0; i < n; i++) { const v = s.data[i]; if (v == null) continue; d += (first ? 'M' : ' L') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); if (first) firstX = X(i); lastX = X(i); first = false; }
        if (!d) continue;
        if (s.area) g += `<path d="${d} L${lastX.toFixed(1)} ${Y(0)} L${firstX.toFixed(1)} ${Y(0)}Z" style="fill:${s.color};fill-opacity:.13"/>`;
        g += `<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>`;
      }
    }
    if (o.mark != null && o.mark >= 0 && o.mark < n) {
      g += `<line class="mk" x1="${X(o.mark)}" x2="${X(o.mark)}" y1="${m.t}" y2="${m.t + ih}"/>`;
      if (!o.stack) for (const s of S) { const v = s.data[o.mark]; if (v != null) g += `<circle cx="${X(o.mark)}" cy="${Y(v)}" r="4" style="fill:${s.color};stroke:var(--surface);stroke-width:2"/>`; }
    }
    g += `<line class="hv" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(o.aria || 'Chart')}">${g}</svg>`;
    const svg = host.firstChild, hit = $('.hit', svg), hv = $('.hv', svg);
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; host.appendChild(tip);
    const idxAt = e => { const r = hit.getBoundingClientRect(); return clamp(Math.round((e.clientX - r.left) / r.width * (n - 1)), 0, n - 1); };
    hit.addEventListener('pointermove', e => {
      const i = idxAt(e); hv.setAttribute('x1', X(i)); hv.setAttribute('x2', X(i)); hv.setAttribute('visibility', 'visible');
      let h = `<b>${esc(o.xtip ? o.xtip(i) : o.xlab(i))}</b>`;
      for (const s of S) { const v = s.data[i]; h += `<div><em style="font-style:normal"><i style="background:${s.color}"></i>${esc(s.name)}</em><span>${v == null ? 'n/a' : (o.vfmt || yf)(v)}</span></div>`; }
      if (o.stack) h += `<div><em style="font-style:normal">Total</em><span>${(o.vfmt || yf)(S.reduce((a, s) => a + (s.data[i] || 0), 0))}</span></div>`;
      tip.innerHTML = h; tip.hidden = false;
      const hr = host.getBoundingClientRect(), px = e.clientX - hr.left;
      tip.style.left = clamp(px + 14, 0, Math.max(0, hr.width - tip.offsetWidth)) + 'px';
      tip.style.top = '4px';
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; hv.setAttribute('visibility', 'hidden'); });
    if (o.onPick) hit.addEventListener('click', e => o.onPick(idxAt(e)));
    hit.style.cursor = o.onPick ? 'pointer' : 'default';
  }

  function barChart(host, o) {
    const W = Math.max(260, Math.floor(host.clientWidth || 640)), Hh = o.h || 200, m = { l: 40, r: 10, t: 10, b: 30 };
    const iw = W - m.l - m.r, ih = Hh - m.t - m.b, n = o.values.length;
    const ymax = niceMax(Math.max(1, ...o.values)), bw = iw / n;
    let g = '';
    for (let k = 0; k <= 4; k++) { const y = m.t + ih - ih * k / 4; g += `<line class="${k ? 'gl' : 'base'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 7}" y="${y + 4}" text-anchor="end">${n0(ymax * k / 4)}</text>`; }
    o.values.forEach((v, i) => {
      const h = v / ymax * ih, x = m.l + i * bw + 2, w = Math.max(2, bw - 4);
      g += `<path d="M${x} ${m.t + ih} V${m.t + ih - h + 3} Q${x} ${m.t + ih - h} ${x + 3} ${m.t + ih - h} H${x + w - 3} Q${x + w} ${m.t + ih - h} ${x + w} ${m.t + ih - h + 3} V${m.t + ih}Z" style="fill:${o.color(i)};fill-opacity:.95"><title>${esc(o.labels[i])}: ${n0(v)} orders</title></path>`;
      if (i % o.every === 0) g += `<text class="ax" x="${x + w / 2}" y="${Hh - 10}" text-anchor="middle">${esc(o.labels[i])}</text>`;
    });
    if (o.axis) g += `<text class="axb" x="${m.l + iw / 2}" y="${Hh}" text-anchor="middle" visibility="hidden">${esc(o.axis)}</text>`;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(o.aria || 'Bar chart')}">${g}</svg>`;
  }

  function spark(vals, rop, color) {
    const W = 120, H = 28, n = vals.length, mx = Math.max(rop * 1.05, ...vals, 1);
    const X = i => 2 + (n > 1 ? i / (n - 1) * (W - 4) : 0), Y = v => H - 3 - v / mx * (H - 6);
    let d = ''; vals.forEach((v, i) => { d += (i ? ' L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><line class="rf" x1="2" x2="${W - 2}" y1="${Y(rop)}" y2="${Y(rop)}"/><path d="${d}" style="fill:none;stroke:${color};stroke-width:1.6;stroke-linejoin:round"/><circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="2.6" style="fill:${color}"/></svg>`;
  }

  function gantt(host, rows, d) {
    const W = Math.max(300, Math.floor(host.clientWidth || 700)), LW = W < 520 ? 84 : 148, rh = 24, top = 22;
    const d0 = d - 24, d1 = d + 12, iw = W - LW - 10, Hh = top + rows.length * rh + 8;
    const X = t => LW + clamp((t - d0) / (d1 - d0), 0, 1) * iw;
    let g = '';
    for (let t = Math.ceil(d0); t <= d1; t++) if (t >= 1 && ((t - 1) % 4 === 0)) g += `<line class="gl" x1="${X(t)}" x2="${X(t)}" y1="${top - 4}" y2="${Hh - 6}"/><text class="ax" x="${X(t)}" y="12" text-anchor="middle">${dateShort(t)}</text>`;
    g += `<line class="mk" x1="${X(d + 1)}" x2="${X(d + 1)}" y1="${top - 4}" y2="${Hh - 6}"/>`;
    rows.forEach((o, r) => {
      const y = top + r * rh, cy = y + rh / 2;
      g += `<text class="ax" x="4" y="${cy + 4}" style="fill:var(--ink-2);font-family:var(--f-mono)">${W < 520 ? o.id.slice(3) : o.id + ' · ' + esc(prodOf(o.product).short)}</text>`;
      const relEnd = o.release !== null && o.release <= d ? o.release : d + 1;
      g += `<rect x="${X(o.arrival)}" y="${cy - 2}" width="${Math.max(1, X(relEnd) - X(o.arrival))}" height="4" rx="2" style="fill:${o.release !== null && o.release <= d ? 'var(--line)' : 'var(--c2)'};fill-opacity:${o.release !== null && o.release <= d ? 1 : .55}"/>`;
      for (let s = 0; s < 4; s++) {
        if (o.start[s] === null || o.start[s] > d) continue;
        const e = o.done[s] !== null && o.done[s] <= d ? o.done[s] + 1 : d + 1;
        g += `<rect x="${X(o.start[s])}" y="${cy - 7}" width="${Math.max(2, X(e) - X(o.start[s]) - 1)}" height="14" rx="3" style="fill:${SC[s]};fill-opacity:.92"><title>${STAGE_NAMES[s]}</title></rect>`;
      }
      if (o.due + 0.5 <= d1 && o.due + 0.5 >= d0) g += `<path d="M${X(o.due + 0.5)} ${y + 1} l4 5 h-8 z" style="fill:var(--ink)"><title>Due ${dateShort(o.due)}</title></path>`;
    });
    host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Order timeline by production stage">${g}</svg>`;
  }

  function tradeoff(host, pts, cur) {
    const W = Math.max(260, Math.floor(host.clientWidth || 640)), Hh = 250, m = { l: 48, r: 22, t: 14, b: 38 };
    const iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    const xs = pts.map(p => p.avgInv), x0 = Math.min(...xs) * 0.94, x1 = Math.max(...xs) * 1.04;
    const ys = pts.map(p => p.otif), y0 = Math.max(0, Math.floor((Math.min(...ys) - 4) / 20) * 20), y1 = 100;
    const X = v => m.l + (v - x0) / (x1 - x0) * iw, Y = v => m.t + ih - (v - y0) / (y1 - y0) * ih;
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4, y = Y(v); g += `<line class="${k ? 'gl' : 'base'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="ax" x="${m.l - 7}" y="${y + 4}" text-anchor="end">${Math.round(v)}%</text>`; }
    for (let k = 0; k <= 4; k++) { const v = x0 + (x1 - x0) * k / 4; g += `<text class="ax" x="${X(v)}" y="${Hh - 16}" text-anchor="middle">${inr(v)}</text>`; }
    g += `<text class="axb" x="${m.l + iw / 2}" y="${Hh - 1}" text-anchor="middle">Average stock held (more safety stock to the right)</text>`;
    let d = ''; pts.forEach((p, i) => { d += (i ? ' L' : 'M') + X(p.avgInv).toFixed(1) + ' ' + Y(p.otif).toFixed(1); });
    g += `<path d="${d}" style="fill:none;stroke:var(--c1);stroke-width:2;stroke-linejoin:round"/>`;
    pts.forEach(p => {
      const on = p.days === cur;
      g += `<circle cx="${X(p.avgInv)}" cy="${Y(p.otif)}" r="${on ? 6 : 4.5}" style="fill:${on ? 'var(--accent)' : 'var(--c1)'};stroke:var(--surface);stroke-width:2"><title>${p.days} days safety stock: ${n1(p.otif)}% on time, ${inr(p.avgInv)} average stock</title></circle>`;
      g += `<text class="ax" x="${X(p.avgInv)}" y="${Y(p.otif) - 10}" text-anchor="middle" style="${on ? 'font-weight:700;fill:var(--ink)' : ''}">${p.days}d</text>`;
    });
    host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="On-time delivery against stock held for different safety stock levels">${g}</svg>`;
  }

  /* ---------------- helpers for views ---------------- */
  const pill = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
  const legend = arr => `<div class="legend">${arr.map(a => `<span><i style="background:${a[1]}"></i>${esc(a[0])}</span>`).join('')}</div>`;
  const setDay = d => { UI.day = clamp(Math.round(d), 0, UI.sim.H); renderScrub(); renderView(); };
  const pickDay = i => { stopPlay(); setDay(i); };
  const roll = (arr, w) => arr.map((v, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w + 1); j <= i; j++) if (arr[j] != null) { s += arr[j]; c++; } return v == null && i === 0 ? null : (c ? s / c : null); });
  function delta(v, b, o) {
    if (UI.isBase || v == null || b == null) return '';
    const d = v - b; if (Math.abs(d) < (o.eps || 0.05)) return `<span class="dl neu">= same as baseline</span>`;
    const good = o.neutral ? null : (o.higherBetter ? d > 0 : d < 0);
    return `<span class="dl ${good === null ? 'neu' : good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${o.fmt(Math.abs(d))} vs baseline</span>`;
  }

  /* ---------------- views ---------------- */
  function kpiTiles(kp, kb) {
    const T = (l, v, s, dl) => `<div class="kpi"><label>${l}</label><div class="v">${v}</div><div class="s">${s}</div>${dl}</div>`;
    return `<div class="kpis">` +
      T('On-time delivery', kp.otif == null ? 'n/a' : n1(kp.otif) + '%', kp.elig ? `${n0(kp.elig)} orders fell due` : 'No orders due yet', delta(kp.otif, kb.otif, { higherBetter: true, fmt: v => n1(v) + ' pts' })) +
      T('Orders shipped', n0(kp.shipN), `of ${n0(kp.recvN)} received, ${n0(kp.openN)} open`, delta(kp.shipN, kb.shipN, { higherBetter: true, eps: 0.5, fmt: v => n0(v) })) +
      T('Open order book', n0(kp.awaitM + kp.prodM) + ' m', `${n0(kp.awaitM)} m awaiting material`, delta(kp.awaitM + kp.prodM, kb.awaitM + kb.prodM, { eps: 100, fmt: v => n0(v) + ' m' })) +
      T('Avg lead time', kp.lead == null ? 'n/a' : n1(kp.lead) + ' d', `${n0(kp.lateOpen)} open orders overdue`, delta(kp.lead, kb.lead, { fmt: v => n1(v) + ' d' })) +
      T('Stock on hand', inr(kp.invValue), `${n0(kp.stockoutDays)} material-short item-days`, delta(kp.invValue, kb.invValue, { neutral: true, eps: 1000, fmt: v => inr(v) })) +
      T('Contribution', inr(kp.contribution), `on ${inr(kp.revenue)} shipped revenue`, delta(kp.contribution, kb.contribution, { higherBetter: true, eps: 1000, fmt: v => inr(v) })) +
      T('Throughput', n0(kp.throughput) + ' m/day', 'fabric shipped per calendar day', delta(kp.throughput, kb.throughput, { higherBetter: true, eps: 20, fmt: v => n0(v) + ' m/day' })) +
      T('Stock turns', kp.turns == null ? 'n/a' : n1(kp.turns) + ' /yr', 'yearly material use over average stock', delta(kp.turns, kb.turns, { higherBetter: true, eps: 0.1, fmt: v => n1(v) })) +
      `</div>`;
  }

  function flowHTML(d, kp) {
    const s = UI.sim.days[d], cfg = UI.sim.cfg;
    const qd = E.STAGES.map((st, i) => s.wip[i] / (st.cap * cfg.cap[st.id] * 0.93));
    let hot = -1, hv = 2; qd.forEach((v, i) => { if (v > hv) { hv = v; hot = i; } });
    let h = `<div class="flow">`;
    h += `<div class="cell"><div class="nm">Awaiting material</div><div class="big">${n0(s.awaitM)} <small>m</small></div><div class="sm">${n0(kp.awaitN)} orders on hold</div><div class="bar"><i style="width:${clamp(s.awaitM / 40000 * 100, 0, 100)}%;background:var(--c2)"></i></div>${kp.awaitN ? pill(kp.awaitN > 3 ? 'crit' : 'warn', 'On hold') : pill('good', 'Clear')}</div>`;
    E.STAGES.forEach((st, i) => {
      const nominal = st.cap * cfg.cap[st.id], util = d ? s.proc[i] / nominal * 100 : 0;
      let status;
      if (d === 0) status = pill('neu', 'Not started');
      else if (s.sunday) status = pill('neu', 'Weekly off');
      else if (s.down[i]) status = pill('crit', 'Breakdown');
      else if (s.starve[i]) { const it = E.ITEMS.find(x => x.kind === 'cons' && x.stage === i && s.short[x.idx]); status = pill('crit', 'Short of ' + (it ? it.name.toLowerCase() : 'supplies')); }
      else if (qd[i] > 3) status = pill('warn', `Queue ${n1(qd[i])} days`); else status = pill('good', 'Running');
      h += `<div class="cell${hot === i ? ' hot' : ''}"><div class="nm">${st.name}${hot === i ? '<em>Bottleneck</em>' : ''}</div><div class="big">${n0(s.wip[i])} <small>m queued</small></div><div class="sm">${s.sunday ? 'Closed today' : n0(util) + '% of capacity used today'}</div><div class="bar"><i style="width:${clamp(util, 0, 100)}%;background:${SC[i]}"></i></div>${status}</div>`;
    });
    h += `<div class="cell"><div class="nm">Shipped today</div><div class="big">${n0(s.shipM)} <small>m</small></div><div class="sm">${n0(s.shipCnt)} order${s.shipCnt === 1 ? '' : 's'} dispatched</div><div class="bar"><i style="width:${clamp(s.shipM / 12000 * 100, 0, 100)}%;background:var(--c3)"></i></div>${pill('info', n0(s.arrCnt) + ' new today')}</div>`;
    return h + `</div>`;
  }

  function viewOverview() {
    const d = UI.day, kp = E.kpiAt(UI.sim, d), kb = E.kpiAt(UI.base, d), ser = UI.ser, n = d + 1;
    const alerts = UI.sim.events.filter(e => e.day <= d && e.sev !== 'info').slice(-7).reverse();
    const html = `<div class="stack">
      ${kpiTiles(kp, kb)}
      <div class="card"><div class="card-h"><h3>Factory flow</h3><span class="sub">${dateStr(d)}${UI.sim.days[d].sunday ? ' · weekly off' : ''}</span></div>${flowHTML(d, kp)}</div>
      <div class="grid2">
        <div class="card"><div class="card-h"><h3>Open order book</h3>${legend([['In production', 'var(--c1)'], ['Awaiting material', 'var(--c2)']])}</div><div class="ch" id="chBook"></div><div class="sub" style="margin-top:6px">Meters of fabric ordered but not yet shipped. Click the chart to jump to a day.</div></div>
        <div class="card"><div class="card-h"><h3>On-time delivery</h3><span class="sub">orders due in the last 14 days</span></div><div class="ch" id="chOtif"></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Alerts</h3><span class="sub">up to ${dateStr(d)}</span></div>
        ${alerts.length ? `<ul class="feed">${alerts.map(e => `<li><time>${dateShort(e.day)}</time>${pill(e.sev === 'crit' ? 'crit' : 'warn', e.sev === 'crit' ? 'Critical' : 'Warning')}<span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<div class="empty">Nothing to flag so far. Press play to run the days forward.</div>'}
      </div></div>`;
    return { html, after() {
      const x = { n, mark: d, xlab: dateShort, xtip: dateStr, onPick: pickDay };
      lineChart($('#chBook'), Object.assign({ series: [{ name: 'In production', color: 'var(--c1)', data: ser.prodM.slice(0, n) }, { name: 'Awaiting material', color: 'var(--c2)', data: ser.awaitM.slice(0, n) }], stack: true, yfmt: v => n0(v / 1000) + 'k', vfmt: v => n0(v) + ' m', aria: 'Open order book over time' }, x));
      lineChart($('#chOtif'), Object.assign({ series: [{ name: 'On-time %', color: 'var(--c1)', area: true, data: ser.otifRoll.slice(0, n) }], ymax: 100, yfmt: v => Math.round(v) + '%', vfmt: v => n1(v) + '%', ref: [{ y: 90, label: 'Target 90%' }], aria: 'Rolling on-time delivery' }, x));
    } };
  }

  function ordStatus(o, d) {
    if (o.ship !== null && o.ship <= d) return o.ship > o.due ? { k: 'late', l: 'Shipped late', c: 'warn' } : { k: 'ok', l: 'Shipped on time', c: 'good' };
    if (o.release === null || o.release > d) return { k: 'await', l: 'Awaiting material', c: d - o.arrival >= 2 ? 'crit' : 'warn', od: o.due < d };
    let s = 0; while (s < 3 && (o.done[s] === null || o.done[s] <= d)) s++;
    const started = o.start[s] !== null && o.start[s] <= d;
    return { k: 'prod', l: (started ? 'In ' : 'Queued · ') + E.STAGES[s].name.toLowerCase(), c: 'info', od: o.due < d, s };
  }
  function viewOrders() {
    const d = UI.day, sim = UI.sim;
    let list = sim.orders.filter(o => o.arrival <= d).map(o => ({ o, st: ordStatus(o, d) }));
    const cnt = k => list.filter(x => k === 'all' || x.st.k === k || (k === 'overdue' && x.st.od)).length;
    const F = [['all', 'All'], ['await', 'Awaiting material'], ['prod', 'In production'], ['overdue', 'Overdue'], ['ok', 'Shipped on time'], ['late', 'Shipped late']];
    const f = UI.oFilter, pf = UI.oProd;
    const shown = list.filter(x => (f === 'all' || x.st.k === f || (f === 'overdue' && x.st.od)) && (pf === 'all' || x.o.product === pf)).sort((a, b) => b.o.arrival - a.o.arrival || b.o.n - a.o.n);
    const rows = shown.slice(0, 80).map(({ o, st }) => {
      const dots = [0, 1, 2, 3].map(s => `<i style="${o.done[s] !== null && o.done[s] <= d ? 'background:' + SC[s] : ''}" class="${st.s === s ? 'cur' : ''}" title="${STAGE_NAMES[s]}"></i>`).join('');
      const slack = (o.ship !== null && o.ship <= d) ? (o.due - o.ship >= 0 ? `${o.due - o.ship} d early` : `${o.ship - o.due} d late`) : (o.due >= d ? `due in ${o.due - d} d` : `${d - o.due} d overdue`);
      return `<tr><td class="id">${o.id}</td><td>${esc(o.customer)}</td><td>${esc(prodOf(o.product).name)}</td><td class="n">${n0(o.qty)}</td><td>${dateShort(o.arrival)}</td><td>${dateShort(o.due)}</td><td>${pill(st.c, st.l)}${st.od ? ' ' + pill('crit', 'Overdue') : ''}</td><td><span class="dots">${dots}</span></td><td class="n">${slack}</td></tr>`;
    }).join('');
    const html = `<div class="stack">
      <div class="grid2">
        <div class="card"><div class="card-h"><h3>Received vs shipped</h3>${legend([['Received', 'var(--c1)'], ['Shipped', 'var(--c3)']])}</div><div class="ch" id="chFlow"></div><div class="sub" style="margin-top:6px">The gap between the lines is the open order book.</div></div>
        <div class="card"><div class="card-h"><h3>Lead time of shipped orders</h3><span class="sub">days from receipt to dispatch</span></div><div class="ch" id="chLead"></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Order book</h3><span class="sub">${n0(list.length)} orders received by ${dateStr(d)}</span></div>
        <div class="chips">${F.map(([k, l]) => `<button class="chip" data-ofilter="${k}" aria-pressed="${f === k}">${l} · ${cnt(k)}</button>`).join('')}
          <select class="sel" id="oProd" style="width:auto;margin-left:auto" aria-label="Filter by product"><option value="all">All products</option>${E.PRODUCTS.map(p => `<option value="${p.id}"${pf === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="tbl tall"><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th class="n">Meters</th><th>Received</th><th>Due</th><th>Status</th><th>Stages</th><th class="n">Timing</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">No orders match this filter yet.</td></tr>'}</tbody></table></div>
        <div class="sub" style="margin-top:8px">${shown.length > 80 ? 'Showing the 80 most recent of ' + shown.length + '. ' : ''}Stage squares fill as weaving, dyeing, finishing and packing complete; the outlined square is where the order sits now.</div>
      </div></div>`;
    return { html, after() {
      const n = d + 1;
      lineChart($('#chFlow'), { n, mark: d, xlab: dateShort, xtip: dateStr, onPick: pickDay, series: [{ name: 'Received', color: 'var(--c1)', data: UI.ser.recvCum.slice(0, n) }, { name: 'Shipped', color: 'var(--c3)', data: UI.ser.shipCum.slice(0, n) }], yfmt: v => n0(v / 1000) + 'k', vfmt: v => n0(v) + ' m', aria: 'Cumulative meters received and shipped' });
      const leads = sim.orders.filter(o => o.ship !== null && o.ship <= d).map(o => o.ship - o.arrival);
      const bins = new Array(10).fill(0); leads.forEach(l => bins[Math.min(9, Math.floor(l / 2))]++);
      barChart($('#chLead'), { values: bins, labels: bins.map((_, i) => i === 9 ? '18+' : (i * 2) + '-' + (i * 2 + 1)), every: 1, color: () => 'var(--c1)', aria: 'Distribution of order lead times' });
    } };
  }

  function viewProduction() {
    const d = UI.day, sim = UI.sim, cfg = sim.cfg, ser = UI.ser, n = d + 1, kp = E.kpiAt(sim, d);
    const sched = sim.orders.filter(o => o.arrival <= d && (o.ship === null || o.ship > d - 3) && o.release !== null && o.release <= d || (o.arrival <= d && o.ship === null))
      .sort((a, b) => a.due - b.due || a.n - b.n).slice(0, 12);
    const stageCards = E.STAGES.map((st, i) => {
      let down = 0, starve = 0, lost = 0;
      for (let t = 1; t <= d; t++) { down += sim.days[t].down[i]; starve += sim.days[t].starve[i]; lost += sim.days[t].lost[i]; }
      const nominal = st.cap * cfg.cap[st.id], wip = sim.days[d].wip[i], qd = wip / (nominal * 0.93);
      return `<div class="stage"><h4><i style="background:${SC[i]}"></i>${st.name}</h4>
        <div class="bar" style="margin-top:10px"><i style="width:${clamp(kp.util[i] * 100, 0, 100)}%;background:${SC[i]}"></i></div>
        <dl><dt>Capacity</dt><dd>${n0(nominal)} m/day</dd><dt>Utilisation (of nominal)</dt><dd>${n0(kp.util[i] * 100)}%</dd><dt>Load when running</dt><dd>${n0(kp.utilAvail[i] * 100)}%</dd><dt>Queue</dt><dd>${n0(wip)} m</dd><dt>Queue length</dt><dd>${n1(qd)} days</dd><dt>Breakdown days</dt><dd>${n0(down)}</dd><dt>Changeover loss</dt><dd>${n0(lost)} m</dd><dt>Supply-short days</dt><dd>${n0(starve)}</dd></dl></div>`;
    }).join('');
    const rule = { edd: 'Earliest due date first', fifo: 'First in, first out', campaign: 'Campaign by product' }[cfg.rule];
    const html = `<div class="stack">
      <div class="stages">${stageCards}</div>
      <div class="grid2">
        <div class="card"><div class="card-h"><h3>Utilisation by stage</h3><span class="sub">7-day average</span></div>${legend(E.STAGES.map((s, i) => [s.name, SC[i]]))}<div class="ch" id="chUtil" style="margin-top:8px"></div></div>
        <div class="card"><div class="card-h"><h3>Work waiting at each stage</h3></div>${legend(E.STAGES.map((s, i) => [s.name, SC[i]]))}<div class="ch" id="chWip" style="margin-top:8px"></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Shop-floor timeline</h3><span class="sub">Sequencing rule: ${rule}. Triangle marks the due date.</span></div>
        ${legend([['Weaving', SC[0]], ['Dyeing', SC[1]], ['Finishing', SC[2]], ['Packing', SC[3]], ['Waiting for material', 'var(--c2)']])}
        <div class="ch" id="chGantt" style="margin-top:8px"></div>
        ${sched.length ? '' : '<div class="empty">No orders in flight yet.</div>'}
      </div></div>`;
    return { html, after() {
      const x = { n, mark: d, xlab: dateShort, xtip: dateStr, onPick: pickDay };
      lineChart($('#chUtil'), Object.assign({ series: E.STAGES.map((s, i) => ({ name: s.name, color: SC[i], data: roll(ser.util[i], 7).slice(0, n) })), ymax: 100, yfmt: v => Math.round(v) + '%', vfmt: v => n0(v) + '%', ref: [{ y: 100, label: '' }], aria: 'Utilisation by stage' }, x));
      lineChart($('#chWip'), Object.assign({ series: E.STAGES.map((s, i) => ({ name: s.name, color: SC[i], data: ser.wip[i].slice(0, n) })), stack: true, yfmt: v => n0(v / 1000) + 'k', vfmt: v => n0(v) + ' m', aria: 'Meters waiting at each stage' }, x));
      if (sched.length) gantt($('#chGantt'), sched, d);
    } };
  }

  function viewInventory() {
    const d = UI.day, sim = UI.sim, s = sim.days[d], ser = UI.ser, n = d + 1;
    const rows = [];
    let below = 0, short = 0, rawValue = 0, consValue = 0;
    ['raw', 'cons'].forEach(kind => {
      rows.push(`<tr class="grp"><td colspan="7">${kind === 'raw' ? 'Raw materials' : 'Consumables'}</td></tr>`);
      E.ITEMS.filter(it => it.kind === kind).forEach(it => {
        const i = it.idx, plan = sim.plan[i], oh = s.onHand[i];
        let use = 0, c = 0; for (let t = Math.max(1, d - 6); t <= d; t++) { use += sim.days[t].used[i]; c++; }
        use = c ? use / c : 0; const cover = use > 0 ? oh / use : null;
        const isShort = d > 0 && (s.short[i] || oh < 1);
        let st; if (isShort) { st = pill('crit', 'Short'); short++; } else if (oh < plan.rop) { st = s.onOrder[i] > 0 ? pill('info', 'On order') : pill('warn', 'Below reorder'); below++; } else st = pill('good', 'OK');
        const hist = []; for (let t = Math.max(0, d - 29); t <= d; t++) hist.push(sim.days[t].onHand[i]);
        if (kind === 'raw') rawValue += oh * it.cost; else consValue += oh * it.cost;
        rows.push(`<tr><td>${esc(it.name)}</td><td class="n">${n0(oh)} ${it.unit}</td><td class="n">${cover == null ? '-' : n1(cover) + ' d'}</td><td class="n">${n0(plan.rop)}</td><td class="n">${n0(s.onOrder[i])}</td><td>${st}</td><td>${spark(hist, plan.rop, isShort ? 'var(--crit)' : 'var(--c1)')}</td></tr>`);
      });
    });
    const T = (l, v, sub) => `<div class="kpi"><label>${l}</label><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    const html = `<div class="stack">
      <div class="kpis">${T('Stock value', inr(s.invValue), `raw ${inr(rawValue)}, consumables ${inr(consValue)}`)}${T('Items short', n0(short), 'blocking orders or a stage today')}${T('At or below reorder point', n0(below), 'replenishment under way or due')}${T('Purchase orders open', n0(sim.pos.filter(p => p.placed <= d && !(p.arrive <= d)).length), inr(sim.pos.filter(p => p.placed <= d && !(p.arrive <= d)).reduce((a, p) => a + p.value, 0)) + ' on order')}</div>
      <div class="card"><div class="card-h"><h3>Stock position</h3><span class="sub">${dateStr(d)}. Sparkline shows the last 30 days; the dashed line is the reorder point.</span></div>
        <div class="tbl"><table><thead><tr><th>Item</th><th class="n">On hand</th><th class="n">Cover</th><th class="n">Reorder point</th><th class="n">On order</th><th>Status</th><th>Last 30 days</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Stock value over time</h3>${legend([['Raw materials', 'var(--c1)'], ['Consumables', 'var(--c3)']])}</div><div class="ch" id="chInv"></div></div></div>`;
    return { html, after() {
      lineChart($('#chInv'), { n, mark: d, xlab: dateShort, xtip: dateStr, onPick: pickDay, stack: true, series: [{ name: 'Raw materials', color: 'var(--c1)', data: ser.invRaw.slice(0, n) }, { name: 'Consumables', color: 'var(--c3)', data: ser.invCons.slice(0, n) }], yfmt: v => '₹' + n0(v / 1e5) + ' L', vfmt: v => inr(v), ml: 62, aria: 'Stock value over time' });
    } };
  }

  function viewProcurement() {
    const d = UI.day, sim = UI.sim;
    const all = sim.pos.filter(p => p.placed <= d);
    const st = p => p.arrive <= d ? (p.arrive > p.eta ? { k: 'late', l: `Received ${p.arrive - p.eta} d late`, c: 'warn' } : { k: 'ok', l: 'Received on time', c: 'good' })
      : (d > p.eta ? { k: 'over', l: 'Overdue', c: 'crit' } : { k: 'open', l: 'In transit', c: 'info' });
    const withSt = all.map(p => ({ p, s: st(p) }));
    const recv = withSt.filter(x => x.p.arrive <= d), onTime = recv.filter(x => x.s.k === 'ok').length;
    const openV = withSt.filter(x => x.p.arrive > d).reduce((a, x) => a + x.p.value, 0);
    const f = UI.poFilter;
    const match = x => f === 'all' || (f === 'open' && x.p.arrive > d) || (f === 'late' && (x.s.k === 'late' || x.s.k === 'over'));
    const shown = withSt.filter(match).reverse();
    const T = (l, v, sub) => `<div class="kpi"><label>${l}</label><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    const rows = shown.slice(0, 80).map(({ p, s }) => `<tr><td class="id">${p.id}</td><td>${esc(sim.items[p.item].name)}</td><td>${esc(p.supplier)}</td><td class="n">${n0(p.qty)} ${sim.items[p.item].unit}</td><td>${dateShort(p.placed)}</td><td>${dateShort(p.eta)}</td><td>${p.arrive <= d ? dateShort(p.arrive) : 'expected ' + dateShort(p.arrive)}</td><td>${pill(s.c, s.l)}</td><td class="n">${inr(p.value)}</td></tr>`).join('');
    const html = `<div class="stack">
      <div class="kpis">${T('Purchase orders raised', n0(all.length), `${inr(all.length * E.PARAMS.poFee)} ordering cost`)}${T('Received', n0(recv.length), inr(recv.reduce((a, x) => a + x.p.value, 0)) + ' of material')}${T('Supplier on-time rate', recv.length ? n0(onTime / recv.length * 100) + '%' : 'n/a', 'received on or before the promised date')}${T('Still on order', inr(openV), n0(withSt.filter(x => x.p.arrive > d).length) + ' purchase orders')}</div>
      <div class="card"><div class="card-h"><h3>Purchase orders</h3><span class="sub">Raised automatically when stock on hand plus on order drops to the reorder point</span></div>
        <div class="chips">${[['all', 'All'], ['open', 'Open'], ['late', 'Late or overdue']].map(([k, l]) => `<button class="chip" data-pofilter="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
        <div class="tbl tall"><table><thead><tr><th>PO</th><th>Item</th><th>Supplier</th><th class="n">Quantity</th><th>Raised</th><th>Promised</th><th>Arrival</th><th>Status</th><th class="n">Value</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">No purchase orders match yet.</td></tr>'}</tbody></table></div>
        ${shown.length > 80 ? `<div class="sub" style="margin-top:8px">Showing the 80 most recent of ${shown.length}.</div>` : ''}
      </div></div>`;
    return { html, after() {} };
  }

  function runCompare() {
    const key = cmpKey();
    if (UI.cmp.key === key && UI.cmp.data) return;
    if (UI.cmp.busy && UI.cmp.pending === key) return;
    UI.cmp.busy = true; UI.cmp.pending = key;
    setTimeout(() => {
      const base = { horizon: UI.cfg.horizon, seed: UI.cfg.seed };
      const reps = 16, rows = E.PRESETS.map(p => ({ name: p.name, r: E.runMany(E.presetCfg(p.id, Object.assign({}, E.DEFAULTS, base)), reps) }));
      const mine = { name: 'Your current settings', r: E.runMany(UI.cfg, reps), mine: true };
      const pts = [0, 2, 4, 6, 8, 10, 12].map(dd => { const r = E.runMany(Object.assign({}, UI.cfg, { safetyDays: dd }), 12); return { days: dd, otif: r.otif, avgInv: r.avgInv }; });
      UI.cmp = { key, data: { rows: rows.concat([mine]), pts, reps }, busy: false };
      if (UI.tab === 'compare') renderView();
    }, 40);
  }
  function viewCompare() {
    runCompare();
    if (!UI.cmp.data || UI.cmp.key !== cmpKey()) {
      return { html: `<div class="card"><div class="loading">Running ${E.PRESETS.length + 1} scenarios with 16 simulated runs each...</div></div>`, after() {} };
    }
    const { rows, pts, reps } = UI.cmp.data;
    const cols = [
      { k: 'otif', l: 'On-time', f: v => v == null ? 'n/a' : n1(v) + '%', hb: true, bar: v => v, rng: r => r.otifP10 == null ? '' : `${n0(r.otifP10)}-${n0(r.otifP90)}%` },
      { k: 'lead', l: 'Avg lead time', f: v => v == null ? 'n/a' : n1(v) + ' d', hb: false },
      { k: 'openM', l: 'Open book at end', f: v => n0(v) + ' m', hb: false },
      { k: 'lateOpen', l: 'Overdue open', f: v => n1(v), hb: false },
      { k: 'stockoutDays', l: 'Short item-days', f: v => n0(v), hb: false },
      { k: 'avgInv', l: 'Avg stock', f: v => inr(v), hb: false },
      { k: 'contribution', l: 'Contribution', f: v => inr(v), hb: true, rng: r => `${inr(r.contributionP10)} to ${inr(r.contributionP90)}` },
      { k: 'turns', l: 'Stock turns / yr', f: v => v == null ? 'n/a' : n1(v), hb: true }
    ];
    const best = {}; cols.forEach(c => { const vals = rows.map(r => r.r[c.k]).filter(v => v != null); best[c.k] = c.hb ? Math.max(...vals) : Math.min(...vals); });
    const tr = rows.map(r => `<tr${r.mine ? ' style="background:var(--accent-soft)"' : ''}><td style="font-weight:${r.mine ? 700 : 550}">${esc(r.name)}</td>${cols.map(c => { const v = r.r[c.k]; const isBest = v != null && v === best[c.k]; return `<td class="n ${isBest ? 'best' : ''}">${c.bar && v != null ? `<span class="mini"><i style="width:${clamp(v, 0, 100)}%"></i></span>` : ''}${c.f(v)}${isBest ? ' ✓' : ''}${c.rng && v != null ? `<div class="rng">${c.rng(r.r)}</div>` : ''}</td>`; }).join('')}</tr>`).join('');
    const html = `<div class="stack">
      <div class="card"><div class="card-h"><h3>Scenario comparison</h3><span class="sub">Average of ${reps} simulated runs of ${UI.cfg.horizon} days each. ✓ marks the best value in a column. Smaller grey figures show the middle 80% of runs (10th to 90th percentile).</span></div>
        <div class="tbl"><table class="cmp"><thead><tr><th>Scenario</th>${cols.map(c => `<th class="n">${c.l}</th>`).join('')}</tr></thead><tbody>${tr}</tbody></table></div>
        <div class="note">Every scenario sees the same customer orders and machine luck, so differences come from the settings. Averages smooth out one-off bad weeks that a single run can show.</div></div>
      <div class="card"><div class="card-h"><h3>How much safety stock is enough?</h3><span class="sub">Uses your current settings</span></div><div class="ch" id="chTrade"></div>
        <div class="note">Each point is a safety stock level in days of cover. Service improves quickly at first, then flattens while the cost of holding stock keeps rising.</div></div></div>`;
    return { html, after() { tradeoff($('#chTrade'), pts, UI.cfg.safetyDays); } };
  }

  /* ---------------- report ---------------- */
  function scenarioName() {
    for (const p of E.PRESETS) {
      const pc = E.presetCfg(p.id, Object.assign({}, E.DEFAULTS, { horizon: UI.cfg.horizon, seed: UI.cfg.seed }));
      pc.cap = Object.assign({}, E.DEFAULTS.cap, pc.cap);
      if (sameSettings(UI.cfg, pc)) return p.name;
    }
    return 'Custom scenario';
  }

  function findings(sim, kp, d) {
    const out = [], P = E.PARAMS;
    if (d < 7) return [{ sev: 'neu', head: 'Too early to judge', text: 'Move the day slider forward (or press play) so that orders have had time to flow through the plant.' }];
    if (kp.otif == null) out.push({ sev: 'neu', head: 'Service', text: 'No orders have fallen due yet.' });
    else out.push({ sev: kp.otif >= 95 ? 'good' : kp.otif >= 90 ? 'warn' : 'crit', head: 'Service level',
      text: `${n1(kp.otif)}% of the ${n0(kp.elig)} orders that fell due were shipped on or before their due date (target 90%). ${n0(kp.lateOpen)} open orders are already overdue and ${n0(kp.lateShip)} shipped late.` });
    if (kp.bottleneck >= 0) {
      const st = E.STAGES[kp.bottleneck], nominal = st.cap * sim.cfg.cap[st.id], q = sim.days[d].wip[kp.bottleneck] / (nominal * 0.93), u = kp.util[kp.bottleneck] * 100;
      out.push({ sev: u > 90 || q > 4 ? 'crit' : u > 80 || q > 2.5 ? 'warn' : 'good', head: 'Bottleneck: ' + st.name,
        text: `${st.name} ran at ${n0(u)}% of nominal capacity and holds ${n0(sim.days[d].wip[kp.bottleneck])} m of queued work (${n1(q)} days of output). ${u > 85 ? 'Any extra demand lands here first.' : 'There is headroom at the moment.'}` });
    }
    const shortDays = E.ITEMS.map(it => { let n = 0; for (let t = 1; t <= d; t++) n += sim.days[t].short[it.idx]; return { it, n }; }).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (shortDays.length) {
      const top = shortDays[0], held = sim.orders.filter(o => o.arrival <= d && o.blocked > 0).length;
      out.push({ sev: top.n > d * 0.2 ? 'crit' : 'warn', head: 'Material shortages',
        text: `${top.it.name} was short on ${n0(top.n)} of ${d} days${shortDays.length > 1 ? ', followed by ' + shortDays.slice(1, 3).map(x => x.it.name + ' (' + x.n + ')').join(' and ') : ''}. ${n0(held)} orders have been held at least one day waiting for material.` });
    } else out.push({ sev: 'good', head: 'Material availability', text: 'No material shortages so far.' });
    const recv = sim.pos.filter(p => p.arrive <= d);
    if (recv.length) {
      const by = {}; recv.forEach(p => { const b = by[p.supplier] || (by[p.supplier] = { n: 0, late: 0, days: 0 }); b.n++; if (p.arrive > p.eta) { b.late++; b.days += p.arrive - p.eta; } });
      const rows = Object.entries(by).map(([k, b]) => ({ k, ...b, rate: 1 - b.late / b.n })).sort((a, b) => a.rate - b.rate);
      const tot = recv.filter(p => p.arrive <= p.eta).length / recv.length * 100;
      out.push({ sev: tot >= 90 ? 'good' : tot >= 75 ? 'warn' : 'crit', head: 'Supplier reliability',
        text: `${n0(tot)}% of ${recv.length} deliveries arrived on or before the promised date. Weakest: ${rows[0].k} (${n0(rows[0].rate * 100)}% on time, ${rows[0].n - rows[0].late} of ${rows[0].n} deliveries${rows[0].late ? ', ' + n1(rows[0].days / rows[0].late) + ' days late on average when late' : ''}).` });
    }
    const margin = kp.revenue ? kp.contribution / kp.revenue * 100 : 0;
    const big = Object.entries(kp.costs).sort((a, b) => b[1] - a[1])[0];
    out.push({ sev: margin > 20 ? 'good' : margin > 10 ? 'warn' : 'crit', head: 'Profitability',
      text: `Contribution of ${inr(kp.contribution)} on ${inr(kp.revenue)} shipped revenue (${n1(margin)}% margin). Late-delivery penalties cost ${inr(kp.penalties)}; the largest cost is ${big[0]} at ${inr(big[1])}.` });
    if (kp.turns != null) out.push({ sev: 'neu', head: 'Working capital', text: `Average stock of ${inr(kp.avgInv)} turns ${n1(kp.turns)} times a year. Carrying it costs about ${inr(kp.avgInv * P.holdRate)} a year at ${n0(P.holdRate * 100)}%.` });
    return out;
  }

  function runLevers() {
    const key = cmpKey();
    if (UI.lev.key === key && UI.lev.data) return;
    if (UI.lev.busy && UI.lev.pending === key) return;
    UI.lev.busy = true; UI.lev.pending = key;
    setTimeout(() => {
      const reps = 12, cur = UI.cfg, kp = E.kpiAt(UI.sim, UI.sim.H), bn = kp.bottleneck >= 0 ? E.STAGES[kp.bottleneck] : E.STAGES[1];
      const withCap = Object.assign({}, cur, { cap: Object.assign({}, cur.cap, { [bn.id]: cur.cap[bn.id] * 1.1 }) });
      const defs = [
        { name: `${bn.name} capacity +10%`, cfg: withCap },
        { name: 'Safety stock +2 days', cfg: Object.assign({}, cur, { safetyDays: cur.safetyDays + 2 }) },
        { name: 'Campaign sequencing', cfg: Object.assign({}, cur, { rule: 'campaign' }), skip: cur.rule === 'campaign' },
        { name: 'Breakdowns halved', cfg: Object.assign({}, cur, { breakdown: cur.breakdown / 2 }) },
        { name: 'Late deliveries halved', cfg: Object.assign({}, cur, { lateProb: cur.lateProb / 2 }) }
      ].filter(x => !x.skip);
      const base = E.runMany(cur, reps);
      const rows = defs.map(x => ({ name: x.name, r: E.runMany(x.cfg, reps) }));
      UI.lev = { key, data: { base, rows, reps }, busy: false };
      if (UI.tab === 'report') renderView();
    }, 40);
  }

  function ordersCsv() {
    const sim = UI.sim, H = sim.H;
    return csv([['Order', 'Customer', 'Product', 'Meters', 'Received', 'Due', 'Released', 'Shipped', 'Status', 'Days late', 'Value INR']].concat(sim.orders.map(o => {
      const st = ordStatus(o, H), late = o.ship !== null ? Math.max(0, o.ship - o.due) : Math.max(0, H - o.due);
      return [o.id, o.customer, prodOf(o.product).name, o.qty, iso(o.arrival), iso(o.due), iso(o.release || 0), iso(o.ship || 0), st.l, late, Math.round(o.value)];
    })));
  }
  function posCsv() {
    const sim = UI.sim;
    return csv([['PO', 'Item', 'Supplier', 'Quantity', 'Unit', 'Raised', 'Promised', 'Arrival', 'Days late', 'Received in run', 'Value INR']].concat(sim.pos.map(p => {
      const it = sim.items[p.item]; return [p.id, it.name, p.supplier, Math.round(p.qty), it.unit, iso(p.placed), iso(p.eta), iso(p.arrive), Math.max(0, p.arrive - p.eta), p.arrive <= sim.H ? 'yes' : 'no', Math.round(p.value)];
    })));
  }
  function dailyCsv() {
    const sim = UI.sim, head = ['Day', 'Date', 'Meters received', 'Meters shipped', 'Orders received', 'Orders shipped', 'Awaiting material (m)', 'Stock value INR'];
    sim.stages.forEach(s => head.push(s.name + ' processed (m)', s.name + ' queue (m)'));
    sim.items.forEach(i => head.push(i.name + ' on hand (' + i.unit + ')'));
    return csv([head].concat(sim.days.slice(1).map((s, k) => {
      const row = [k + 1, iso(k + 1), Math.round(s.arrM), Math.round(s.shipM), s.arrCnt, s.shipCnt, Math.round(s.awaitM), Math.round(s.invValue)];
      sim.stages.forEach((_, i) => row.push(Math.round(s.proc[i]), Math.round(s.wip[i])));
      s.onHand.forEach(q => row.push(Math.round(q * 10) / 10));
      return row;
    })));
  }
  function saveScenario() {
    download('loomline-scenario.json', JSON.stringify({ app: 'loomline', version: 1, savedAt: new Date().toISOString(), settings: UI.cfg, data: E.getData() }, null, 2), 'application/json');
  }
  function loadScenario(text) {
    const o = JSON.parse(text);
    if (!o || o.app !== 'loomline' || !o.settings) throw new Error('This is not a Loomline scenario file');
    if (o.data) E.setData(o.data);
    UI.cfg = sanitizeCfg(o.settings); UI.draft = null;
  }

  function viewReport() {
    runLevers();
    const d = UI.day, sim = UI.sim, kp = E.kpiAt(sim, d), kb = E.kpiAt(UI.base, d), c = kp.costs, rev = kp.revenue || 1;
    const fnd = findings(sim, kp, d);
    const costRow = (l, v, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${l}</td><td class="n">${inr(v)}</td><td class="n">${kp.revenue ? n1(v / rev * 100) + '%' : '-'}</td></tr>`;
    const lev = UI.lev.data && UI.lev.key === cmpKey() ? UI.lev.data : null;
    const dd = (v, b, fmt, hb) => { const x = v - b; if (Math.abs(x) < 1e-9) return '<td class="n">-</td>'; return `<td class="n ${(x > 0) === hb ? 'gd' : 'bd'}">${x > 0 ? '+' : '-'}${fmt(Math.abs(x))}</td>`; };
    const levHtml = lev ? `<div class="tbl"><table class="cmp"><thead><tr><th>Change (one at a time)</th><th class="n">On-time</th><th class="n">Contribution</th><th class="n">Average stock</th></tr></thead><tbody>
        <tr><td><b>Current settings</b></td><td class="n">${n1(lev.base.otif)}%</td><td class="n">${inr(lev.base.contribution)}</td><td class="n">${inr(lev.base.avgInv)}</td></tr>
        ${lev.rows.map(x => `<tr><td>${esc(x.name)}</td>${dd(x.r.otif, lev.base.otif, v => n1(v) + ' pts', true)}${dd(x.r.contribution, lev.base.contribution, inr, true)}${dd(x.r.avgInv, lev.base.avgInv, inr, false)}</tr>`).join('')}</tbody></table></div>
        <div class="note">Average of ${lev.reps} runs per row, same demand and machine luck throughout. On-time differences under about 2 points are within normal run-to-run noise (current settings: standard deviation ${n1(lev.base.otifSd)} pts).</div>`
      : '<div class="loading">Testing improvement levers...</div>';
    const pill2 = f => pill(f.sev, { good: 'On track', warn: 'Watch', crit: 'Act', neu: 'Info' }[f.sev]);
    const set = [['Scenario', scenarioName()], ['Run', `${sim.H} days, seed ${UI.cfg.seed}`], ['Customer demand', Math.round(UI.cfg.demand * 100) + '% of plan'], ['Supplier lead time', Math.round(UI.cfg.supplierLT * 100) + '% of normal, ' + Math.round(UI.cfg.lateProb * 100) + '% late'],
      ['Safety stock', UI.cfg.safetyDays + ' days'], ['Breakdowns', Math.round(UI.cfg.breakdown * 100) + '% per line per day'], ['Capacity', E.STAGES.map(s => s.name + ' ' + Math.round(UI.cfg.cap[s.id] * 100) + '%').join(', ')],
      ['Sequencing', { edd: 'Earliest due date', fifo: 'First in, first out', campaign: 'Campaign by product' }[UI.cfg.rule]], ['Master data', E.dataInfo().custom ? 'Custom (edited)' : 'Demo data']];
    const html = `<div class="stack report">
      <div class="card"><div class="card-h"><h3>Simulation report</h3><span class="sub">${scenarioName()} · ${dateStr(d)} (day ${d} of ${sim.H})</span></div>
        <div class="actions no-print">
          <button class="btn primary" id="rPrint">Print or save as PDF</button>
          <button class="btn" id="rOrders">Orders (CSV)</button><button class="btn" id="rPos">Purchase orders (CSV)</button><button class="btn" id="rDaily">Daily data (CSV)</button>
          <button class="btn" id="rSave">Save scenario</button><button class="btn" id="rLoad">Load scenario</button>
        </div>
        <div class="note no-print">The report describes the plant as of the day selected on the slider. CSV files cover the whole run.</div></div>
      ${kpiTiles(kp, kb)}
      <div class="card"><div class="card-h"><h3>What stands out</h3></div>
        <ul class="finds">${fnd.map(f => `<li><div>${pill2(f)}</div><div><b>${esc(f.head)}</b><p>${esc(f.text)}</p></div></li>`).join('')}</ul></div>
      <div class="grid2">
        <div class="card"><div class="card-h"><h3>Profit and loss to date</h3></div><div class="tbl"><table><thead><tr><th>Item</th><th class="n">Amount</th><th class="n">% of revenue</th></tr></thead><tbody>
          ${costRow('Shipped revenue', kp.revenue)}${costRow('Materials', c.materials)}${costRow('Conversion (labour, energy, overhead)', c.conversion)}${costRow('Consumables', c.consumables)}${costRow('Stock holding', c.holding)}${costRow('Purchase order handling', c.ordering)}${costRow('Late-delivery penalties', c.penalties)}${costRow('Contribution', kp.contribution, 'tot')}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h3>Settings used</h3></div><div class="tbl"><table class="wrapc"><tbody>${set.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Where to improve</h3><span class="sub">Each change tested on its own against your current settings</span></div>${levHtml}</div>
      <div class="card"><details><summary>How the model works, and what it leaves out</summary>
        <div class="doc"><h4>Mechanics</h4><ul>
          <li><b>Orders</b> arrive randomly (Poisson) at ${n1(E.PARAMS.lambda)} per working day at 100% demand, Monday to Saturday. Product mix, size, customer and due date are drawn per order.</li>
          <li><b>Release.</b> An order is released only when every raw material in its bill of materials is in stock, then the materials are issued. Waiting orders are served in due-date order.</li>
          <li><b>Production.</b> Weaving, dyeing, finishing and packing each process up to their daily capacity, scaled by a daily efficiency draw (about 94%). An order finishes a stage and enters the next one the following day. Sunday is a weekly off.</li>
          <li><b>Breakdowns.</b> Each line can break down on any working day; output then drops to 40% for one to three days.</li>
          <li><b>Changeovers.</b> Switching product on a line costs the changeover capacity set for that stage. The sequencing rule decides the next order: earliest due date, first in first out, or campaign (same product first unless something is urgent).</li>
          <li><b>Consumables</b> (lubricant, caustic, salt, softener, film) are used per 100 m processed. A stage slows down or stops when one runs out.</li>
          <li><b>Replenishment.</b> Every material and consumable has a reorder point (lead time plus safety days of use) and an order-up-to level, ordered in lot sizes. Supplier lead time varies randomly and a share of deliveries run 2 to 6 days late. Nothing is delivered on Sundays.</li>
          <li><b>Money.</b> Revenue is booked on shipment. Contribution = revenue - materials - conversion cost - consumables - stock holding - purchase order fees - late penalties (${n0(E.PARAMS.latePenaltyPerDay * 100)}% of order value per day late, capped at ${n0(E.PARAMS.latePenaltyCap * 100)}%).</li>
          <li><b>Fair comparison.</b> All randomness is keyed to the seed, day and item, so two scenarios with the same seed face identical customer orders and machine luck.</li></ul>
        <h4>Not modelled yet</h4><ul>
          <li>Labour, shifts and overtime; one line per stage, no parallel machines or per-machine routing.</li>
          <li>Yield loss, scrap, rework and quality holds; every meter started is shipped.</li>
          <li>Split or partial shipments, order cancellations, expediting and price changes.</li>
          <li>Seasonality or trends in demand; demand is stationary at the chosen level.</li>
          <li>Multi-supplier sourcing, quantity discounts and currency effects.</li></ul>
        <p>Figures are only as good as the master data behind them. Use the Model data tab to replace the demo numbers with your own and compare the result against what your plant actually achieves before relying on it.</p></div></details></div>
    </div>`;
    return { html, after() {} };
  }

  /* ---------------- model data editor ---------------- */
  function viewData() {
    if (!UI.draft) UI.draft = E.getData();
    const D = UI.draft, raw = E.ITEMS.filter(i => i.kind === 'raw');
    const cell = (path, val, o = {}) => `<input class="num ci${o.text ? ' txt' : ''}" type="${o.text ? 'text' : 'number'}" data-path="${path}"${o.scale ? ` data-scale="${o.scale}"` : ''}${o.text ? ' data-text="1"' : ''} value="${esc(o.text ? val : (val === '' || val == null || Number.isNaN(val) ? '' : +(val * (o.scale || 1)).toFixed(4)))}" step="any" aria-label="${esc(o.label)}">`;
    const P = D.params;
    const stages = D.stages.map((s, i) => `<tr><td>${esc(s.name)}</td><td>${cell(`stages.${i}.cap`, s.cap, { label: s.name + ' capacity' })}</td><td>${cell(`stages.${i}.changeover`, s.changeover, { label: s.name + ' changeover' })}</td><td>${cell(`stages.${i}.conv`, s.conv, { label: s.name + ' conversion cost' })}</td></tr>`).join('');
    const prods = D.products.map((p, i) => `<tr><td>${esc(p.name)}</td><td>${cell(`products.${i}.price`, p.price, { label: p.name + ' price' })}</td><td>${cell(`products.${i}.share`, p.share, { scale: 100, label: p.name + ' share' })}</td><td>${cell(`products.${i}.size.0`, p.size[0], { label: p.name + ' min order' })}</td><td>${cell(`products.${i}.size.1`, p.size[1], { label: p.name + ' max order' })}</td><td>${cell(`products.${i}.lead`, p.lead, { label: p.name + ' promised lead time' })}</td></tr>`).join('');
    const bom = D.products.map((p, i) => `<tr><td>${esc(p.name)}</td>${raw.map(it => `<td>${cell(`products.${i}.bom.${it.id}`, p.bom[it.id] || 0, { label: p.name + ' ' + it.name })}</td>`).join('')}</tr>`).join('');
    const items = D.items.map((it, i) => `<tr><td>${esc(it.name)}<div class="sub">${it.kind === 'raw' ? 'raw material' : 'consumable'}</div></td><td>${esc(it.unit)}</td><td>${cell(`items.${i}.cost`, it.cost, { label: it.name + ' cost' })}</td><td>${cell(`items.${i}.lot`, it.lot, { label: it.name + ' lot size' })}</td><td>${cell(`items.${i}.lt.0`, it.lt[0], { label: it.name + ' lead time' })}</td><td>${cell(`items.${i}.lt.1`, it.lt[1], { label: it.name + ' lead time spread' })}</td><td>${cell(`items.${i}.cover`, it.cover, { label: it.name + ' cover days' })}</td><td>${it.kind === 'cons' ? cell(`items.${i}.rate`, it.rate, { label: it.name + ' use per 100 m' }) : '<span class="sub">via BOM</span>'}</td><td>${cell(`items.${i}.supplier`, it.supplier, { text: 1, label: it.name + ' supplier' })}</td></tr>`).join('');
    const shareSum = D.products.reduce((a, p) => a + (+p.share || 0), 0) * 100;
    const html = `<div class="stack data">
      <div class="card"><div class="card-h"><h3>Model data</h3><span class="sub">${E.dataInfo().custom ? 'Custom data in use' : 'Demo data in use'}</span></div>
        <p class="lead">Replace the demo numbers with your plant's figures. Changes take effect when you press Apply. The structure (four stages, four products, twelve materials) stays fixed; the numbers, names, supplier names, bill of materials and customers can all change.</p>
        ${UI.dataError ? `<div class="err" role="alert">${esc(UI.dataError)}</div>` : ''}
        <div class="actions"><button class="btn primary" id="dApply">Apply changes</button><button class="btn" id="dDiscard">Discard edits</button><button class="btn" id="dReset">Back to demo data</button><button class="btn" id="dExport">Export data (JSON)</button><button class="btn" id="dImport">Import data (JSON)</button></div></div>
      <div class="card"><div class="card-h"><h3>Orders and costs</h3></div><div class="tbl"><table><tbody>
        <tr><td>Orders per working day at 100% demand</td><td>${cell('params.lambda', P.lambda, { label: 'Orders per day' })}</td></tr>
        <tr><td>Stock holding cost (% of value per year)</td><td>${cell('params.holdRate', P.holdRate, { scale: 100, label: 'Holding rate percent' })}</td></tr>
        <tr><td>Cost per purchase order (INR)</td><td>${cell('params.poFee', P.poFee, { label: 'Purchase order fee' })}</td></tr>
        <tr><td>Late penalty (% of order value per day late)</td><td>${cell('params.latePenaltyPerDay', P.latePenaltyPerDay, { scale: 100, label: 'Late penalty percent per day' })}</td></tr>
        <tr><td>Late penalty cap (% of order value)</td><td>${cell('params.latePenaltyCap', P.latePenaltyCap, { scale: 100, label: 'Late penalty cap percent' })}</td></tr></tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Production stages</h3></div><div class="tbl"><table><thead><tr><th>Stage</th><th>Capacity (m/day)</th><th>Changeover (m lost)</th><th>Conversion cost (INR/m)</th></tr></thead><tbody>${stages}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Products</h3><span class="sub">Mix must add up to 100%: now <b id="shareSum">${n0(shareSum)}</b>%</span></div><div class="tbl"><table><thead><tr><th>Product</th><th>Price (INR/m)</th><th>Order mix (%)</th><th>Min order (m)</th><th>Max order (m)</th><th>Lead time (days)</th></tr></thead><tbody>${prods}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Bill of materials</h3><span class="sub">Quantity of each raw material per 100 m of fabric (leave 0 if not used)</span></div><div class="tbl"><table><thead><tr><th>Product</th>${raw.map(it => `<th>${esc(it.name)} (${it.unit})</th>`).join('')}</tr></thead><tbody>${bom}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Materials and consumables</h3></div><div class="tbl"><table><thead><tr><th>Item</th><th>Unit</th><th>Cost (INR/unit)</th><th>Order lot</th><th>Lead time (days)</th><th>Lead time spread</th><th>Cover on order (days)</th><th>Use per 100 m</th><th>Supplier</th></tr></thead><tbody>${items}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Customers</h3><span class="sub">One per line</span></div><textarea class="num" id="dCust" data-path="customers" data-lines="1" rows="6" aria-label="Customers, one per line">${esc(D.customers.join('\n'))}</textarea></div>
    </div>`;
    return { html, after() {} };
  }

  const VIEWS = { overview: ['Overview', viewOverview], orders: ['Orders', viewOrders], production: ['Production', viewProduction], inventory: ['Inventory', viewInventory], procurement: ['Procurement', viewProcurement], compare: ['Compare scenarios', viewCompare], report: ['Report', viewReport], data: ['Model data', viewData] };

  function renderView() {
    const host = $('#view');
    const keep = host.scrollTop;
    const v = VIEWS[UI.tab][1]();
    const tblScroll = {}; host.querySelectorAll('.tbl.tall').forEach((el, i) => tblScroll[i] = el.scrollTop);
    host.innerHTML = v.html; v.after();
    host.querySelectorAll('.tbl.tall').forEach((el, i) => { if (tblScroll[i]) el.scrollTop = tblScroll[i]; });
  }
  function renderTabs() {
    $('#tabs').innerHTML = Object.keys(VIEWS).map(k => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${UI.tab === k}">${VIEWS[k][0]}</button>`).join('');
  }
  function renderScrub() {
    const r = $('#dayRange'); r.max = UI.sim.H; r.value = UI.day;
    $('#dayDate').textContent = dateStr(UI.day);
    $('#dayN').textContent = UI.day < 1 ? `Day 0 of ${UI.sim.H}` : `Day ${UI.day} of ${UI.sim.H}`;
    $('#playIcon').innerHTML = UI.playing ? '<path d="M2.5 1.5h3v11h-3zM8.5 1.5h3v11h-3z"/>' : '<path d="M3 1.5v11l9-5.5z"/>';
    $('#play').setAttribute('aria-label', UI.playing ? 'Pause simulation' : 'Play simulation');
  }
  function stopPlay() { UI.playing = false; clearInterval(UI.timer); UI.timer = null; renderScrub(); }
  function startPlay() {
    if (UI.day >= UI.sim.H) UI.day = 0;
    UI.playing = true; renderScrub();
    UI.timer = setInterval(() => { if (UI.day >= UI.sim.H) { stopPlay(); return; } setDay(UI.day + 1); }, 170);
  }

  /* ---------------- settings panel ---------------- */
  const SL = [
    { g: 'Run', k: 'horizon', l: 'Run length', min: 30, max: 180, step: 10, get: c => c.horizon, set: (c, v) => c.horizon = v, f: v => v + ' days' },
    { g: 'Market and suppliers', k: 'demand', l: 'Customer demand', min: 60, max: 160, step: 5, get: c => Math.round(c.demand * 100), set: (c, v) => c.demand = v / 100, f: v => v + '% of plan' },
    { k: 'supplierLT', l: 'Supplier lead time', min: 50, max: 250, step: 10, get: c => Math.round(c.supplierLT * 100), set: (c, v) => c.supplierLT = v / 100, f: v => v + '% of normal' },
    { k: 'lateProb', l: 'Deliveries that arrive late', min: 0, max: 40, step: 1, get: c => Math.round(c.lateProb * 100), set: (c, v) => c.lateProb = v / 100, f: v => v + '%' },
    { g: 'Inventory policy', k: 'safetyDays', l: 'Safety stock', min: 0, max: 12, step: 1, get: c => c.safetyDays, set: (c, v) => c.safetyDays = v, f: v => v + ' days of cover' },
    { g: 'Plant', k: 'breakdown', l: 'Machine breakdowns', min: 0, max: 15, step: 1, get: c => Math.round(c.breakdown * 100), set: (c, v) => c.breakdown = v / 100, f: v => v + '% per line per day' },
    { g: 'Capacity', k: 'cap_weave', l: 'Weaving', min: 60, max: 150, step: 5, get: c => Math.round(c.cap.weave * 100), set: (c, v) => c.cap.weave = v / 100, f: v => v + '%' },
    { k: 'cap_dye', l: 'Dyeing', min: 60, max: 150, step: 5, get: c => Math.round(c.cap.dye * 100), set: (c, v) => c.cap.dye = v / 100, f: v => v + '%' },
    { k: 'cap_finish', l: 'Finishing', min: 60, max: 150, step: 5, get: c => Math.round(c.cap.finish * 100), set: (c, v) => c.cap.finish = v / 100, f: v => v + '%' },
    { k: 'cap_pack', l: 'Packing', min: 60, max: 150, step: 5, get: c => Math.round(c.cap.pack * 100), set: (c, v) => c.cap.pack = v / 100, f: v => v + '%' }
  ];
  function buildPanel() {
    let h = `<h2>Scenarios</h2><div class="presets">${E.PRESETS.map(p => `<button class="preset" data-preset="${p.id}" aria-pressed="false"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`).join('')}</div>`;
    SL.forEach(s => {
      if (s.g) h += `<h2>${s.g}</h2>`;
      h += `<div class="ctl"><div class="ctl-h"><label for="sl_${s.k}">${s.l}</label><output id="o_${s.k}"></output></div><input type="range" id="sl_${s.k}" data-sl="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}"></div>`;
    });
    h += `<h2>Production sequencing</h2><select class="sel" id="rule" aria-label="Production sequencing rule"><option value="edd">Earliest due date first</option><option value="fifo">First in, first out</option><option value="campaign">Campaign by product (fewer changeovers)</option></select>
      <h2>Randomness</h2><div class="row2"><input class="num" id="seed" type="number" min="1" max="9999" aria-label="Random seed"><button class="btn" id="reseed">New draw</button></div>
      <div class="note">Same seed, same customer orders and breakdowns, so you can compare settings fairly.</div>
      <h2>All settings</h2><button class="btn" id="reset" style="width:100%;justify-content:center">Reset to baseline</button>`;
    $('#panel').innerHTML = h;
    syncPanel();
  }
  function syncPanel() {
    SL.forEach(s => { const el = $('#sl_' + s.k), v = s.get(UI.cfg); el.value = v; $('#o_' + s.k).textContent = s.f(v); });
    $('#rule').value = UI.cfg.rule; $('#seed').value = UI.cfg.seed;
    document.querySelectorAll('.preset').forEach(b => {
      const pc = E.presetCfg(b.dataset.preset, Object.assign({}, E.DEFAULTS, { horizon: UI.cfg.horizon, seed: UI.cfg.seed }));
      pc.cap = Object.assign({}, E.DEFAULTS.cap, pc.cap);
      b.setAttribute('aria-pressed', String(sameSettings(UI.cfg, pc)));
    });
  }
  let pending = false;
  function changed() {
    syncPanel();
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); renderScrub(); renderView(); persist(); });
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('button,[data-tab]'); if (!t) return;
    if (t.dataset.tab) { UI.tab = t.dataset.tab; renderTabs(); renderView(); return; }
    if (t.dataset.preset) { const c = E.presetCfg(t.dataset.preset, Object.assign({}, E.DEFAULTS, { horizon: UI.cfg.horizon, seed: UI.cfg.seed })); c.cap = Object.assign({}, E.DEFAULTS.cap, c.cap); UI.cfg = c; changed(); return; }
    if (t.dataset.ofilter) { UI.oFilter = t.dataset.ofilter; renderView(); return; }
    if (t.dataset.pofilter) { UI.poFilter = t.dataset.pofilter; renderView(); return; }
    if (t.id === 'play') { UI.playing ? stopPlay() : startPlay(); return; }
    if (t.id === 'reseed') { UI.cfg.seed = 1 + Math.floor(Math.random() * 9999); changed(); return; }
    if (t.id === 'reset') { UI.cfg = Object.assign({}, E.DEFAULTS, { seed: UI.cfg.seed, horizon: UI.cfg.horizon }); UI.cfg.cap = Object.assign({}, E.DEFAULTS.cap); changed(); return; }
    if (t.id === 'rPrint') { window.print(); return; }
    if (t.id === 'rOrders') { download('loomline-orders.csv', ordersCsv(), 'text/csv'); return; }
    if (t.id === 'rPos') { download('loomline-purchase-orders.csv', posCsv(), 'text/csv'); return; }
    if (t.id === 'rDaily') { download('loomline-daily.csv', dailyCsv(), 'text/csv'); return; }
    if (t.id === 'rSave') { saveScenario(); return; }
    if (t.id === 'rLoad') { $('#fileScenario').click(); return; }
    if (t.id === 'dImport') { $('#fileData').click(); return; }
    if (t.id === 'dExport') { download('loomline-data.json', JSON.stringify({ app: 'loomline', kind: 'data', data: UI.draft || E.getData() }, null, 2), 'application/json'); return; }
    if (t.id === 'dDiscard') { UI.draft = null; UI.dataError = ''; renderView(); return; }
    if (t.id === 'dReset') { E.resetData(); UI.draft = null; UI.dataError = ''; afterDataChange('Demo data restored'); return; }
    if (t.id === 'dApply') {
      try { E.setData(UI.draft); UI.draft = null; UI.dataError = ''; afterDataChange('Data applied'); }
      catch (err) { UI.dataError = err.message; renderView(); toast(err.message, true); }
      return;
    }
    if (t.id === 'btnSettings') { const p = $('#panel'); const o = p.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); return; }
  });
  function afterDataChange(msg) {
    stopPlay(); recompute(); renderChip(); renderScrub(); renderView(); persist(); if (msg) toast(msg);
  }
  function setDraft(t) {
    const parts = t.dataset.path.split('.'); let o = UI.draft;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    const k = parts[parts.length - 1];
    if (t.dataset.lines) o[k] = t.value.split('\n').map(x => x.trim()).filter(Boolean);
    else if (t.dataset.text) o[k] = t.value;
    else { const v = t.value === '' ? NaN : parseFloat(t.value); o[k] = v / (+t.dataset.scale || 1); }
    const ss = $('#shareSum'); if (ss) ss.textContent = n0(UI.draft.products.reduce((a, p) => a + (+p.share || 0), 0) * 100);
  }
  function readFile(file, fn) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { try { fn(String(r.result)); } catch (err) { toast('Could not load file: ' + err.message, true); } };
    r.onerror = () => toast('Could not read the file', true);
    r.readAsText(file);
  }
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.path) { setDraft(t); return; }
    if (t.id === 'dayRange') { const v = +t.value; stopPlay(); setDay(v); return; }
    if (t.dataset && t.dataset.sl) { SL.find(s => s.k === t.dataset.sl).set(UI.cfg, +t.value); changed(); return; }
    if (t.id === 'seed') { const v = parseInt(t.value, 10); if (v >= 1) { UI.cfg.seed = v; changed(); } return; }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'rule') { UI.cfg.rule = e.target.value; changed(); }
    if (e.target.id === 'oProd') { UI.oProd = e.target.value; renderView(); }
    if (e.target.id === 'fileScenario') { readFile(e.target.files[0], txt => { loadScenario(txt); e.target.value = ''; syncPanel(); afterDataChange('Scenario loaded'); changed(); }); e.target.value = ''; }
    if (e.target.id === 'fileData') {
      readFile(e.target.files[0], txt => { const o = JSON.parse(txt); E.setData(o.data || o); UI.draft = null; UI.dataError = ''; afterDataChange('Data imported'); });
      e.target.value = '';
    }
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderView, 120); });

  /* ---------------- boot ---------------- */
  restore(); recompute(); buildPanel(); renderTabs(); renderChip(); renderScrub(); renderView();
  window.__loomline = { UI, E };
})();
