import fs from "fs";
import path from "path";
import {
  StrategyDiagnosticRecord,
  StrategyEngineState,
  StrategyOpportunity,
  StrategyPaperTrade,
  StrategyRejection
} from "../types";

type RecordKind = "opportunity" | "paperTrade" | "rejection" | "diagnostic" | "orderBookSnapshot";

export class LocalDatabase {
  private snapshotsRecorded = 0;
  private lastSnapshotAt?: string;

  constructor(private readonly rootDir = path.join(process.cwd(), "data")) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  recordOpportunity(opportunity: StrategyOpportunity): void {
    this.append("opportunity", opportunity);
  }

  recordPaperTrade(trade: StrategyPaperTrade): void {
    this.append("paperTrade", trade);
  }

  recordPaperTradeUpdate(trade: StrategyPaperTrade): void {
    this.append("paperTrade", trade);
  }

  recordRejection(rejection: StrategyRejection): void {
    this.append("rejection", rejection);
  }

  recordDiagnostic(record: StrategyDiagnosticRecord): void {
    this.append("diagnostic", record);
  }

  readRecords<T>(kind: RecordKind): T[] {
    const file = this.filePath(kind);
    if (!fs.existsSync(file)) return [];

    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line).value as T];
        } catch {
          return [];
        }
      });
  }

  readLatestRecords<T extends { id?: string }>(kind: RecordKind): T[] {
    const newestFirst = this.readRecords<T>(kind).reverse();
    const byId = new Map<string, T>();
    const results: T[] = [];

    for (const record of newestFirst) {
      const key = record.id;
      if (key && byId.has(key)) continue;
      if (key) byId.set(key, record);
      results.push(record);
    }

    return results;
  }

  readRecentRecords<T extends { id?: string }>(kind: RecordKind, limit: number): T[] {
    return this.readLatestRecords<T>(kind).slice(0, limit);
  }

  countRecords(kind: RecordKind): number {
    const file = this.filePath(kind);
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length;
  }

  recordOrderBookSnapshot(snapshot: unknown): void {
    this.snapshotsRecorded += 1;
    this.lastSnapshotAt = new Date().toISOString();
    this.append("orderBookSnapshot", snapshot);
  }

  getRecorderStatus(): { snapshotsRecorded: number; lastSnapshotAt?: string; path: string } {
    return {
      snapshotsRecorded: Math.max(this.snapshotsRecorded, this.countRecords("orderBookSnapshot")),
      lastSnapshotAt: this.lastSnapshotAt,
      path: this.filePath("orderBookSnapshot")
    };
  }

  exportPaperTradesCsv(state: StrategyEngineState): string {
    const rows = [
      [
        "id",
        "strategy",
        "market",
        "side",
        "shares",
        "entryCostUsd",
        "exitValueUsd",
        "realizedPnlUsd",
        "unrealizedPnlUsd",
        "feesUsd",
        "slippageUsd",
        "edge",
        "fillRate",
        "status",
        "openedAt",
        "closedAt"
      ],
      ...state.paperTrades.map((trade) => [
        trade.id,
        trade.strategy,
        trade.marketTitle ?? "",
        trade.side,
        trade.shares,
        trade.entryCostUsd,
        trade.exitValueUsd ?? "",
        trade.realizedPnlUsd,
        trade.unrealizedPnlUsd,
        trade.feesUsd,
        trade.slippageUsd,
        trade.edge,
        trade.fillRate,
        trade.status,
        trade.openedAt,
        trade.closedAt ?? ""
      ])
    ];

    return rows.map((row) => row.map(csvCell).join(",")).join("\n");
  }

  private append(kind: RecordKind, value: unknown): void {
    fs.appendFileSync(this.filePath(kind), `${JSON.stringify({ kind, recordedAt: new Date().toISOString(), value })}\n`);
  }

  private filePath(kind: RecordKind): string {
    return path.join(this.rootDir, `${kind}.jsonl`);
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
