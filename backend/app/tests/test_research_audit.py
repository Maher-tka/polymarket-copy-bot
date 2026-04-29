from types import SimpleNamespace

from backend.app.analytics.research_audit import ResearchAuditLog
from backend.app.strategy.signal_types import Decision


def test_research_audit_writes_signal_and_trade_rows(tmp_path) -> None:
    audit = ResearchAuditLog(tmp_path)
    market = SimpleNamespace(id="m1", question="Will audit logging work?")
    decision = SimpleNamespace(
        decision=Decision.BUY_YES,
        final_score=0.77,
        expected_edge=0.08,
        components={"microstructure": 0.3},
        reasons=["strong book"],
    )
    risk = SimpleNamespace(accepted=True, adjusted_edge=0.056, reasons=[])

    audit.log_decision(market, decision, risk)
    audit.log_trade(
        {
            "market_id": "m1",
            "question": "Will audit logging work?",
            "decision": "BUY_YES",
            "size_usd": 10,
            "shares": 20,
            "avg_price": 0.5,
            "partial": False,
            "fees_usd": 0,
            "slippage_usd": 0,
            "signal_source": "microstructure",
            "adjusted_edge": 0.056,
        }
    )

    assert audit.summary()["signals"] == 1
    assert audit.summary()["paper_trades"] == 1
