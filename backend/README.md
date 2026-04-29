# Backend

FastAPI backend for the Polymarket trading bot.

Run from the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
copy backend\.env.example .env
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The backend starts in PAPER mode by default and does not require Polymarket private keys.
