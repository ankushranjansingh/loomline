# Loomline: textile mill simulator

Daily-step simulation of a textile mill: customer orders, production planning (weaving, dyeing,
finishing, packing), raw material and consumable inventory, procurement, and what-if scenarios.
Ships with demo data; the plant's own numbers can be entered in the app.

## Run it
Double-click `index.html`. It is one self-contained file and needs no server.
(Fonts load from Google Fonts when online; the page falls back to system fonts offline.)

## What it does
- **Overview, Orders, Production, Inventory, Procurement**: a day-by-day view of the plant. Use the slider or play button to move through the run.
- **Compare scenarios**: presets and your current settings run 16 times each, with the middle-80% range, so one unlucky run does not mislead.
- **Report**: plain-language findings, profit and loss, tested improvement levers, CSV exports (orders, purchase orders, daily data), a printable page, and save/load of a scenario file.
- **Model data**: edit stage capacities, changeovers, prices, order mix, bills of materials, supplier lead times, costs and customers. Import or export as JSON. Edits are validated before they are applied.
- Settings and edited data are remembered in the browser between visits.

## Layout
- `src/engine.js`  simulation engine, demo master data, data validation (`getData`, `setData`, `resetData`)
- `src/app.js`     dashboard UI (charts, tables, report, data editor, exports)
- `src/head.html`, `src/body.html`  styles and page shell
- `build.sh`       rebuilds `index.html` from `src/` (`npm run build`)
- `tests/test.js`  26 checks: determinism, stock and material balance, capacity limits, order flow, financial identities, scenario behaviour, data validation, build freshness (`npm test`)

After editing anything in `src/`, run `npm run check` (rebuild, then test).

## Model scope
Single plant, one line per stage, deterministic yield. Not modelled yet: labour and shifts, scrap and rework,
partial shipments, demand seasonality, multi-sourcing. The full list is in the app (Report, "How the model works").
Calibrate against the plant's actual on-time rate and stock levels before relying on the numbers.
