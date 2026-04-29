from collections import defaultdict

from backend.app.config import Settings
from backend.app.strategy.signal_types import AggregatedDecision, Decision, Signal


WEIGHTS = {
    "calibration_arbitrage": 0.40,
    "microstructure": 0.30,
    "spread_capture": 0.20,
    "smart_money": 0.10,
}


class SignalAggregator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def aggregate(self, market_id: str, signals: list[Signal]) -> AggregatedDecision:
        if not signals:
            return AggregatedDecision(market_id, Decision.HOLD, 0.0, 0.0, ["No active signals."], {})

        by_side: dict[str, float] = defaultdict(float)
        components: dict[str, float] = {}
        expected_edge = 0.0
        reasons: list[str] = []

        for signal in signals:
            weight = WEIGHTS.get(signal.strategy, 0.0)
            weighted_score = weight * normalize(signal.score)
            by_side[signal.side] += weighted_score
            components[signal.strategy] = round(weighted_score, 4)
            expected_edge = max(expected_edge, signal.expected_edge)
            reasons.extend(signal.reasons)

        yes_score = by_side["YES"]
        no_score = by_side["NO"]
        final_score = max(yes_score, no_score)
        if final_score < self.settings.final_score_threshold:
            decision = Decision.HOLD
            reasons.append(f"Final score {final_score:.2f} below threshold {self.settings.final_score_threshold:.2f}.")
        elif expected_edge < self.settings.min_expected_edge:
            decision = Decision.HOLD
            reasons.append(f"Expected edge {expected_edge:.2%} below minimum {self.settings.min_expected_edge:.2%}.")
        else:
            decision = Decision.BUY_YES if yes_score >= no_score else Decision.BUY_NO

        return AggregatedDecision(
            market_id=market_id,
            decision=decision,
            final_score=round(final_score, 4),
            expected_edge=round(expected_edge, 4),
            reasons=reasons,
            components=components,
        )


def normalize(value: float) -> float:
    return max(-1.0, min(1.0, value))
