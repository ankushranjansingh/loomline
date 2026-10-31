/* Loomline simulation engine: daily-step model of a textile factory.
   Orders -> material release (BOM) -> Weaving -> Dyeing -> Finishing -> Packing -> Shipped.
   Raw materials and consumables follow (s,S) replenishment with supplier lead-time variability.
   All randomness is hash-keyed by (seed, stream, day, index) so scenarios share the same demand
   and machine luck (common random numbers) and differences come only from the settings changed. */
(function (root) {
  'use strict';

  /* ---------- Master data (dummy) ---------- */
  const STAGES = [
    { id: 'weave',  name: 'Weaving',   cap: 10800, changeover: 220, conv: 9 },
    { id: 'dye',    name: 'Dyeing',    cap: 10200, changeover: 350, conv: 15 },
    { id: 'finish', name: 'Finishing', cap: 11800, changeover: 120, conv: 6 },
    { id: 'pack',   name: 'Packing',   cap: 12500, changeover: 0,   conv: 2 }
  ];

  const PRODUCTS = [
    { id: 'poplin', name: 'Poplin 40s',        short: 'Poplin',      price: 168, share: 0.30, size: [1500, 5000], lead: 12, bom: { y40: 16.5, starch: 0.8, reac: 0.55 } },
    { id: 'denim',  name: 'Denim 10 oz',       short: 'Denim',       price: 292, share: 0.30, size: [2000, 7000], lead: 15, bom: { y10: 52, starch: 2.5, indigo: 1.6 } },
    { id: 'twill',  name: 'Twill Workwear',    short: 'Twill',       price: 214, share: 0.22, size: [1500, 5500], lead: 13, bom: { y20: 37, starch: 1.8, reac: 1.0 } },
    { id: 'pc',     name: 'Poly-Cotton Blend', short: 'Poly-cotton', price: 142, share: 0.18, size: [1500, 4500], lead: 12, bom: { ypc: 22.5, starch: 1.1, reac: 0.7 } }
  ];

  // kind raw: consumed per 100 m through BOM. kind cons: consumed per 100 m processed at a stage.
  const ITEMS = [
    { id: 'y40',     name: 'Cotton Yarn 40s',      kind: 'raw',  unit: 'kg', cost: 335, lot: 2500,  lt: [6, 1.5],  cover: 9,  supplier: 'Kaveri Yarn Mills' },
    { id: 'y10',     name: 'Cotton Yarn 10s',      kind: 'raw',  unit: 'kg', cost: 248, lot: 6000,  lt: [7, 2],    cover: 9,  supplier: 'Kaveri Yarn Mills' },
    { id: 'y20',     name: 'Cotton Yarn 20s',      kind: 'raw',  unit: 'kg', cost: 272, lot: 4000,  lt: [6, 1.5],  cover: 9,  supplier: 'Aarav Cotton Traders' },
    { id: 'ypc',     name: 'Poly-Cotton Yarn 30s', kind: 'raw',  unit: 'kg', cost: 236, lot: 2500,  lt: [8, 2],    cover: 9,  supplier: 'Aarav Cotton Traders' },
    { id: 'reac',    name: 'Reactive Dye',         kind: 'raw',  unit: 'kg', cost: 640, lot: 300,   lt: [10, 2.5], cover: 14, supplier: 'Coastal Dyes & Intermediates' },
    { id: 'indigo',  name: 'Indigo Dye',           kind: 'raw',  unit: 'kg', cost: 880, lot: 400,   lt: [12, 3],   cover: 14, supplier: 'Coastal Dyes & Intermediates' },
    { id: 'starch',  name: 'Sizing Starch',        kind: 'raw',  unit: 'kg', cost: 52,  lot: 1000,  lt: [5, 1],    cover: 12, supplier: 'ChemSource Pvt Ltd' },
    { id: 'lube',    name: 'Loom Lubricant',       kind: 'cons', unit: 'L',  cost: 215, lot: 200,   lt: [4, 1],    cover: 15, supplier: 'LubeTech Industrial', stage: 0, rate: 0.35 },
    { id: 'caustic', name: 'Caustic Soda',         kind: 'cons', unit: 'kg', cost: 38,  lot: 4000,  lt: [4, 1],    cover: 10, supplier: 'ChemSource Pvt Ltd',  stage: 1, rate: 6.0 },
    { id: 'salt',    name: 'Dyeing Salt',          kind: 'cons', unit: 'kg', cost: 14,  lot: 10000, lt: [5, 1.5],  cover: 10, supplier: 'ChemSource Pvt Ltd',  stage: 1, rate: 14 },
    { id: 'soft',    name: 'Finishing Softener',   kind: 'cons', unit: 'L',  cost: 118, lot: 1500,  lt: [6, 1.5],  cover: 12, supplier: 'FinishChem Co',       stage: 2, rate: 3.2 },
    { id: 'film',    name: 'Packing Film',         kind: 'cons', unit: 'kg', cost: 165, lot: 400,   lt: [5, 1],    cover: 12, supplier: 'PackWell Industries', stage: 3, rate: 0.9 }
  ];
  const IDX = {};
  ITEMS.forEach((it, i) => { it.idx = i; IDX[it.id] = i; });

  const CUSTOMERS = ['Northwind Apparel', 'Bluebell Garments', 'Crestline Uniforms', 'Meridian Fashions', 'Harbor & Pine', 'Sundial Textiles', 'Orchid Export House', 'Vantage Workwear', 'Juniper Denim Co.', 'Lakeshore Home Fabrics'];

  // Global parameters (editable through setData)
  const PARAMS = {
    lambda: 2.1,       // orders per working day at demand 1.0
    holdRate: 0.20,    // yearly carrying cost on inventory value
    poFee: 2500,       // cost per purchase order
    latePenaltyPerDay: 0.01, // share of order value per day late
    latePenaltyCap: 0.15     // maximum penalty share
  };
  const START_DATE = Date.UTC(2026, 10, 2); // Mon 2 Nov 2026 = day 1

  const DEFAULTS = {
    horizon: 90, seed: 7, demand: 1, supplierLT: 1, lateProb: 0.08, safetyDays: 4,
    cap: { weave: 1, dye: 1, finish: 1, pack: 1 }, breakdown: 0.04, rule: 'edd'
  };

  const PRESETS = [
    { id: 'base',   name: 'Baseline',                 desc: 'Normal demand, reliable suppliers.', cfg: {} },
    { id: 'surge',  name: 'Demand surge +25%',        desc: 'Orders arrive 25% faster than planned.', cfg: { demand: 1.25 } },
    { id: 'fix',    name: 'Surge + Dyeing +20%',      desc: 'Same surge, with a dyeing capacity expansion.', cfg: { demand: 1.25, cap: { dye: 1.2 } } },
    { id: 'supply', name: 'Supplier delays',          desc: 'Lead times 50% longer and 20% of deliveries run late.', cfg: { supplierLT: 1.5, lateProb: 0.2 } },
    { id: 'break',  name: 'Machine breakdowns',       desc: 'Breakdowns three times as frequent on every stage.', cfg: { breakdown: 0.12 } },
    { id: 'lean',   name: 'Lean stock',               desc: 'Safety stock cut to one day of cover.', cfg: { safetyDays: 1 } }
  ];

  /* ---------- Random numbers (hash keyed) ---------- */
  function R(seed, k1, k2, k3) {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ k1, 0x85ebca6b); h ^= h >>> 13;
    h = Math.imul(h ^ k2, 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ k3, 0x27d4eb2f); h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function normal(seed, k1, k2, k3) {
    const u1 = Math.max(1e-9, R(seed, k1, k2, k3)), u2 = R(seed, k1 + 500, k2, k3);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function poisson(lambda, u) {
    if (lambda > 30) { // normal approximation keeps exp(-lambda) from underflowing for large demand
      const z = Math.sqrt(2) * erfInv(2 * clamp(u, 1e-9, 1 - 1e-9) - 1);
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
    }
    let k = 0, p = Math.exp(-lambda), c = p;
    while (u > c && k < 200) { k++; p *= lambda / k; c += p; }
    return k;
  }
  function erfInv(x) { // Giles-style approximation, accurate to ~1e-3 which is plenty for demand counts
    const a = 0.147, ln = Math.log(1 - x * x), t = 2 / (Math.PI * a) + ln / 2;
    return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---------- Planning parameters ---------- */
  function mergeCfg(u) {
    const c = Object.assign({}, DEFAULTS, u || {});
    c.cap = Object.assign({}, DEFAULTS.cap, (u && u.cap) || {});
    c.horizon = clamp(Math.round(c.horizon), 14, 365);
    return c;
  }

  function makePlan(cfg) {
    const avgSize = PRODUCTS.reduce((a, p) => a + p.share * (p.size[0] + p.size[1]) / 2, 0);
    const mPerCal = PARAMS.lambda * avgSize * 6 / 7;
    return ITEMS.map(it => {
      const use = it.kind === 'raw'
        ? PRODUCTS.reduce((a, p) => a + p.share * mPerCal * (p.bom[it.id] || 0) / 100, 0)
        : mPerCal * it.rate / 100;
      const rop = use * (it.lt[0] + cfg.safetyDays);
      const S = rop + use * it.cover;
      return { use, rop, S, init: rop + use * it.cover * 0.5 };
    });
  }

  function dateOf(day) { return new Date(START_DATE + (day - 1) * 86400000); }
  const isSunday = day => ((day - 1) % 7 + 7) % 7 === 6;

  /* ---------- Simulation ---------- */
  function simulate(userCfg) {
    const cfg = mergeCfg(userCfg), H = cfg.horizon, seed = cfg.seed | 0;
    const plan = makePlan(cfg), nI = ITEMS.length, nS = STAGES.length;
    const onHand = plan.map(p => p.init), onOrder = new Array(nI).fill(0);
    const orders = [], pos = [], events = [], days = [];
    const stg = STAGES.map(() => ({ last: null, down: 0 }));
    const cum = { rev: 0, cogs: 0, mat: 0, conv: 0, cons: 0, hold: 0, ord: 0, pen: 0 };
    let prevShort = new Array(nI).fill(0);
    let soSeq = 10240, poSeq = 4400;
    const invValue = () => onHand.reduce((a, q, i) => a + q * ITEMS[i].cost, 0);
    const ev = (day, sev, type, text) => events.push({ day, sev, type, text });

    function snapshot(t, x) {
      const wip = new Array(nS).fill(0); let awaitM = 0, bookProdM = 0;
      for (const o of orders) {
        if (o.ship !== null) continue;
        if (o.stage === -1) awaitM += o.qty; else { wip[o.stage] += o.rem; bookProdM += o.qty; }
      }
      return Object.assign({
        t, onHand: onHand.slice(), onOrder: onOrder.slice(), invValue: invValue(), wip, awaitM, bookProdM,
        cum: Object.assign({}, cum),
        proc: new Array(nS).fill(0), avail: new Array(nS).fill(0), lost: new Array(nS).fill(0),
        down: new Array(nS).fill(0), starve: new Array(nS).fill(0), short: new Array(nI).fill(0),
        used: new Array(nI).fill(0), arrCnt: 0, arrM: 0, shipCnt: 0, shipM: 0, sunday: t > 0 && isSunday(t)
      }, x || {});
    }
    days.push(snapshot(0));

    function pick(cands, rule, last, t) {
      const byDue = (a, b) => a.due - b.due || a.n - b.n;
      if (rule === 'fifo') return cands.slice().sort((a, b) => a.arrival - b.arrival || a.n - b.n)[0];
      const sorted = cands.slice().sort(byDue);
      if (rule === 'campaign' && last !== null) {
        const urgent = sorted.filter(o => o.due - t <= 2);
        if (urgent.length) return urgent[0];
        const same = sorted.filter(o => o.product === last);
        if (same.length) return same[0];
      }
      return sorted[0];
    }

    for (let t = 1; t <= H; t++) {
      const sunday = isSunday(t);
      const short = new Array(nI).fill(0), used = new Array(nI).fill(0);
      const proc = new Array(nS).fill(0), avail = new Array(nS).fill(0), lost = new Array(nS).fill(0);
      const down = new Array(nS).fill(0), starve = new Array(nS).fill(0);
      let arrCnt = 0, arrM = 0, shipCnt = 0, shipM = 0;

      // 1. deliveries
      for (const po of pos) {
        if (!po.received && po.arrive === t) {
          po.received = true; onHand[po.item] += po.qty; onOrder[po.item] -= po.qty;
          if (po.arrive > po.eta) ev(t, 'warn', 'delay', `${ITEMS[po.item].name} delivery ${po.arrive - po.eta} day${po.arrive - po.eta > 1 ? 's' : ''} late (${po.id}, ${po.supplier})`);
        }
      }

      // 2. new orders
      if (!sunday) {
        const n = poisson(PARAMS.lambda * cfg.demand, R(seed, 11, t, 0));
        for (let k = 0; k < n; k++) {
          let u = R(seed, 12, t, k), acc = 0, p = PRODUCTS[PRODUCTS.length - 1];
          for (const pr of PRODUCTS) { acc += pr.share; if (u <= acc) { p = pr; break; } }
          const qty = Math.round((p.size[0] + R(seed, 13, t, k) * (p.size[1] - p.size[0])) / 100) * 100;
          const cust = CUSTOMERS[Math.floor(R(seed, 14, t, k) * CUSTOMERS.length)];
          const due = t + p.lead + Math.floor(R(seed, 15, t, k) * 7) - 2;
          const o = {
            n: ++soSeq, id: 'SO-' + soSeq, customer: cust, product: p.id, qty, arrival: t, due,
            release: null, start: [null, null, null, null], done: [null, null, null, null], ship: null,
            stage: -1, rem: 0, ready: 0, rawCost: 0, value: qty * p.price, blocked: 0
          };
          orders.push(o); arrCnt++; arrM += qty;
        }
      }

      // 3. release orders when every raw material is available
      const waiting = orders.filter(o => o.stage === -1).sort((a, b) => a.due - b.due || a.n - b.n);
      const blockedCount = new Array(nI).fill(0);
      for (const o of waiting) {
        const p = PRODUCTS.find(x => x.id === o.product);
        const need = {}; let ok = true;
        for (const id in p.bom) {
          need[id] = p.bom[id] * o.qty / 100;
          if (onHand[IDX[id]] + 1e-9 < need[id]) { ok = false; blockedCount[IDX[id]]++; short[IDX[id]] = 1; }
        }
        if (ok) {
          for (const id in need) { onHand[IDX[id]] -= need[id]; used[IDX[id]] += need[id]; o.rawCost += need[id] * ITEMS[IDX[id]].cost; }
          o.release = t; o.stage = 0; o.rem = o.qty; o.ready = t;
        } else o.blocked++;
      }
      for (let i = 0; i < nI; i++) {
        if (short[i] && !prevShort[i] && blockedCount[i] > 0) ev(t, 'crit', 'stockout', `${ITEMS[i].name} short: ${blockedCount[i]} order${blockedCount[i] > 1 ? 's' : ''} on hold for material`);
      }

      // 4. production, stage by stage
      for (let s = 0; s < nS; s++) {
        const S = STAGES[s], st = stg[s];
        let cap = 0;
        if (!sunday) {
          let isDown = false;
          if (st.down > 0) { st.down--; isDown = true; }
          else if (R(seed, 21, s, t) < cfg.breakdown) {
            st.down = Math.floor(R(seed, 22, s, t) * 3); isDown = true;
            ev(t, 'warn', 'breakdown', `${S.name} line breakdown, about ${st.down + 1} day${st.down ? 's' : ''} at reduced output`);
          }
          const eff = clamp(0.945 + 0.03 * normal(seed, 23, s, t), 0.85, 1);
          cap = S.cap * cfg.cap[S.id] * eff * (isDown ? 0.4 : 1);
          down[s] = isDown ? 1 : 0; avail[s] = cap;
        }
        const cons = ITEMS.filter(it => it.kind === 'cons' && it.stage === s);
        while (cap > 1) {
          const cands = orders.filter(o => o.stage === s && o.ready <= t && o.rem > 0.5);
          if (!cands.length) break;
          const o = pick(cands, cfg.rule, st.last, t);
          if (st.last !== null && o.product !== st.last) {
            const l = Math.min(S.changeover, cap); cap -= l; lost[s] += l; st.last = o.product;
            if (cap <= 1) break;
          } else if (st.last === null) st.last = o.product;
          let amt = Math.min(o.rem, cap), lim = Infinity, limItem = -1;
          for (const c of cons) { const mx = onHand[c.idx] / (c.rate / 100); if (mx < lim) { lim = mx; limItem = c.idx; } }
          if (lim < amt) { amt = lim; starve[s] = 1; short[limItem] = 1; }
          if (amt < 1) { starve[s] = 1; if (limItem >= 0) short[limItem] = 1; break; }
          for (const c of cons) { const q = amt * c.rate / 100; onHand[c.idx] -= q; used[c.idx] += q; cum.cons += q * c.cost; }
          cap -= amt; proc[s] += amt; o.rem -= amt;
          if (o.start[s] === null) o.start[s] = t;
          if (o.rem <= 0.5) {
            o.done[s] = t;
            if (s < nS - 1) { o.stage = s + 1; o.rem = o.qty; o.ready = t + 1; }
            else {
              o.stage = nS; o.rem = 0; o.ship = t; shipCnt++; shipM += o.qty;
              const conv = STAGES.reduce((a, x) => a + x.conv, 0) * o.qty;
              cum.rev += o.value; cum.cogs += o.rawCost + conv; cum.mat += o.rawCost; cum.conv += conv;
              if (t > o.due) {
                const pen = Math.min(PARAMS.latePenaltyCap, PARAMS.latePenaltyPerDay * (t - o.due)) * o.value; cum.pen += pen;
                ev(t, 'warn', 'late', `${o.id} (${o.customer}) shipped ${t - o.due} day${t - o.due > 1 ? 's' : ''} late`);
              }
            }
          }
        }
      }
      for (let s = 0; s < nS; s++) {
        if (starve[s]) {
          const it = ITEMS.find(x => x.kind === 'cons' && x.stage === s && short[x.idx]);
          if (it && !prevShort[it.idx]) ev(t, 'crit', 'starve', `${STAGES[s].name} slowed: ${it.name} ran out`);
        }
      }

      // 5. costs and replenishment
      cum.hold += invValue() * PARAMS.holdRate / 365;
      for (let i = 0; i < nI; i++) {
        const it = ITEMS[i], p = plan[i];
        if (onHand[i] + onOrder[i] <= p.rop) {
          const qty = Math.max(1, Math.ceil((p.S - onHand[i] - onOrder[i]) / it.lot)) * it.lot;
          const lt = Math.max(1, Math.round(it.lt[0] * cfg.supplierLT + it.lt[1] * normal(seed, 31, i, t)));
          const late = R(seed, 32, i, t) < cfg.lateProb ? 2 + Math.floor(R(seed, 33, i, t) * 5) : 0;
          let arrive = t + lt + late, eta = t + Math.round(it.lt[0]);
          if (isSunday(arrive)) arrive++;
          if (isSunday(eta)) eta++;
          const po = { id: 'PO-' + (++poSeq), item: i, supplier: it.supplier, qty, placed: t, eta, arrive, received: false, value: qty * it.cost };
          pos.push(po); onOrder[i] += qty; cum.ord += PARAMS.poFee;
          ev(t, 'info', 'po', `Raised ${po.id}: ${Math.round(qty).toLocaleString('en-IN')} ${it.unit} ${it.name}`);
        }
      }
      prevShort = short.slice();
      days.push(snapshot(t, { proc, avail, lost, down, starve, short, used, arrCnt, arrM, shipCnt, shipM }));
    }

    const sim = { cfg, plan, days, orders, pos, events, H, items: ITEMS, stages: STAGES, products: PRODUCTS, params: Object.assign({}, PARAMS) };
    return sim;
  }

  /* ---------- Metrics ---------- */
  function kpiAt(sim, d) {
    let recvN = 0, recvM = 0, shipN = 0, shipM = 0, awaitM = 0, prodM = 0, openN = 0, lateOpen = 0, elig = 0, ontime = 0, leadSum = 0, lateShip = 0, awaitN = 0;
    for (const o of sim.orders) {
      if (o.arrival <= d) {
        recvN++; recvM += o.qty;
        if (o.ship !== null && o.ship <= d) { shipN++; shipM += o.qty; leadSum += o.ship - o.arrival; if (o.ship > o.due) lateShip++; }
        else {
          openN++;
          if (o.release !== null && o.release <= d) prodM += o.qty; else { awaitM += o.qty; awaitN++; }
          if (o.due < d) lateOpen++;
        }
        if (o.due <= d) { elig++; if (o.ship !== null && o.ship <= o.due) ontime++; }
      }
    }
    const s = sim.days[d];
    let inv = 0, stockout = 0, usedVal = 0;
    for (let i = 1; i <= d; i++) {
      inv += sim.days[i].invValue; for (const f of sim.days[i].short) stockout += f;
      sim.days[i].used.forEach((q, j) => { usedVal += q * sim.items[j].cost; });
    }
    const util = sim.stages.map((st, si) => {
      let p = 0, work = 0;
      for (let i = 1; i <= d; i++) if (!sim.days[i].sunday) { p += sim.days[i].proc[si]; work++; }
      return work ? p / (st.cap * sim.cfg.cap[st.id] * work) : 0;
    });
    const utilAvail = sim.stages.map((st, si) => {
      let p = 0, a = 0;
      for (let i = 1; i <= d; i++) { p += sim.days[i].proc[si]; a += sim.days[i].avail[si]; }
      return a ? p / a : 0;
    });
    let bottleneck = -1, bu = 0; util.forEach((u, i) => { if (u > bu) { bu = u; bottleneck = i; } });
    const c = s.cum, avgInv = d ? inv / d : s.invValue;
    return {
      day: d, recvN, recvM, shipN, shipM, openN, awaitM, awaitN, prodM, lateOpen, lateShip,
      otif: elig ? ontime / elig * 100 : null, elig,
      lead: shipN ? leadSum / shipN : null,
      invValue: s.invValue, avgInv, stockoutDays: stockout,
      turns: d && avgInv > 0 ? usedVal / d * 365 / avgInv : null,
      throughput: d ? shipM / d : 0, utilAvail, bottleneck,
      costs: { materials: c.mat, conversion: c.conv, consumables: c.cons, holding: c.hold, ordering: c.ord, penalties: c.pen },
      revenue: c.rev, contribution: c.rev - c.cogs - c.cons - c.hold - c.ord - c.pen,
      penalties: c.pen, holding: c.hold, ordering: c.ord, util
    };
  }

  function buildSeries(sim) {
    const H = sim.H, out = { awaitM: [], prodM: [], otifRoll: [], recvCum: [], shipCum: [], util: [[], [], [], []], wip: [[], [], [], []], inv: [], invRaw: [], invCons: [] };
    let rc = 0, sc = 0;
    for (let d = 0; d <= H; d++) {
      const s = sim.days[d];
      out.awaitM.push(s.awaitM); out.prodM.push(s.bookProdM);
      rc += s.arrM; sc += s.shipM; out.recvCum.push(rc); out.shipCum.push(sc);
      let n = 0, ok = 0;
      for (const o of sim.orders) if (o.due <= d && o.due > d - 14 && o.arrival <= d) { n++; if (o.ship !== null && o.ship <= o.due) ok++; }
      out.otifRoll.push(n >= 3 ? ok / n * 100 : null);
      sim.stages.forEach((st, si) => {
        out.util[si].push(d === 0 || s.sunday ? null : s.proc[si] / (st.cap * sim.cfg.cap[st.id]) * 100);
        out.wip[si].push(s.wip[si]);
      });
      let raw = 0, cons = 0;
      s.onHand.forEach((q, i) => { if (ITEMS[i].kind === 'raw') raw += q * ITEMS[i].cost; else cons += q * ITEMS[i].cost; });
      out.invRaw.push(raw); out.invCons.push(cons); out.inv.push(raw + cons);
    }
    return out;
  }

  function summarize(sim) {
    const k = kpiAt(sim, sim.H);
    return k;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };

  // Runs n replications (seed, seed+1, ...) and returns means plus spread for the headline measures.
  function runMany(cfg, n) {
    n = Math.max(1, Math.round(n));
    const col = { otif: [], lead: [], contribution: [], avgInv: [], stockoutDays: [], openM: [], lateOpen: [], revenue: [], utilDye: [], turns: [] };
    for (let i = 0; i < n; i++) {
      const sim = simulate(Object.assign({}, cfg, { seed: (cfg.seed | 0) + i }));
      const k = kpiAt(sim, sim.H);
      if (k.otif !== null) col.otif.push(k.otif);
      if (k.lead !== null) col.lead.push(k.lead);
      if (k.turns !== null) col.turns.push(k.turns);
      col.contribution.push(k.contribution); col.avgInv.push(k.avgInv); col.stockoutDays.push(k.stockoutDays);
      col.openM.push(k.awaitM + k.prodM); col.lateOpen.push(k.lateOpen); col.revenue.push(k.revenue); col.utilDye.push(k.util[1]);
    }
    const out = { n };
    for (const key in col) out[key] = mean(col[key]);
    for (const key of ['otif', 'contribution', 'lead', 'avgInv']) {
      const sorted = col[key].slice().sort((x, y) => x - y);
      out[key + 'Sd'] = sd(col[key]); out[key + 'P10'] = quantile(sorted, 0.1); out[key + 'P90'] = quantile(sorted, 0.9);
    }
    return out;
  }

  function presetCfg(id, base) {
    const p = PRESETS.find(x => x.id === id);
    const c = Object.assign({}, base || {}, p.cfg);
    c.cap = Object.assign({}, (base && base.cap) || {}, p.cfg.cap || {});
    return c;
  }

  /* ---------- Master data editing ---------- */
  const SNAPSHOT = JSON.stringify({ stages: STAGES, products: PRODUCTS, items: ITEMS.map(i => { const c = Object.assign({}, i); delete c.idx; return c; }), customers: CUSTOMERS, params: PARAMS });
  let dataVersion = 0, customData = false;
  const num = (v, lo, hi, what) => {
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(what + ' must be a number');
    if (v < lo || v > hi) throw new Error(what + ' must be between ' + lo + ' and ' + hi);
    return v;
  };
  // Returns a plain-object copy of everything a client can change.
  function getData() {
    return JSON.parse(JSON.stringify({ stages: STAGES, products: PRODUCTS, items: ITEMS.map(i => { const c = Object.assign({}, i); delete c.idx; return c; }), customers: CUSTOMERS, params: PARAMS }));
  }
  // Validates and applies edited master data in place. Structure (which stages, which item ids) is fixed;
  // numbers, names, BOM quantities, customers and global parameters can change. Throws before touching anything if invalid.
  function setData(d) {
    if (!d || typeof d !== 'object') throw new Error('Data must be an object');
    const base = JSON.parse(SNAPSHOT);
    const stages = (d.stages || base.stages).map((st, i) => {
      const b = base.stages[i]; if (!b) throw new Error('Unknown stage #' + (i + 1));
      return { id: b.id, name: String(st.name || b.name), cap: num(+st.cap, 100, 1e7, b.name + ' capacity'), changeover: num(+st.changeover, 0, 5000000, b.name + ' changeover'), conv: num(+st.conv, 0, 1e4, b.name + ' conversion cost') };
    });
    if (stages.length !== base.stages.length) throw new Error('All ' + base.stages.length + ' stages are required');
    const itemIds = base.items.map(i => i.id);
    const products = (d.products || base.products).map((p, i) => {
      const b = base.products[i]; if (!b) throw new Error('Unknown product #' + (i + 1));
      const bom = {};
      for (const id in p.bom || {}) {
        if (!itemIds.includes(id) || base.items.find(x => x.id === id).kind !== 'raw') throw new Error(b.name + ': BOM item ' + id + ' is not a raw material');
        const q = num(+p.bom[id], 0, 1e4, b.name + ' BOM ' + id); if (q > 0) bom[id] = q;
      }
      if (!Object.keys(bom).length) throw new Error(b.name + ' needs at least one material in its BOM');
      const size = [num(+p.size[0], 100, 1e6, b.name + ' min order'), num(+p.size[1], 100, 1e6, b.name + ' max order')];
      if (size[1] < size[0]) throw new Error(b.name + ': max order size is below min');
      return { id: b.id, name: String(p.name || b.name), short: String(p.short || b.short), price: num(+p.price, 1, 1e6, b.name + ' price'), share: num(+p.share, 0, 1, b.name + ' share'), size, lead: num(+p.lead, 1, 120, b.name + ' lead time'), bom };
    });
    if (products.length !== base.products.length) throw new Error('All ' + base.products.length + ' products are required');
    const shareSum = products.reduce((a, p) => a + p.share, 0);
    if (Math.abs(shareSum - 1) > 0.011) throw new Error('Product shares must add up to 100% (currently ' + Math.round(shareSum * 100) + '%)');
    const items = (d.items || base.items).map((it, i) => {
      const b = base.items[i]; if (!b) throw new Error('Unknown item #' + (i + 1));
      const lt = [num(+it.lt[0], 1, 120, b.name + ' lead time'), num(+it.lt[1], 0, 60, b.name + ' lead time spread')];
      const o = Object.assign({}, b, { name: String(it.name || b.name), unit: String(it.unit || b.unit), supplier: String(it.supplier || b.supplier),
        cost: num(+it.cost, 0.01, 1e7, b.name + ' cost'), lot: num(+it.lot, 1, 1e8, b.name + ' lot size'), lt, cover: num(+it.cover, 0, 365, b.name + ' cover days') });
      if (b.kind === 'cons') o.rate = num(+it.rate, 0, 1e4, b.name + ' usage rate');
      return o;
    });
    if (items.length !== base.items.length) throw new Error('All ' + base.items.length + ' items are required');
    const pr = d.params || base.params;
    const params = {
      lambda: num(+pr.lambda, 0.1, 100, 'Orders per day'), holdRate: num(+pr.holdRate, 0, 2, 'Holding rate'), poFee: num(+pr.poFee, 0, 1e7, 'Purchase order fee'),
      latePenaltyPerDay: num(+pr.latePenaltyPerDay, 0, 1, 'Late penalty per day'), latePenaltyCap: num(+pr.latePenaltyCap, 0, 1, 'Late penalty cap')
    };
    const customers = (d.customers || base.customers).map(String).filter(Boolean);
    if (!customers.length) throw new Error('At least one customer is required');
    // all checks passed: apply
    stages.forEach((st, i) => Object.assign(STAGES[i], st));
    products.forEach((p, i) => { PRODUCTS[i] = p; });
    items.forEach((it, i) => { it.idx = i; Object.assign(ITEMS[i], it); });
    CUSTOMERS.length = 0; customers.forEach(c => CUSTOMERS.push(c));
    Object.assign(PARAMS, params);
    dataVersion++; customData = JSON.stringify(getData()) !== SNAPSHOT;
  }
  function resetData() { setData(JSON.parse(SNAPSHOT)); customData = false; }
  const dataInfo = () => ({ version: dataVersion, custom: customData });

  const api = { STAGES, PRODUCTS, ITEMS, IDX, CUSTOMERS, PARAMS, DEFAULTS, PRESETS, getData, setData, resetData, dataInfo, simulate, kpiAt, buildSeries, summarize, runMany, presetCfg, dateOf, isSunday, makePlan, mergeCfg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LoomEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
