// Engine checks. Run with: node tests/test.js   (exits non-zero on any failure)
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || 'values differ') + ': ' + a + ' vs ' + b); }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log('Determinism and common random numbers');
test('same settings and seed give identical results', () => {
  const a = E.simulate({ seed: 3 }), b = E.simulate({ seed: 3 });
  assert(JSON.stringify(a.orders) === JSON.stringify(b.orders), 'orders differ');
  assert(JSON.stringify(a.pos) === JSON.stringify(b.pos), 'purchase orders differ');
});
test('different seeds give different demand', () => {
  assert(JSON.stringify(E.simulate({ seed: 1 }).orders) !== JSON.stringify(E.simulate({ seed: 2 }).orders));
});
test('order arrivals are unaffected by capacity, safety stock or sequencing changes', () => {
  const arr = s => s.orders.map(o => [o.arrival, o.product, o.qty, o.due].join()).join('|');
  const a = E.simulate({ seed: 5 }), b = E.simulate({ seed: 5, cap: { dye: 1.5 }, safetyDays: 9, rule: 'fifo', breakdown: 0.1 });
  assert(arr(a) === arr(b), 'arrivals changed');
});
test('no orders arrive on Sundays', () => {
  const sim = E.simulate({ seed: 9 });
  assert(sim.orders.every(o => !E.isSunday(o.arrival)));
});

console.log('Physical consistency');
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const scen = [{}, { demand: 1.6, breakdown: 0.15 }, { supplierLT: 2.5, lateProb: 0.4, safetyDays: 0 }, { rule: 'campaign', demand: 1.3 }, { rule: 'fifo', cap: { weave: 0.6 } }];
test('stock never goes negative', () => {
  for (const cfg of scen) for (const seed of SEEDS) {
    const sim = E.simulate(Object.assign({ seed }, cfg));
    for (const d of sim.days) for (const q of d.onHand) assert(q > -1e-6, 'negative stock in ' + JSON.stringify(cfg));
  }
});
test('material balance: start + received - used = end, for every item', () => {
  for (const cfg of scen) {
    const sim = E.simulate(Object.assign({ seed: 4 }, cfg));
    sim.items.forEach((it, i) => {
      const recv = sim.pos.filter(p => p.item === i && p.received).reduce((a, p) => a + p.qty, 0);
      const used = sim.days.reduce((a, d) => a + d.used[i], 0);
      near(sim.days[0].onHand[i] + recv - used, sim.days[sim.H].onHand[i], 1e-6 * (1 + recv), it.name + ' balance');
    });
  }
});
test('on-order quantity equals open purchase orders', () => {
  const sim = E.simulate({ seed: 4, supplierLT: 2 });
  sim.items.forEach((it, i) => {
    const open = sim.pos.filter(p => p.item === i && !p.received).reduce((a, p) => a + p.qty, 0);
    near(sim.days[sim.H].onOrder[i], open, 1e-6, it.name);
  });
});
test('processed meters never exceed available capacity, and none on Sundays', () => {
  for (const cfg of scen) {
    const sim = E.simulate(Object.assign({ seed: 6 }, cfg));
    for (const d of sim.days) d.proc.forEach((p, s) => { assert(p <= d.avail[s] + 1e-6, 'overproduction'); if (d.sunday) assert(p === 0, 'Sunday production'); });
  }
});
test('orders pass every stage in order and never ship before release', () => {
  for (const cfg of scen) {
    const sim = E.simulate(Object.assign({ seed: 2 }, cfg));
    for (const o of sim.orders) if (o.ship !== null) {
      assert(o.release !== null && o.release >= o.arrival, 'released before arrival');
      for (let i = 0; i < 4; i++) { assert(o.done[i] !== null, 'stage skipped'); if (i) assert(o.done[i] >= o.done[i - 1] + 1, 'stage overlap'); }
      assert(o.ship === o.done[3], 'ship day differs from packing day');
    }
  }
});
test('meters shipped equal meters processed by the final stage', () => {
  const sim = E.simulate({ seed: 7 });
  const shipped = sim.orders.filter(o => o.ship !== null).reduce((a, o) => a + o.qty, 0);
  const packed = sim.days.reduce((a, d) => a + d.shipM, 0);
  near(shipped, packed, 1e-6);
});
test('meters received equal shipped plus open', () => {
  const sim = E.simulate({ seed: 7, demand: 1.4 }), k = E.kpiAt(sim, sim.H);
  near(k.recvM, k.shipM + k.awaitM + k.prodM, 1e-6);
});

console.log('KPIs');
test('financials add up', () => {
  const sim = E.simulate({ seed: 7 }), k = E.kpiAt(sim, sim.H), c = k.costs;
  near(k.contribution, k.revenue - c.materials - c.conversion - c.consumables - c.holding - c.ordering - c.penalties, 1, 'contribution');
  const rev = sim.orders.filter(o => o.ship !== null).reduce((a, o) => a + o.value, 0);
  near(k.revenue, rev, 1e-6, 'revenue');
});
test('on-time rate is within 0..100 and utilisation within 0..1', () => {
  for (const seed of SEEDS) {
    const k = E.kpiAt(E.simulate({ seed }), 90);
    assert(k.otif === null || (k.otif >= 0 && k.otif <= 100));
    k.util.forEach(u => assert(u >= 0 && u <= 1.0001, 'util ' + u));
  }
});
test('KPIs are defined at every day of the run, including day 0', () => {
  const sim = E.simulate({ seed: 1 });
  for (let d = 0; d <= sim.H; d++) { const k = E.kpiAt(sim, d); assert(isFinite(k.revenue) && isFinite(k.avgInv), 'day ' + d); }
  const s = E.buildSeries(sim); assert(s.inv.length === sim.H + 1);
});

console.log('Scenario behaviour (averaged over 24 runs)');
const avgOtif = cfg => E.runMany(cfg, 24).otif;
test('demand surge lowers on-time delivery', () => assert(avgOtif({ demand: 1.25 }) < avgOtif({}) - 5));
test('extra dyeing capacity helps during a surge', () => assert(avgOtif({ demand: 1.25, cap: { dye: 1.2 } }) > avgOtif({ demand: 1.25 }) + 3));
test('more safety stock improves service and costs more stock', () => {
  const lo = E.runMany({ safetyDays: 1, supplierLT: 1.3, lateProb: 0.15 }, 24), hi = E.runMany({ safetyDays: 8, supplierLT: 1.3, lateProb: 0.15 }, 24);
  assert(hi.otif > lo.otif + 5 && hi.avgInv > lo.avgInv);
});
test('slower suppliers and more breakdowns hurt service', () => {
  const b = avgOtif({});
  assert(avgOtif({ supplierLT: 1.5, lateProb: 0.2 }) < b - 3 && avgOtif({ breakdown: 0.12 }) < b - 3);
});
test('zero demand produces no orders and no revenue', () => {
  const sim = E.simulate({ demand: 0 }); assert(sim.orders.length === 0 && E.kpiAt(sim, sim.H).revenue === 0);
});
test('runMany reports spread', () => {
  const r = E.runMany({}, 20); assert(r.otifSd > 0 && r.otifP10 <= r.otif && r.otifP90 >= r.otif && r.n === 20);
});

console.log('Settings and master data');
test('horizon is clamped', () => {
  assert(E.simulate({ horizon: 1 }).H === 14 && E.simulate({ horizon: 9999 }).H === 365);
});
test('editing capacity changes results; reset restores them exactly', () => {
  const before = JSON.stringify(E.kpiAt(E.simulate({ seed: 3 }), 90));
  const d = E.getData(); d.stages[1].cap = 6000; E.setData(d);
  assert(E.dataInfo().custom);
  assert(JSON.stringify(E.kpiAt(E.simulate({ seed: 3 }), 90)) !== before, 'edit had no effect');
  E.resetData();
  assert(!E.dataInfo().custom && JSON.stringify(E.kpiAt(E.simulate({ seed: 3 }), 90)) === before, 'reset did not restore');
});
test('invalid data is rejected and leaves the model untouched', () => {
  const before = JSON.stringify(E.getData());
  const bad = [d => { d.stages[0].cap = -5; }, d => { d.products[0].share = 0.9; }, d => { d.items[0].cost = 'abc'; }, d => { d.products[1].bom = { nope: 3 }; },
    d => { d.products[2].size = [5000, 1000]; }, d => { d.params.lambda = 0; }, d => { d.customers = []; }, d => { d.products[0].bom = {}; }];
  for (const mut of bad) {
    const d = E.getData(); mut(d);
    let threw = false; try { E.setData(d); } catch (e) { threw = true; }
    assert(threw, 'accepted ' + mut);
    assert(JSON.stringify(E.getData()) === before, 'model changed after rejected edit');
  }
});
test('a higher order rate raises order volume', () => {
  const n0 = E.simulate({ seed: 2 }).orders.length;
  const d = E.getData(); d.params.lambda = 4; E.setData(d);
  const n1 = E.simulate({ seed: 2 }).orders.length; E.resetData();
  assert(n1 > n0 * 1.5, n0 + ' -> ' + n1);
});
test('a very high order rate still runs', () => {
  const d = E.getData(); d.params.lambda = 60; E.setData(d);
  const sim = E.simulate({ seed: 1, horizon: 30 }); E.resetData();
  assert(sim.orders.length > 500);
});

console.log('Build');
test('index.html is up to date with src/', () => {
  const r = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const built = r('src/head.html') + r('src/body.html') + '<script>\n' + r('src/engine.js') + '</script>\n<script>\n' + r('src/app.js') + '</script>\n</body></html>\n';
  assert(built === r('index.html'), 'run ./build.sh');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
