from backend.app.config import Settings
from backend.app.strategy.signal_aggregator import SignalAggregator
from backend.app.strategy.signal_types import Decision, Signal


def test_signal_aggregator_weights_core_strategies():
    settings = Settings(_env_file=None)
    aggregator = SignalAggregator(settings)
    signals = [
        Signal("calibration_arbitrage", "m1", "YES", 1.0, 0.07, 1, ["calibration edge"]),
        Signal("microstructure", "m1", "YES", 0.8, 0.04, 1, ["imbalance"]),
        Signal("spread_capture", "m1", "YES", 0.7, 0.02, 1, ["spread"]),
    ]

    decision = aggregator.aggregate("m1", signals)

    assert decision.decision == Decision.BUY_YES
    assert decision.final_score >= settings.final_score_threshold
    assert decision.expected_edge == 0.07


def test_signal_aggregator_holds_when_score_is_low():
    settings = Settings(_env_file=None)
    decision = SignalAggregator(settings).aggregate("m1", [Signal("smart_money", "m1", "YES", 0.2, 0.1, 1, [])])

    assert decision.decision == Decision.HOLD
