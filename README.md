# TradeHarbor — Trading Journal for Futures & Prop Traders

TradeHarbor is a fully client-side trading journal built with plain HTML, CSS and JavaScript.
No build step, no dependencies, no server — open it in a browser and it works, with a realistic
demo dataset preloaded.

## Run it

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk (`file://`) also works.

## Features

| Page | What it does |
|---|---|
| **Stats** | KPI tiles (Total P/L, Win Rate, Profit Factor, R Factor, largest win/loss days, streaks), **Net P&L after expenses**, cumulative/daily SVG chart, monthly calendar with weekly totals, list view, filters (accounts / date presets / tags / per-day vs per-trade) |
| **Trades** | Filterable trade list (date, source, result, symbol, account, search), pyramid detection badge, simulated broker sync |
| **Trade Review** | Read-only imported fills, autosaving notes, screenshots (downscaled, quota-guarded), strategy checklist with required counts, tags, reuse review across same-day trades in other accounts, delete |
| **Prep & Review** | Daily pre-market prep / live checklist / day recap; weekly prep (Sun) and recap (Sat); bias accuracy & plan adherence scoring |
| **My Strategy** | Strategy library with rule sections and "X of Y required" thresholds, completeness snapshot, global trade-tag manager |
| **Expenses** *(new)* | Subscriptions with auto-renew (renewals log themselves and advance the date), one-time expenses, monthly recurring / this-month / YTD totals, upcoming renewals — feeds the Net P&L tile on Stats |
| **Prop Rules** *(new)* | Per-account prop-firm compliance: trailing/static drawdown floor & buffer, daily loss limit, profit-target progress, consistency-rule score, breach alerts (also surfaced on Stats) |
| **Insights** *(new)* | Expectancy, avg win/loss, payoff ratio, median hold; P/L by hour, weekday, symbol, hold time and tag; P/L by emotion, confidence calibration, cost-of-mistakes |
| **Psychology** *(new)* | Confidence rating (1–5), emotion tags and mistake tags on every trade review — feeding the Insights breakdowns |
| **CSV import/export** *(new)* | Column-mapping CSV importer with dedupe; one-click export of filtered trades and expenses |
| **Monthly Report** *(new)* | Printable month-end summary (KPIs, calendar, breakdowns, compliance, prep adherence) via `window.print()` |
| **Goals & streaks** *(new)* | Process goals (recap daily, prep daily, respect the stop, max trades/day) with current/best streaks |
| **Manual Entry** | Hand-log trades with a live derived P/L, points and R preview |
| **Broker Connections** | Simulated Tradovate/NinjaTrader connections: sync recent trades, import older ranges as async jobs with a persistent history log, linked-accounts table with distance-to-drawdown |
| **Accounts** | Tracker account CRUD (eval / funded / practice / manual) with archive-not-delete safety |

Light **and dark themes** — toggle in the sidebar footer, persists in `th:theme`.

## How it works

- **Storage** — everything lives in `localStorage` under `th:v1:*` keys (per-entity keys;
  screenshots get one key per trade for quota isolation). First visit seeds a deterministic
  demo dataset (~90 days of trades, 3 connections, 5 accounts, subscriptions and expenses).
  "Reset demo data" in the sidebar restores it.
- **Derived values** — net P/L, points and R multiples are always computed from the stored
  fills (`js/calc.js`), never persisted, so numbers can't go stale.
- **Auto-renew sweep** — on every app load, any auto-renew subscription whose renewal date has
  passed generates an expense record per elapsed cycle and advances its next date (deduped, so
  it is safe to run repeatedly).
- **Simulated sync** — broker connections and sync jobs are simulations: jobs persist progress
  each tick, and a job left running when you close the page is completed on the next load.
- **No network calls** — charts are hand-rolled SVG, fonts are system fonts, everything is local.

## Project layout

```
index.html            landing page
legal.html            disclosures
app/*.html            nine app pages (thin shells; content is rendered by JS)
css/                  tokens, base components, app shell, landing styles
js/seed-data.js       deterministic demo data generator
js/store.js           localStorage layer, seeding, sweeps, sim-job engine
js/calc.js            pure metrics/date/aggregation functions
js/ui.js              shared shell, modal, toast, formatters, multiselect
js/charts.js          SVG line/bar chart with tooltip
js/pages/*.js         one script per page
assets/               original SVG logo + favicon
```

## Disclaimer

Futures and forex trading involves substantial risk of loss and is not suitable for every
investor. TradeHarbor is a journaling tool, not financial advice. See `legal.html` for the
full disclosures. Demo data is simulated; broker names shown in the demo are trademarks of
their respective owners and the demo is not affiliated with them.
