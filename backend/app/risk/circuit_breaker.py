from dataclasses import dataclass, field


@dataclass
class CircuitBreaker:
    emergency_stop: bool = False
    paused: bool = False
    blocked_reasons: list[str] = field(default_factory=list)

    def block(self, reason: str) -> None:
        if reason not in self.blocked_reasons:
            self.blocked_reasons.append(reason)

    def clear_runtime_blocks(self) -> None:
        self.blocked_reasons.clear()

    @property
    def trading_allowed(self) -> bool:
        return not self.emergency_stop and not self.paused and not self.blocked_reasons
