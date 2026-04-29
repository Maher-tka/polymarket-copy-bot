# Polymarket Strategy Lab Bot

This project is being refactored from an early copy-trading prototype into a Polymarket research, backtesting, paper-trading, and eventually live-incubation system.

The important rule: this is a **strategy lab**, not a guaranteed-profit bot. Strategies must pass research, backtesting, realistic paper trading, and tiny-size live incubation before any real size is considered.

It does **not** place real orders in the current runnable version.

## Current Safe Mode

The app currently starts only in paper mode:

```env
MODE=paper
PAPER_TRADING=true
PAPER_TRADING_ONLY=true
LIVE_TRADING=false
ENABLE_LIVE_TRADING=false
REAL_TRADING_ENABLED=false
```

`MODE=research`, `MODE=backtest`, and `MODE=live` are parsed by the config system, but the current runtime intentionally only starts `MODE=paper`. Live mode also fails closed unless every live confirmation flag is enabled and a separate reviewed execution implementation exists.

## Planned Modes

- **RESEARCH** - optional arXiv MCP-assisted research notes only. It must not import live execution code or place orders.
- **BACKTEST** - historical replay with MarketLens or recorded order-book snapshots.
- **PAPER** - live Polymarket data with fake balance and realistic fill simulation.
- **LIVE** - locked by default. Every live order must pass the order router and risk manager.

## What It Does Today

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
SIMULATE_SIGNALS=false
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

For immediate movement on the dashboard copy-signal pipeline, you can temporarily set:

```env
SIMULATE_SIGNALS=true
SIMULATE_SIGNAL_INTERVAL_SECONDS=10
```

Demo mode loads real active Polymarket markets and real CLOB order books, then creates a fake copy signal every 10 seconds. These fake copy signals are random test traffic, so they are useful for testing UI movement but should not be treated as strategy performance. The dashboard labels them as `DEMO PAPER`.

Keep it off when you want the dashboard to focus on strategy-lab results and real watched-wallet signals:

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

## Architecture Map

The project is split by responsibility:

- `src/config/` - central settings loader and environment validation. This is the first refactor step toward mode separation.
- `src/polymarket/` - public Polymarket clients for Gamma, Data API, CLOB public order books, and market WebSocket status.
- `src/strategy/` - strategy signal generation and diagnostics. Strategy code should not place orders directly.
- `src/execution/` - execution boundary. Copy-signal paper fills, strategy paper fills, and future real execution must pass through this layer.
- `src/trading/` - paper portfolio/accounting implementations and the locked live-trader stub.
- `src/risk/` - risk checks, pause state, kill switch, max exposure, daily loss, and strategy risk gates.
- `src/dashboard/` - Express API, SSE stream, and React/Vite dashboard.
- `src/diagnostics/` - PnL, rejection, and loss-cause analysis.
- `src/learning/` - paper-only defensive optimizer that consumes diagnostics and tightens strategy settings in memory.
- `src/storage/` - local JSONL recorder/export support.
- `tests/` - unit tests for risk, fill simulation, strategy execution, diagnostics, and filters.

Target architecture for the next refactor steps:

```text
src/
  config/              env validation and mode gates
  data/                live Polymarket adapters and MarketLens backtest adapters
  research/            optional arXiv notes and strategy hypotheses
  strategies/          pure signal modules only
  backtesting/         replay engine, fill simulator, metrics, reports
  paper/               paper engine and paper portfolio
  execution/           order router, paper executor, live executor boundary
  risk/                risk manager, kill switch, position limits
  dashboard/           UI and API
  storage/             local database, logs, exports
  tests/               critical behavior tests
```

Cleanup rules before adding features:

- Do not put order execution inside strategy files.
- Reuse `src/execution/executionLayer.ts` for paper execution and future real execution boundaries.
- Keep real trading locked unless `PAPER_TRADING_ONLY=false`, `REAL_TRADING_ENABLED=true`, and a separately reviewed live execution implementation exists.
- Route risk through `RiskManager` / `StrategyRiskManager`; do not add local kill-switch logic inside strategies.
- Add tests when changing order-book math, risk decisions, paper fill simulation, or execution routing.

## Research And Backtesting Notes

arXiv MCP is optional and should be used only as a research assistant. Research summaries should be saved as notes and turned into hypotheses, not production code. arXiv code must not be imported by the live runtime and must never call the executor.

MarketLens is planned for historical Polymarket order-book and trade replay. `MARKETLENS_API_KEY` is already supported in `.env`, but the adapter should stay separate from live Polymarket clients. If SDK/API details are not available, add a clean adapter interface with TODO comments instead of guessing request formats.

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
MARKET_MAKING_MAX_DATA_AGE_MS=5000
STRATEGY_LAB_ALL_MARKETS=true
```

The fee simulator uses Polymarket-style binary fee math:

```text
fee = shares * feeRate * price * (1 - price)
```

That is intentionally strict around 50/50 crypto markets, where small raw arbitrage can disappear after taker fees.

## Low-Latency Paper Defaults

The dashboard streams state every `0.5s`. The default paper loops are tuned to feel live without enabling real trading:

```env
TRADER_POLL_INTERVAL_SECONDS=10
POSITION_MARK_INTERVAL_SECONDS=10
ARBITRAGE_SCAN_INTERVAL_SECONDS=3
MARKET_MAKING_INTERVAL_SECONDS=3
MARKET_MAKING_MAX_DATA_AGE_MS=5000
MARKET_MAKING_MAX_QUEUE_DEPTH_MULTIPLIER=3
MARKET_MAKING_ADVERSE_SELECTION_BPS=25
WHALE_POLL_INTERVAL_SECONDS=5
```

If the dashboard shows high average quote delay, the bot should reject stale trades instead of chasing them.

## Research-Based Paper Realism

The current research lesson is simple: do not trust paper profit until it models fees, queue position, missed maker fills, stale books, and adverse selection.

The market-making simulator now posts a paper maker order first. It does not instantly count every quote as a winning trade. A quote either:

- fills later only if the live book moves into the simulated maker limit,
- times out as a missed fill,
- or records an adverse-selection loss if the fill happens because price moved against the quote.

Useful knobs:

```env
MAKER_ORDER_TIMEOUT_MS=1000
MARKET_MAKING_MAX_QUEUE_DEPTH_MULTIPLIER=3
MARKET_MAKING_ADVERSE_SELECTION_BPS=25
```

## Paper Self-Learning

The bot has a paper-only optimizer that reads the existing diagnostic summary and makes defensive in-memory tweaks:

- `PAPER_LEARNING_ENABLED=true` turns on the optimizer.
- `PAPER_LEARNING_AUTO_APPLY=true` lets it tighten paper settings automatically.
- `PAPER_LEARNING_MIN_SIGNALS=250` waits for enough rejected/accepted signals before pausing a losing strategy loop.
- `PAPER_LEARNING_MIN_TRADES=30` waits for enough paper fills before judging trade win rate or net PnL.

The optimizer can tighten stale-data tolerance, raise the market-making edge requirement, and pause losing paper strategy loops. It does not loosen risk settings, does not enable real trading, does not use private keys, and does not send orders.

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

## Live Pre-flight

Live trading is still disabled by default. Before any future live incubation, run:

```bash
npm run preflight
```

The pre-flight validation fails closed unless all live requirements pass:

- wallet connection checked
- Polymarket auth checked
- required token approvals checked
- USDC balance checked
- API connection healthy
- required env vars present
- `MODE=live`
- `ENABLE_LIVE_TRADING=true`
- `REAL_TRADING_ENABLED=true`
- `LIVE_TRADING=true`
- risk limits configured

The command never prints secret values. In the current safe paper config, it should fail and say live trading must remain locked.

## Auto-redeem

Resolved-market redemption is separated from strategy code:

```bash
npm run auto-redeem
```

The default config is safe:

```env
AUTO_REDEEM_ENABLED=false
AUTO_REDEEM_DRY_RUN=true
AUTO_REDEEM_INTERVAL_SECONDS=300
```

The auto-redeem service is allowed to detect resolved claimable markets and redeem winnings through a dedicated adapter in a future utility. It must never place new trades and must not be called by strategy modules.

## Safe Position Exits

Exit sizing lives in `src/execution/positionManager.ts`.

It enforces:

- positions are tracked by `market_id` and `token_side`
- sell size can never exceed current holdings
- proportional exits are calculated from actual holdings
- missing positions and invalid sizes are rejected before execution

This is execution safety logic, not strategy logic.

## Rejected Ideas

These are intentionally not allowed:

- Do not use `dangerously-skip-permissions`.
- Do not blindly copy top traders.
- Do not treat short-term profits as proof of edge.
- Do not allow leaderboard data to trigger live trades directly.
- Do not run commands that expose secrets.
- Do not allow strategy modules to place orders directly.

Wallet and leaderboard tracking may exist only as a research module under `src/research/wallet_tracking/`. It can store observations and hypotheses, but it must not trigger live trades or bypass the risk manager.

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

Run live pre-flight checks. This should fail while paper safety is active:

```bash
npm run preflight
```

Run the disabled/dry-run auto-redeem utility:

```bash
npm run auto-redeem
```

Build compiled JavaScript:

```bash
npm run build
```

## Important Notes

Polymarket may restrict trading from some locations. This bot does not bypass restrictions or platform rules. The live trading module checks the public geoblock endpoint before any future live implementation, but Version 1 blocks live trading before order placement is even possible.

Paper trading is a simulator. It uses visible public order book liquidity and public trade data, but it cannot perfectly predict real fills, hidden liquidity, latency, fees, or order matching behavior.
