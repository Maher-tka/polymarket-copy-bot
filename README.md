# Polymarket Trading Bot

This repository has been restructured into a production-style Polymarket trading research system.

The old TypeScript/Node strategy lab was backed up first in:

```text
_backup_before_restructure
```

The new primary app is:

```text
backend/   Python 3.11+ FastAPI trading backend
frontend/  React/Vite dashboard
```

## What This Bot Does

The bot is no longer only a copy-trading bot. The main research stack is:

1. Calibration arbitrage
2. Microstructure / orderbook imbalance
3. Market-making / spread capture
4. Optional smart-money tracking as a weak signal only
5. Optional news/event signal, disabled by default until tested

Signal aggregation uses:

```text
final_score =
  0.40 * calibration_score
+ 0.30 * microstructure_score
+ 0.20 * spread_capture_score
+ 0.10 * smart_money_score
```

News signal code exists as an interface, but it is disabled by default and must not be used live until backtested.

## Modes

### PAPER Mode

Default and recommended.

- Fake balance
- Real market data ready through CLOB/Gamma/Data clients
- Simulated fills
- PnL tracking
- Risk limits active
- No private key required

### REAL Mode

Disabled by default and intentionally hard to start.

REAL mode requires all of these:

```env
BOT_MODE=REAL
REAL_TRADING_ENABLED=true
I_UNDERSTAND_REAL_MONEY_RISK=true
POLYMARKET_PRIVATE_KEY=...
POLYMARKET_FUNDER_ADDRESS=...
```

The private key is never sent to the frontend, never stored in the database, and real orders must pass `RiskEngine`.

## Safety Rules

The bot will block trading when:

- Emergency stop is active
- Bot is paused
- WebSocket/orderbook data is stale
- Daily loss limit is hit
- Total drawdown limit is hit
- Per-market exposure limit is hit
- Cash reserve would be violated
- Market liquidity or volume is too low
- Spread is too wide
- Market is too close to resolution
- Signal score or expected edge is too low

All execution is modeled as limit orders. Market-style execution should only be marketable limit orders with strict slippage protection.

## Folder Structure

```text
polymarket-copy-bot/
  backend/
    app/
      main.py
      config.py
      logging_config.py
      api/
      core/
      data/
      strategy/
      risk/
      execution/
      storage/
      analytics/
      tests/
    requirements.txt
    .env.example
    README.md
  frontend/
    package.json
    src/
      App.jsx
      main.jsx
      api.js
      components/
      styles.css
  docker-compose.yml
  README.md
```

## Windows Beginner Guide

1. Install Python 3.11 or newer.
2. Install Node.js.
3. Open PowerShell.
4. Go into the project folder:

```powershell
cd "C:\Users\Maher\Documents\New project\polymarket-copy-bot"
```

5. Create and activate a Python virtual environment:

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

6. Install backend dependencies:

```powershell
python -m pip install -r backend\requirements.txt
```

7. Create your local environment file:

```powershell
copy backend\.env.example .env
```

8. Start the backend:

```powershell
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

9. In a second PowerShell window, start the frontend:

```powershell
cd "C:\Users\Maher\Documents\New project\polymarket-copy-bot\frontend"
npm install
npm run dev
```

10. Open the dashboard:

```text
http://127.0.0.1:5173
```

11. Use PAPER mode first.

Never enable REAL mode until paper results are profitable, stable, reviewed, and you understand the real-money risk.

## Environment Example

See:

```text
backend/.env.example
```

Key defaults:

```env
APP_ENV=development
BOT_MODE=PAPER
PAPER_START_BALANCE=1000

REAL_TRADING_ENABLED=false
I_UNDERSTAND_REAL_MONEY_RISK=false

MAX_TRADE_NAV_PCT=0.01
MAX_MARKET_NAV_PCT=0.02
MAX_DAILY_LOSS_PCT=0.05
MAX_TOTAL_DRAWDOWN_PCT=0.10
CASH_RESERVE_PCT=0.20
MAX_SPREAD_CENTS=3
MIN_EXPECTED_EDGE=0.05
MIN_LIQUIDITY=1000
MIN_VOLUME=5000
MAX_ORDER_AGE_SECONDS=30
STALE_DATA_SECONDS=10
KELLY_FRACTION=0.50
```

## Testing

Run backend tests:

```powershell
pytest backend/app/tests
```

Run a full local verification:

```powershell
python -m pytest backend/app/tests
python -m compileall -q backend

cd frontend
npm install
npm run build
```

Check local services:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing
```

## Current Implementation Phase

Implemented now:

- Phase 1: folder restructure, config, DB models, paper executor, risk engine, dashboard live state.
- Phase 2 foundation: Gamma, Data API, CLOB REST, CLOB WebSocket client scaffolds.
- Phase 3 foundation: signal modules and aggregator, paper demo tick.
- Phase 4 foundation: REAL executor guarded behind environment flags, runtime confirmation, and risk checks.
- Phase 5 foundation: analytics modules for PnL, performance, attribution, and backtesting scaffold.

Additional safety locks:

- Mutating bot routes reject non-local clients.
- REAL mode start requires env safety flags plus runtime confirmation.
- Demo tick is disabled in REAL mode.
- Paper and REAL executors reject stale orderbook data.

## Important Notes

- The old TypeScript implementation is preserved in `_backup_before_restructure`.
- The new backend starts in PAPER mode by default.
- No secrets should be committed.
- `.env`, `.venv`, local SQLite DBs, and frontend `node_modules` are ignored.
