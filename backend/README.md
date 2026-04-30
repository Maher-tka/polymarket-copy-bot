# Backend

FastAPI backend for the Polymarket trading bot.

Run from the project root:

```powershell
python -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
copy backend\.env.example .env
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The backend starts in PAPER mode by default and does not require Polymarket private keys.

Implemented guide safeguards:

- WebSocket-first orderbook cache with JSON heartbeat and REST recovery.
- Cost-adjusted edge checks for resolution fee, fees, slippage, and capital lock-up time.
- Per-market, max-open-market, and correlated exposure limits.
- Signal attribution on paper trades for later performance review.
- Research audit CSVs under `data/research_audit` for scored signals and paper fills.
- Optional cached Metaculus probability provider through `EXTERNAL_PROBABILITY_PROVIDER=metaculus`.
- Optional Fear Seller strategy in `backend/app/strategy/impossibility_seller.py`, disabled by default because high win-rate tail-risk trades can still lose badly.
- Diversified market discovery and bucket learning for crypto-up, crypto-down, weather, sports, politics, and general markets.
