import { MarketEvent, MarketEventType } from "../types";

export class MarketEventQueue {
  private readonly events: MarketEvent[] = [];
  private readonly history: MarketEvent[] = [];

  constructor(private readonly maxItems = 500) {}

  enqueue(event: Omit<MarketEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }): MarketEvent {
    const item: MarketEvent = {
      ...event,
      id: event.id ?? `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: event.timestamp ?? new Date().toISOString()
    };

    this.events.push(item);
    this.history.unshift(item);
    this.history.splice(this.maxItems);
    this.events.sort((a, b) => b.priority - a.priority || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    this.events.splice(this.maxItems);
    return item;
  }

  drain(limit = 25): MarketEvent[] {
    return this.events.splice(0, limit);
  }

  drainMatching(types: string[], limit = 25): MarketEvent[] {
    const matched: MarketEvent[] = [];
    for (let index = 0; index < this.events.length && matched.length < limit;) {
      const event = this.events[index];
      if (!types.includes(event.type)) {
        index += 1;
        continue;
      }
      matched.push(event);
      this.events.splice(index, 1);
    }
    return matched;
  }

  peek(limit = 50): MarketEvent[] {
    return this.history.slice(0, limit);
  }

  size(): number {
    return this.events.length;
  }
}

export function scoreEvent(type: MarketEventType, severity = 1): number {
  const base: Record<MarketEventType, number> = {
    "whale-trade": 85,
    "freshness-restored": 70,
    "spread-tightened": 65,
    "price-jump": 60,
    "liquidity-drop": 55,
    "freshness-lost": 45,
    "spread-widened": 40,
    "copy-signal": 75
  };
  return Math.min(100, Math.max(0, base[type] + severity * 5));
}
