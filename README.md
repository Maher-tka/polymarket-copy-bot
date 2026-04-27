# Polymarket Copy-Trading Bot

Version 1 of **Copy + Confirm + Risk Control Bot** is a paper-trading bot. It reads public Polymarket data, watches selected wallets, creates copy signals, filters them, and simulates trades with fake money.

It does **not** place real orders in Version 1.

## What It Does

1. Fetches the public trader leaderboard.
2. Scores traders from 0 to 100.
3. Watches high-score wallets, or wallets you put in `.env`.
4. Turns new watched-wallet trades into copy signals.
5. Checks trader score, market volume, spread, entry price, copy delay, liquidity, exposure, daily loss, and open position limits.
6. Simulates the trade in paper mode if every check passes.
7. Logs skipped trades with exact reasons when a check fails.
8. Shows everything on a local dashboard.

## Multi-Strategy Engine

The bot now includes a paper-first multi-strategy engine focused on short-term crypto Up/Down markets:

- **Maker Arbitrage Mode** is the preferred research path. It simulates post-only maker orders, cancels stale orders after 1000ms, rejects partial fills, and only paper-hedges when the other leg is fully fillable.
- **Net Arbitrage Scanner** reads YES and NO order books, estimates taker fees, slippage, depth, stale data age, and only accepts large positive net edge.
- **Market Making Mode** simulates maker quotes only on liquid, tight-spread markets and tracks spread/inventory PnL separately in metrics.
- **Whale / Large Trade Tracker** scores large trades using size, liquidity proxy, delay, and market context. It does not blindly copy direction.

Each strategy reports simulated PnL, win rate, max drawdown, fill rate, average edge, average slippage, and rejected trade reasons.

## Safety First

Version 1 is intentionally paper-only:

- `PAPER_TRADING=true` by default.
- `PAPER_TRADING_ONLY=true` by default.
- `LIVE_TRADING=false` by default.
- `REAL_TRADING_ENABLED=false` by default.
- Real mode also requires a second UI confirmation.
- `src/trading/liveTrader.ts` refuses to place orders.
- `src/polymarket/clobLiveClient.ts` refuses to create a live CLOB trading client.
- Private keys and API secrets are not needed for paper mode.
- The dashboard says live trading is disabled in Version 1.

## Setup

From this folder:

```bash
npm install
```

Create your local `.env` file:

```bash
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Keep `.env` in the project root:

```text
polymarket-copy-bot/.env
```

For the first run, leave these values exactly like this:

```env
PAPER_TRADING=true
PAPER_TRADING_ONLY=true
LIVE_TRADING=false
MANUAL_APPROVAL=true
SIMULATE_SIGNALS=true
REAL_TRADING_ENABLED=false
```

## Start Paper Trading

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Watched Wallets

You have two choices.

Leave this empty to auto-select wallets from the public leaderboard:

```env
WATCHED_WALLETS=
```

Or paste specific wallet addresses:

```env
WATCHED_WALLETS=0xabc...,0xdef...
```

By default, the first poll only records already-seen trades and waits for new trades. If you want to test the paper pipeline immediately using recent public trades, set:

```env
REPLAY_RECENT_TRADES_ON_START=true
```

That still uses fake paper money.

## Demo Mode

For immediate movement on the dashboard, keep:

```env
SIMULATE_SIGNALS=true
SIMULATE_SIGNAL_INTERVAL_SECONDS=10
```

Demo mode loads real active Polymarket markets and real CLOB order books, then creates a fake copy signal every 10 seconds. These fake signals still go through the normal market filter, risk manager, position sizing, and paper trader. The dashboard labels them as `DEMO PAPER`.

Turn it off when you only want real watched-wallet signals:

```env
SIMULATE_SIGNALS=false
```

## Dashboard

The dashboard shows:

- Mode: PAPER or LIVE
- Demo mode status
- Wallet watcher active/inactive
- Last poll time
- Last new real trade detected
- Number of watched wallets
- Number of active markets loaded for demo mode
- Market WebSocket connected/disconnected
- Backup polling connected/disconnected
- Fake balance and equity
- Open paper positions
- Closed paper positions
- Realized and unrealized PnL
- Win rate
- Max drawdown
- Watched traders
- Latest copy signals
- Skipped trades and reasons
- Bot logs
- Kill switch status
- Strategy tabs for Arbitrage, Maker Arbitrage, Market Making, and Whale Tracker
- Live opportunities, strategy paper trades, rejected strategy signals, recorder status, and CSV export
- **Why We Are Losing / Rejecting** diagnostics for total signals, trades taken, rejected reasons, raw edge, net edge, fees, slippage, data delay, depth, failed fills, failed hedges, partial fills, close-window rejects, loss causes, and strategy ranking
- Strategy ranking labels a strategy as `paper >60%` only after at least 30 paper trades, positive net PnL, positive actual edge, and win rate at or above 60%. Real trading stays locked even if that appears.

For paper research, `STRATEGY_LAB_ALL_MARKETS=true` lets the market-making lab inspect high-volume liquid binary markets beyond crypto Up/Down. Keep this on for finding edge; turn it off when you only want crypto-focused diagnostics.

Use the **Kill switch** button to stop new paper trades from being accepted by the risk manager.

Use **Emergency Stop** in the Multi-Strategy Engine card to stop strategy-driven paper trading.

## Paper Fill Simulation

Strategy paper trades walk the live CLOB order book levels to simulate realistic fills:

- full or partial fill rate
- visible depth
- average fill price
- top-of-book price
- slippage
- maker/taker fee estimate
- stale data and failed-fill rejections
- partial fill rejection when `REJECT_PARTIAL_FILLS=true`
- both-leg fill checks for arbitrage when `REQUIRE_BOTH_LEGS_FILLABLE=true`

The stricter scanner defaults are:

```env
MIN_NET_EDGE=0.025
MAX_SLIPPAGE=0.003
MAX_SPREAD=0.015
MAX_DATA_AGE_MS=300
MAX_STALE_DATA_MS=300
FINAL_ENTRY_BUFFER_SECONDS=45
FORCED_RISK_CHECK_SECONDS=60
MIN_DEPTH_MULTIPLIER=5
MAX_TRADE_SIZE_USD=5
MAX_POSITION_SIZE_PCT=0.01
MAX_OPEN_POSITIONS=2
MAX_DAILY_LOSS_PERCENT=2
STOP_AFTER_CONSECUTIVE_LOSSES=3
REQUIRE_BOTH_LEGS_FILLABLE=true
REJECT_PARTIAL_FILLS=true
```

Fees are configurable:

```env
TAKER_FEE_RATE=0.05
CRYPTO_TAKER_FEE_RATE=0.072
MAKER_FEE_RATE=0
MAKER_ORDER_TIMEOUT_MS=1000
MAKER_FAILED_FILL_RISK_BPS=30
MARKET_MAKING_MIN_EDGE=0.0005
MARKET_MAKING_MAX_DATA_AGE_MS=15000
STRATEGY_LAB_ALL_MARKETS=true
```

The fee simulator uses Polymarket-style binary fee math:

```text
fee = shares * feeRate * price * (1 - price)
```

That is intentionally strict around 50/50 crypto markets, where small raw arbitrage can disappear after taker fees.

## CSV Export And Recording

Export strategy paper trades from the dashboard or open:

```text
http://localhost:3000/api/export/paper-trades.csv
```

Live CLOB snapshots are recorded under `data/` for future replay/backtesting:

```env
RECORDER_ENABLED=true
BACKTEST_MODE=false
```

## Telegram Alerts

Telegram is optional. Leave these empty to disable it:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

If filled in, the bot can send alerts for:

- New copy signal
- Paper trade simulated
- Trade skipped
- Daily loss limit reached
- Bot error
- Future live-mode manual approval request

## Verify It Is Not Using Real Money

Check all of these:

1. `.env` has `PAPER_TRADING=true`.
2. `.env` has `PAPER_TRADING_ONLY=true`.
3. `.env` has `LIVE_TRADING=false`.
4. `.env` has `REAL_TRADING_ENABLED=false`.
5. The startup log says `Version 1 started in PAPER mode only`.
6. Dashboard mode shows `PAPER`.
7. Demo logs say `SIMULATED signal generated` and trades say `Paper BUY simulated` or `Paper SELL simulated`.
8. `src/index.ts` throws if live trading or real trading is enabled.
9. `src/trading/liveTrader.ts` throws instead of placing orders.

## Useful Commands

Run tests:

```bash
npm test
```

Check TypeScript:

```bash
npm run typecheck
```

Run the lint/type safety alias:

```bash
npm run lint
```

Run the paper trading diagnostic report:

```bash
npm run diagnose
```

Build compiled JavaScript:

```bash
npm run build
```

## Important Notes

Polymarket may restrict trading from some locations. This bot does not bypass restrictions or platform rules. The live trading module checks the public geoblock endpoint before any future live implementation, but Version 1 blocks live trading before order placement is even possible.

Paper trading is a simulator. It uses visible public order book liquidity and public trade data, but it cannot perfectly predict real fills, hidden liquidity, latency, fees, or order matching behavior.
