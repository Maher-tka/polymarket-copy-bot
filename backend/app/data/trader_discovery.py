import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field

from backend.app.config import Settings
from backend.app.data.data_api import DataApi
from backend.app.data.gamma_api import has_any_token, infer_research_bucket, parse_csv


@dataclass(slots=True)
class TraderProfile:
    wallet: str
    name: str
    bucket: str
    score: float
    trades: int
    volume: float
    pnl: float
    win_rate: float
    last_seen: float

    def to_dict(self) -> dict:
        return {
            "wallet": self.wallet,
            "name": self.name,
            "bucket": self.bucket,
            "score": round(self.score, 4),
            "trades": self.trades,
            "volume": round(self.volume, 4),
            "pnl": round(self.pnl, 4),
            "win_rate": round(self.win_rate, 4),
            "last_seen": self.last_seen,
        }


@dataclass(slots=True)
class CopySignal:
    market_id: str
    bucket: str
    wallet: str
    trader_name: str
    trader_score: float
    side: str
    outcome: str
    source_price: float
    source_size: float
    timestamp: float
    reason: str

    def to_dict(self) -> dict:
        return {
            "market_id": self.market_id,
            "bucket": self.bucket,
            "wallet": self.wallet,
            "trader_name": self.trader_name,
            "trader_score": round(self.trader_score, 4),
            "side": self.side,
            "outcome": self.outcome,
            "source_price": round(self.source_price, 4),
            "source_size": round(self.source_size, 4),
            "timestamp": self.timestamp,
            "reason": self.reason,
        }


@dataclass
class TraderStats:
    wallet: str
    name: str = ""
    bucket: str = ""
    trades: int = 0
    volume: float = 0.0
    pnl: float = 0.0
    wins: int = 0
    losses: int = 0
    last_seen: float = 0.0
    recent_trades: list[dict] = field(default_factory=list)


class NicheTraderDiscovery:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.allowed_buckets = parse_csv(settings.market_allowed_buckets)
        self.top_traders_by_bucket: dict[str, list[TraderProfile]] = {}
        self.copy_signals_by_market: dict[str, CopySignal] = {}
        self.last_discovery_at: float | None = None
        self.last_poll_at: float | None = None
        self.last_error: str | None = None
        self._seen_trade_hashes: set[str] = set()
        self._discovery_task: asyncio.Task | None = None
        self._poll_task: asyncio.Task | None = None

    async def start(self) -> None:
        if not self.settings.enable_niche_copy_trading:
            return
        if self._discovery_task is None or self._discovery_task.done():
            self._discovery_task = asyncio.create_task(self._discovery_loop())
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        tasks = [task for task in (self._discovery_task, self._poll_task) if task and not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def signal_for_market(self, market_id: str) -> CopySignal | None:
        signal = self.copy_signals_by_market.get(market_id)
        if not signal:
            return None
        if time.time() - signal.timestamp > self.settings.copy_signal_ttl_seconds:
            self.copy_signals_by_market.pop(market_id, None)
            return None
        return signal

    def summary(self) -> dict:
        return {
            "enabled": self.settings.enable_niche_copy_trading,
            "requires_confirmation": self.settings.require_niche_copy_confirmation,
            "allowed_buckets": sorted(self.allowed_buckets),
            "min_trader_score": self.settings.copy_trade_min_trader_score,
            "last_discovery_at": self.last_discovery_at,
            "last_poll_at": self.last_poll_at,
            "last_error": self.last_error,
            "top_traders": {
                bucket: [profile.to_dict() for profile in profiles[: self.settings.copy_top_traders_per_bucket]]
                for bucket, profiles in self.top_traders_by_bucket.items()
            },
            "copy_signals": [signal.to_dict() for signal in self.copy_signals_by_market.values()],
        }

    async def _discovery_loop(self) -> None:
        while True:
            try:
                await self.refresh_top_traders()
                self.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
            await asyncio.sleep(self.settings.copy_trade_discovery_interval_seconds)

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self.poll_copy_trades()
                self.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
            await asyncio.sleep(self.settings.copy_trade_poll_seconds)

    async def refresh_top_traders(self) -> None:
        api = DataApi(self.settings)
        try:
            recent_trades = await self._recent_trades_pool(api)
            stats = self._candidate_stats(recent_trades)
            await self._attach_position_performance(api, stats)
        finally:
            await api.close()

        by_bucket: dict[str, list[TraderProfile]] = defaultdict(list)
        for stat in stats.values():
            profile = self._profile_from_stats(stat)
            by_bucket[profile.bucket].append(profile)

        self.top_traders_by_bucket = {
            bucket: sorted(profiles, key=lambda item: item.score, reverse=True)[: self.settings.copy_top_traders_per_bucket]
            for bucket, profiles in by_bucket.items()
        }
        self.last_discovery_at = time.time()

    async def _recent_trades_pool(self, api: DataApi) -> list[dict]:
        target = max(1, self.settings.copy_trade_discovery_trade_limit)
        page_size = min(500, target)
        trades: list[dict] = []
        seen: set[str] = set()
        for offset in range(0, target, page_size):
            page = await api.trades(limit=page_size, offset=offset)
            if not page:
                break
            for trade in page:
                key = str(trade.get("transactionHash") or f"{trade.get('proxyWallet')}:{trade.get('conditionId')}:{trade.get('timestamp')}")
                if key in seen:
                    continue
                seen.add(key)
                trades.append(trade)
            if len(page) < page_size:
                break
        return trades

    async def poll_copy_trades(self) -> None:
        if not self.top_traders_by_bucket:
            return
        approved = self._approved_wallets()
        if not approved:
            return

        api = DataApi(self.settings)
        try:
            trades = await api.trades(limit=100)
        finally:
            await api.close()

        now = time.time()
        for trade in trades:
            wallet = str(trade.get("proxyWallet") or "").lower()
            if wallet not in approved:
                continue
            if str(trade.get("side") or "").upper() != "BUY":
                continue
            if safe_float(trade.get("size")) < self.settings.copy_trade_min_size:
                continue
            timestamp = normalize_timestamp(trade.get("timestamp") or 0.0)
            if now - timestamp > self.settings.copy_trade_recent_seconds:
                continue
            tx_hash = str(trade.get("transactionHash") or f"{wallet}:{trade.get('conditionId')}:{timestamp}")
            if tx_hash in self._seen_trade_hashes:
                continue
            self._seen_trade_hashes.add(tx_hash)

            bucket = trade_bucket(trade)
            if bucket not in self.allowed_buckets:
                continue
            profile = approved[wallet].get(bucket)
            if not profile:
                continue
            signal = build_copy_signal(trade, bucket, profile)
            if signal:
                self.copy_signals_by_market[signal.market_id] = signal
        self._seen_trade_hashes = set(list(self._seen_trade_hashes)[-1000:])
        self.last_poll_at = now

    def _candidate_stats(self, trades: list[dict]) -> dict[tuple[str, str], TraderStats]:
        stats: dict[tuple[str, str], TraderStats] = {}
        for trade in trades:
            bucket = trade_bucket(trade)
            if bucket not in self.allowed_buckets:
                continue
            wallet = str(trade.get("proxyWallet") or "").lower()
            if not wallet:
                continue
            key = (wallet, bucket)
            stat = stats.setdefault(key, TraderStats(wallet=wallet, bucket=bucket))
            stat.name = str(trade.get("name") or trade.get("pseudonym") or wallet[:8])
            stat.trades += 1
            stat.volume += safe_float(trade.get("size")) * safe_float(trade.get("price"))
            stat.last_seen = max(stat.last_seen, normalize_timestamp(trade.get("timestamp") or 0.0))
            if len(stat.recent_trades) < 5:
                stat.recent_trades.append(trade)
        return dict(
            sorted(stats.items(), key=lambda item: (item[1].trades, item[1].volume, item[1].last_seen), reverse=True)[
                : self.settings.copy_trade_discovery_candidate_limit
            ]
        )

    async def _attach_position_performance(self, api: DataApi, stats: dict[tuple[str, str], TraderStats]) -> None:
        semaphore = asyncio.Semaphore(self.settings.copy_max_api_concurrency)

        async def attach(stat: TraderStats) -> None:
            async with semaphore:
                positions = await api.positions(stat.wallet, limit=self.settings.copy_trade_positions_limit)
            for position in positions:
                if trade_bucket(position) != stat.bucket:
                    continue
                pnl = safe_float(position.get("cashPnl") or position.get("realizedPnl"))
                stat.pnl += pnl
                if pnl > 0:
                    stat.wins += 1
                elif pnl < 0:
                    stat.losses += 1

        await asyncio.gather(*(attach(stat) for stat in stats.values()), return_exceptions=True)

    def _profile_from_stats(self, stat: TraderStats) -> TraderProfile:
        decided = stat.wins + stat.losses
        win_rate = stat.wins / decided if decided else 0.0
        pnl_score = max(0.0, min(1.0, (stat.pnl + 50) / 150))
        win_score = win_rate if decided else 0.45
        volume_score = max(0.0, min(1.0, stat.volume / 500))
        trade_score = max(0.0, min(1.0, stat.trades / 20))
        recency_score = max(0.0, min(1.0, 1 - (time.time() - stat.last_seen) / 86_400)) if stat.last_seen else 0.0
        score = 0.35 * win_score + 0.25 * pnl_score + 0.20 * trade_score + 0.10 * volume_score + 0.10 * recency_score
        return TraderProfile(
            wallet=stat.wallet,
            name=stat.name or stat.wallet[:8],
            bucket=stat.bucket,
            score=round(score, 4),
            trades=stat.trades,
            volume=stat.volume,
            pnl=stat.pnl,
            win_rate=win_rate,
            last_seen=stat.last_seen,
        )

    def _approved_wallets(self) -> dict[str, dict[str, TraderProfile]]:
        approved: dict[str, dict[str, TraderProfile]] = defaultdict(dict)
        for bucket, profiles in self.top_traders_by_bucket.items():
            for profile in profiles:
                if profile.score < self.settings.copy_trade_min_trader_score:
                    continue
                approved[profile.wallet.lower()][bucket] = profile
        return approved


def trade_bucket(item: dict) -> str:
    text = " ".join(
        str(item.get(key) or "")
        for key in ("title", "question", "asset", "outcome", "slug", "eventSlug")
    )
    outcome = str(item.get("outcome") or item.get("asset") or "").lower()
    if has_any_token(text.lower(), ("bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto")):
        if has_any_token(outcome, ("up", "above", "higher")):
            return "crypto_up"
        if has_any_token(outcome, ("down", "below", "lower")):
            return "crypto_down"
    return infer_research_bucket(text, item.get("slug") or item.get("eventSlug"))


def build_copy_signal(trade: dict, bucket: str, profile: TraderProfile) -> CopySignal | None:
    market_id = str(trade.get("conditionId") or "")
    if not market_id:
        return None
    outcome_index = int(trade.get("outcomeIndex") or 0)
    side = "YES" if outcome_index == 0 else "NO"
    price = safe_float(trade.get("price"))
    size = safe_float(trade.get("size"))
    timestamp = normalize_timestamp(trade.get("timestamp") or time.time())
    return CopySignal(
        market_id=market_id,
        bucket=bucket,
        wallet=profile.wallet,
        trader_name=profile.name,
        trader_score=profile.score,
        side=side,
        outcome=str(trade.get("outcome") or side),
        source_price=price,
        source_size=size,
        timestamp=timestamp,
        reason=f"Copied {profile.name} in {bucket}: {trade.get('outcome') or side} @ {price:.3f}.",
    )


def safe_float(value) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def normalize_timestamp(value) -> float:
    timestamp = safe_float(value)
    if timestamp > 10_000_000_000:
        return timestamp / 1000
    return timestamp
