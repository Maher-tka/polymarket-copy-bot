from backend.app.risk.correlation import infer_correlation_group


def test_infer_correlation_group_groups_same_championship_market():
    first = infer_correlation_group("Will the Colorado Avalanche win the 2026 NHL Stanley Cup?")
    second = infer_correlation_group("Will the Dallas Stars win the 2026 NHL Stanley Cup?")

    assert first == second
    assert first == "2026-nhl-stanley-cup"
