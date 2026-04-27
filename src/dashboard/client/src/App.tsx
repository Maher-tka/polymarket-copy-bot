import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  CircleDollarSign,
  Clock3,
  Cpu,
  Download,
  Gauge,
  History,
  LayoutDashboard,
  ListFilter,
  Lock,
  Pause,
  Play,
  Radio,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Signal,
  Skull,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
  Zap
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClosedPosition,
  CopySignal,
  DashboardState,
  EquityPoint,
  LogEvent,
  PaperPosition,
  SkippedTrade,
  StrategyName,
  TraderScore
} from "@/lib/types";
import { clamp, cn, duration, money, percent, shortWallet, timeAgo } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Positions", icon: Wallet },
  { label: "Signals", icon: Signal },
  { label: "Traders", icon: Users },
  { label: "Risk", icon: ShieldAlert },
  { label: "Logs", icon: ScrollText },
  { label: "Settings", icon: Settings }
];

const SUMMARY_KEYS = [
  "balanceUsd",
  "equityUsd",
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "dailyRealizedPnlUsd",
  "winRate",
  "maxDrawdownUsd",
  "openPositions"
] as const;

const STRATEGY_TABS: Array<{ id: StrategyName; label: string }> = [
  { id: "net-arbitrage", label: "Arbitrage" },
  { id: "maker-arbitrage", label: "Maker Arbitrage" },
  { id: "market-making", label: "Market Making" },
  { id: "whale-tracker", label: "Whale Tracker" }
];

type SummaryKey = (typeof SUMMARY_KEYS)[number];

interface Filters {
  signalStatus: string;
  signalSide: string;
  signalSearch: string;
  logLevel: string;
  logSearch: string;
  tradeResult: string;
}

export function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const [strategyTab, setStrategyTab] = useState<StrategyName>("net-arbitrage");
  const [filters, setFilters] = useState<Filters>({
    signalStatus: "all",
    signalSide: "all",
    signalSearch: "",
    logLevel: "all",
    logSearch: "",
    tradeResult: "all"
  });
  const previousSummary = useRef<Record<SummaryKey, number> | null>(null);

  useEffect(() => {
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;

    const applyState = (next: DashboardState) => {
      setState(next);
      setLoading(false);
      setError(null);
      const now = new Date().toLocaleTimeString();
      setLastUpdated(now);
      setEquityHistory((history) =>
        [
          ...history,
          {
            time: now,
            equity: next.portfolio.equityUsd,
            realized: next.portfolio.realizedPnlUsd,
            unrealized: next.portfolio.unrealizedPnlUsd
          }
        ].slice(-120)
      );
    };

    const fetchState = async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        applyState((await response.json()) as DashboardState);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load dashboard state.");
        setLoading(false);
      }
    };

    fetchState();

    if ("EventSource" in window) {
      const source = new EventSource("/api/events");
      source.onopen = () => setSseConnected(true);
      source.onmessage = (event) => {
        setSseConnected(true);
        applyState(JSON.parse(event.data) as DashboardState);
      };
      source.onerror = () => {
        setSseConnected(false);
        source.close();
        fallbackTimer = setInterval(fetchState, 2000);
      };

      return () => {
        source.close();
        if (fallbackTimer) clearInterval(fallbackTimer);
      };
    }

    fallbackTimer = setInterval(fetchState, 2000);
    return () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, []);

  const summaryValues = useMemo(() => {
    if (!state) return null;
    return {
      balanceUsd: state.portfolio.balanceUsd,
      equityUsd: state.portfolio.equityUsd,
      realizedPnlUsd: state.portfolio.realizedPnlUsd,
      unrealizedPnlUsd: state.portfolio.unrealizedPnlUsd,
      dailyRealizedPnlUsd: state.portfolio.dailyRealizedPnlUsd,
      winRate: state.portfolio.winRate,
      maxDrawdownUsd: state.portfolio.maxDrawdownUsd,
      openPositions: state.portfolio.openPositions.length
    };
  }, [state]);

  const changedKeys = useMemo(() => {
    if (!summaryValues) return new Set<SummaryKey>();
    const changed = new Set<SummaryKey>();
    if (previousSummary.current) {
      for (const key of SUMMARY_KEYS) {
        if (previousSummary.current[key] !== summaryValues[key]) changed.add(key);
      }
    }
    previousSummary.current = summaryValues;
    return changed;
  }, [summaryValues]);

  const skippedBySignal = useMemo(() => {
    const map = new Map<string, SkippedTrade>();
    state?.portfolio.skippedTrades.forEach((skip) => {
      if (skip.signalId) map.set(skip.signalId, skip);
    });
    return map;
  }, [state]);

  const exposureUsd = useMemo(
    () => state?.portfolio.openPositions.reduce((total, position) => total + position.costBasisUsd, 0) ?? 0,
    [state]
  );
  const exposureLimit = (state?.safeConfig.maxMarketExposureUsd ?? 1) * Math.max(1, state?.safeConfig.maxOpenPositions ?? 1);
  const exposureUsage = clamp((exposureUsd / exposureLimit) * 100);
  const dailyLossUsed = state
    ? clamp((Math.max(0, -state.portfolio.dailyRealizedPnlUsd) / Math.max(1, state.safeConfig.maxDailyLossUsd)) * 100)
    : 0;

  const filteredSignals = useMemo(() => {
    if (!state) return [];
    return state.portfolio.latestSignals.filter((signal) => {
      const status = signalStatus(signal, state, skippedBySignal);
      const haystack = `${signal.traderName ?? ""} ${signal.traderWallet} ${signal.marketTitle ?? ""} ${signal.outcome ?? ""}`.toLowerCase();
      return (
        (filters.signalStatus === "all" || status.toLowerCase() === filters.signalStatus) &&
        (filters.signalSide === "all" || signal.side === filters.signalSide) &&
        haystack.includes(filters.signalSearch.toLowerCase())
      );
    });
  }, [filters.signalSearch, filters.signalSide, filters.signalStatus, skippedBySignal, state]);

  const filteredLogs = useMemo(() => {
    if (!state) return [];
    return state.logs.filter((log) => {
      const matchesLevel = filters.logLevel === "all" || log.level === filters.logLevel;
      const matchesText = `${log.message} ${JSON.stringify(log.meta ?? "")}`.toLowerCase().includes(filters.logSearch.toLowerCase());
      return matchesLevel && matchesText;
    });
  }, [filters.logLevel, filters.logSearch, state]);

  const filteredClosedPositions = useMemo(() => {
    if (!state) return [];
    return state.portfolio.closedPositions.filter((position) => {
      if (filters.tradeResult === "all") return true;
      return filters.tradeResult === "win" ? position.realizedPnlUsd > 0 : position.realizedPnlUsd <= 0;
    });
  }, [filters.tradeResult, state]);

  const runAction = async (path: string, body?: unknown) => {
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  };

  if (loading) return <LoadingScreen />;
  if (error && !state) return <ErrorScreen error={error} />;
  if (!state) return <ErrorScreen error="Dashboard state is unavailable." />;

  const botKilled = state.risk.killSwitchActive;
  const botPaused = state.risk.paused;
  const botStatus = botKilled ? "Killed" : botPaused ? "Paused" : "Running";

  return (
    <div className="min-h-screen bg-background terminal-grid">
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="min-w-0 flex-1">
          <Header
            state={state}
            botStatus={botStatus}
            lastUpdated={lastUpdated}
            sseConnected={sseConnected}
            onPause={() => runAction("/api/pause")}
            onResume={() => runAction("/api/resume")}
            onKill={() => runAction("/api/kill-switch", { active: true })}
          />

          <main className="space-y-4 p-4 lg:p-6">
            <PaperModeBanner mode={state.mode} />

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <SummaryCard title="Balance" value={money(state.portfolio.balanceUsd)} icon={CircleDollarSign} changed={changedKeys.has("balanceUsd")} />
              <SummaryCard title="Equity" value={money(state.portfolio.equityUsd)} icon={Wallet} changed={changedKeys.has("equityUsd")} />
              <SummaryCard
                title="Realized PnL"
                value={money(state.portfolio.realizedPnlUsd)}
                icon={TrendingUp}
                tone={state.portfolio.realizedPnlUsd >= 0 ? "positive" : "negative"}
                changed={changedKeys.has("realizedPnlUsd")}
              />
              <SummaryCard
                title="Unrealized PnL"
                value={money(state.portfolio.unrealizedPnlUsd)}
                icon={Activity}
                tone={state.portfolio.unrealizedPnlUsd >= 0 ? "positive" : "negative"}
                changed={changedKeys.has("unrealizedPnlUsd")}
              />
              <SummaryCard
                title="Daily PnL"
                value={money(state.portfolio.dailyRealizedPnlUsd)}
                icon={BarChart3}
                tone={state.portfolio.dailyRealizedPnlUsd >= 0 ? "positive" : "negative"}
                changed={changedKeys.has("dailyRealizedPnlUsd")}
              />
              <SummaryCard title="Win Rate" value={percent(state.portfolio.winRate)} icon={Gauge} changed={changedKeys.has("winRate")} />
              <SummaryCard title="Max Drawdown" value={money(state.portfolio.maxDrawdownUsd)} icon={TrendingDown} tone="negative" changed={changedKeys.has("maxDrawdownUsd")} />
              <SummaryCard title="Open Positions" value={String(state.portfolio.openPositions.length)} icon={History} changed={changedKeys.has("openPositions")} />
            </section>

            <StrategyTabsPanel
              state={state}
              activeTab={strategyTab}
              setActiveTab={setStrategyTab}
              onEmergencyStop={() => runAction("/api/strategy-emergency-stop", { active: true })}
              onClearEmergencyStop={() => runAction("/api/strategy-emergency-stop", { active: false })}
            />

            <WhyBotIsLosingPanel state={state} />

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(380px,0.9fr)]">
              <div className="space-y-4">
                <EquityChart data={equityHistory} />
                <OpenPositionsTable positions={state.portfolio.openPositions} />
                <ClosedPositionsTable positions={filteredClosedPositions} filters={filters} setFilters={setFilters} />
              </div>

              <div className="space-y-4">
                <SignalsFeed signals={filteredSignals} state={state} skippedBySignal={skippedBySignal} filters={filters} setFilters={setFilters} />
                <WatchedTradersTable traders={state.watchedTraders} />
                <RiskPanel state={state} exposureUsd={exposureUsd} exposureUsage={exposureUsage} dailyLossUsed={dailyLossUsed} />
                <HealthPanel state={state} sseConnected={sseConnected} />
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <SkippedTradesPanel skipped={state.portfolio.skippedTrades} />
              <LogsPanel title="Bot Logs" logs={filteredLogs} filters={filters} setFilters={setFilters} />
              <LatencyPanel state={state} logs={state.logs} />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card/70 p-4 backdrop-blur xl:block">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold">Copy Bot</div>
          <div className="text-xs text-muted-foreground">Trading terminal</div>
        </div>
      </div>
      <nav className="space-y-1">
        {NAV_ITEMS.map((item, index) => (
          <button
            key={item.label}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground",
              index === 0 && "bg-accent text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mt-8 rounded-lg border border-border bg-background/70 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Lock className="h-3.5 w-3.5" />
          Version 1 guardrail
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Live order placement remains disabled in code.</p>
      </div>
    </aside>
  );
}

function Header({
  state,
  botStatus,
  lastUpdated,
  sseConnected,
  onPause,
  onResume,
  onKill
}: {
  state: DashboardState;
  botStatus: string;
  lastUpdated?: string;
  sseConnected: boolean;
  onPause: () => void;
  onResume: () => void;
  onKill: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/88 px-4 py-3 backdrop-blur lg:px-6">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-normal">Polymarket Copy-Trading Bot</h1>
            <ModeBadge mode={state.mode} />
            <Badge variant={state.strategies?.activeMode === "Real" ? "destructive" : "default"}>
              {state.strategies?.activeMode ?? "Paper"} mode
            </Badge>
            <StatusBadge label={botStatus} active={botStatus === "Running"} destructive={botStatus === "Killed"} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <ConnectionBadge label="API" connected={state.status.apiConnected} />
            <ConnectionBadge label="SSE" connected={sseConnected} />
            <ConnectionBadge label="WebSocket" connected={state.status.marketWebSocketConnected} />
            <ConnectionBadge label="Polling" connected={state.status.backupPollingConnected} />
            <ConnectionBadge label="Telegram" connected={state.status.telegramConfigured} mutedWhenOff />
            <Badge variant="outline">
              <Clock3 className="h-3 w-3" />
              Updated {lastUpdated ?? "loading"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onPause}>
            <Pause className="h-4 w-4" />
            Pause
          </Button>
          <Button variant="secondary" onClick={onResume}>
            <Play className="h-4 w-4" />
            Resume
          </Button>
          <Button variant="destructive" onClick={onKill}>
            <Skull className="h-4 w-4" />
            Kill Switch
          </Button>
        </div>
      </div>
    </header>
  );
}

function StrategyTabsPanel({
  state,
  activeTab,
  setActiveTab,
  onEmergencyStop,
  onClearEmergencyStop
}: {
  state: DashboardState;
  activeTab: StrategyName;
  setActiveTab: (strategy: StrategyName) => void;
  onEmergencyStop: () => void;
  onClearEmergencyStop: () => void;
}) {
  const strategyState = state.strategies;
  const opportunities = strategyState?.opportunities.filter((item) => item.strategy === activeTab) ?? [];
  const paperTrades = strategyState?.paperTrades.filter((item) => item.strategy === activeTab) ?? [];
  const rejections = strategyState?.rejectedSignals.filter((item) => item.strategy === activeTab) ?? [];
  const metrics = strategyState?.metrics.find((item) => item.strategy === activeTab);

  return (
    <Card className="border-primary/20 bg-card/95 shadow-glow">
      <CardHeader className="items-start">
        <div>
          <CardTitle>Multi-Strategy Engine</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            Paper-first strategies measuring edge after fees, slippage, fill quality, stale data, and failed fills.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={strategyState?.realTradingEnabled ? "destructive" : "success"}>
            {strategyState?.realTradingEnabled ? "REAL ENV ENABLED" : "REAL OFF"}
          </Badge>
          <Badge variant={strategyState?.emergencyStopped ? "destructive" : "success"}>
            {strategyState?.emergencyStopped ? "Emergency stopped" : "Engine active"}
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/export/paper-trades.csv">
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
          {strategyState?.emergencyStopped ? (
            <Button variant="secondary" size="sm" onClick={onClearEmergencyStop}>
              <Play className="h-4 w-4" />
              Clear Stop
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={onEmergencyStop}>
              <XCircle className="h-4 w-4" />
              Emergency Stop
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-background/60 p-1">
          {STRATEGY_TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition",
                activeTab === tab.id && "bg-primary/15 text-primary"
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label="Sim PnL" value={money(metrics?.simulatedPnlUsd ?? 0)} positive={(metrics?.simulatedPnlUsd ?? 0) >= 0} />
          <MetricTile label="Win Rate" value={percent(metrics?.winRate ?? 0)} />
          <MetricTile label="Max DD" value={money(metrics?.maxDrawdownUsd ?? 0)} positive={false} />
          <MetricTile label="Fill Rate" value={percent(metrics?.fillRate ?? 0)} />
          <MetricTile label="Avg Edge" value={`${((metrics?.averageEdge ?? 0) * 100).toFixed(2)}%`} positive={(metrics?.averageEdge ?? 0) > 0} />
          <MetricTile label="Avg Slip" value={money(metrics?.averageSlippage ?? 0)} positive={false} />
        </div>

        <div className="grid gap-4 2xl:grid-cols-[1.1fr_1fr]">
          <LiveOpportunitiesTable opportunities={opportunities} />
          <StrategyPaperTradesTable trades={paperTrades} />
        </div>

        <div className="grid gap-4 2xl:grid-cols-[1.1fr_1fr]">
          <RejectedSignalsPanel rejections={rejections} />
          <StrategyRecorderPanel state={state} />
        </div>
      </CardContent>
    </Card>
  );
}

function LiveOpportunitiesTable({ opportunities }: { opportunities: NonNullable<DashboardState["strategies"]>["opportunities"] }) {
  return (
    <Card className="bg-background/45">
      <CardHeader>
        <CardTitle>Live Opportunities</CardTitle>
        <Badge variant={opportunities.length ? "default" : "outline"}>{opportunities.length}</Badge>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <EmptyState icon={Search} title="Scanning for edge" body="Positive-edge opportunities and cost-adjusted rejects will appear here." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-separate border-spacing-0">
              <thead className="table-head">
                <tr>
                  {["Market", "Edge", "Raw", "Net", "Depth", "Latency", "Status"].map((head) => (
                    <th key={head} className="px-3 py-2">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {opportunities.slice(0, 16).map((item) => (
                  <tr key={item.id} className="transition hover:bg-accent/35">
                    <td className="table-cell max-w-[260px]">
                      <div className="truncate font-medium">{item.marketTitle ?? shortWallet(item.conditionId)}</div>
                      <div className="text-xs text-muted-foreground">{strategyLabel(item.strategy)}</div>
                    </td>
                    <td className={cn("table-cell font-semibold", item.edge > 0 ? "text-emerald-300" : "text-red-300")}>{(item.edge * 100).toFixed(2)}%</td>
                    <td className="table-cell">{item.rawCost?.toFixed(3) ?? "-"}</td>
                    <td className="table-cell">{item.netCost?.toFixed(3) ?? "-"}</td>
                    <td className="table-cell">{money(item.depthUsd ?? 0, true)}</td>
                    <td className="table-cell">{item.latencyMs ?? "-"}ms</td>
                    <td className="table-cell"><StrategyStatusBadge status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StrategyPaperTradesTable({ trades }: { trades: NonNullable<DashboardState["strategies"]>["paperTrades"] }) {
  return (
    <Card className="bg-background/45">
      <CardHeader>
        <CardTitle>Paper Trades</CardTitle>
        <Badge variant={trades.length ? "success" : "outline"}>{trades.length}</Badge>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <EmptyState icon={Wallet} title="No strategy paper fills yet" body="Accepted opportunities will simulate realistic fills from current order book depth." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0">
              <thead className="table-head">
                <tr>
                  {["Market", "Side", "Shares", "PnL", "Fees", "Slippage", "Fill", "Opened"].map((head) => (
                    <th key={head} className="px-3 py-2">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 16).map((trade) => {
                  const pnl = trade.realizedPnlUsd + trade.unrealizedPnlUsd;
                  return (
                    <tr key={trade.id} className="transition hover:bg-accent/35">
                      <td className="table-cell max-w-[250px]">
                        <div className="truncate font-medium">{trade.marketTitle ?? shortWallet(trade.conditionId)}</div>
                        <div className="text-xs text-muted-foreground">{strategyLabel(trade.strategy)}</div>
                      </td>
                      <td className="table-cell">{trade.side}</td>
                      <td className="table-cell">{trade.shares.toFixed(3)}</td>
                      <td className={cn("table-cell font-semibold", pnl >= 0 ? "text-emerald-300" : "text-red-300")}>{money(pnl)}</td>
                      <td className="table-cell">{money(trade.feesUsd)}</td>
                      <td className="table-cell">{money(trade.slippageUsd)}</td>
                      <td className="table-cell">{percent(trade.fillRate)}</td>
                      <td className="table-cell text-muted-foreground">{timeAgo(trade.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RejectedSignalsPanel({ rejections }: { rejections: NonNullable<DashboardState["strategies"]>["rejectedSignals"] }) {
  return (
    <Card className="bg-background/45">
      <CardHeader>
        <CardTitle>Rejected Signals</CardTitle>
        <Badge variant={rejections.length ? "warning" : "success"}>{rejections.length}</Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[240px] pr-3">
          {rejections.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No strategy rejections" body="Risk and edge rejections will be shown with visible reasons." compact />
          ) : (
            <div className="space-y-2">
              {rejections.slice(0, 24).map((rejection) => (
                <div key={rejection.id} className="rounded-md border border-border bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium">{rejection.marketTitle ?? shortWallet(rejection.conditionId)}</div>
                    <div className="text-xs text-muted-foreground">{timeAgo(rejection.createdAt)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rejection.reasons.slice(0, 4).map((reason) => (
                      <Badge key={reason} variant="destructive">{reason}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function StrategyRecorderPanel({ state }: { state: DashboardState }) {
  const strategyState = state.strategies;
  return (
    <Card className="bg-background/45">
      <CardHeader>
        <CardTitle>Recorder / Backtest</CardTitle>
        <Badge variant={strategyState?.recorder.enabled ? "success" : "outline"}>{strategyState?.recorder.enabled ? "Recording" : "Off"}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <RiskLine label="Snapshots recorded" value={String(strategyState?.recorder.snapshotsRecorded ?? 0)} />
        <RiskLine label="Last snapshot" value={timeAgo(strategyState?.recorder.lastSnapshotAt)} />
        <RiskLine label="Replay snapshots" value={String(strategyState?.backtest.availableSnapshots ?? 0)} />
        <RiskLine label="Backtest mode" value={strategyState?.backtest.enabled ? "Enabled" : "Disabled"} />
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          Live order book snapshots are written to local JSONL files for future replay. Historical replay is scaffolded around those snapshots.
        </div>
      </CardContent>
    </Card>
  );
}

function WhyBotIsLosingPanel({ state }: { state: DashboardState }) {
  const summary = state.strategies?.losingDiagnostics;
  if (!summary) return null;

  const netPositive = summary.netPnlUsd >= 0;

  return (
    <Card className="border-amber-500/25 bg-card/95">
      <CardHeader className="items-start">
        <div>
          <CardTitle>Why We Are Losing / Rejecting</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            Quote-level diagnostics explain whether edge, delay, spread, slippage, fees, or fill quality is hurting paper results.
          </div>
        </div>
        <Badge variant={netPositive ? "success" : "destructive"}>{netPositive ? "Net positive" : "Net negative"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <MetricTile label="Total Signals" value={String(summary.totalSignals)} />
          <MetricTile label="Trades Taken" value={String(summary.tradesTaken)} />
          <MetricTile label="Rejected" value={String(summary.rejectedSignals)} positive={false} />
          <MetricTile label="Win Rate" value={percent(summary.winRate)} />
          <MetricTile label="Net PnL" value={money(summary.netPnlUsd)} positive={summary.netPnlUsd >= 0} />
          <MetricTile label="Gross PnL" value={money(summary.grossPnlUsd)} positive={summary.grossPnlUsd >= 0} />
          <MetricTile label="Quote Fees" value={money(summary.estimatedFeesUsd)} positive={false} />
          <MetricTile label="Quote Slippage" value={money(summary.estimatedSlippageUsd)} positive={false} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
          <div className="rounded-lg border border-border bg-background/55 p-4">
            <div className="mb-3 text-sm font-semibold">Execution Quality</div>
            <div className="grid gap-2 text-sm">
              <RiskLine label="Average raw edge" value={`${(summary.averageRawEdge * 100).toFixed(2)}%`} danger={summary.averageRawEdge < 0} />
              <RiskLine label="Average net edge" value={`${(summary.averageNetEdge * 100).toFixed(2)}%`} danger={summary.averageNetEdge < 0} />
              <RiskLine label="Average spread" value={summary.averageSpread.toFixed(4)} />
              <RiskLine label="Average data delay" value={`${summary.averageDataDelayMs.toFixed(0)}ms`} />
              <RiskLine label="Average depth" value={money(summary.averageDepthUsd)} />
              <RiskLine label="Failed fills" value={String(summary.failedFills)} danger={summary.failedFills > 0} />
              <RiskLine label="Partial fills" value={String(summary.partialFills)} danger={summary.partialFills > 0} />
              <RiskLine label="Failed hedges" value={String(summary.failedHedges)} danger={summary.failedHedges > 0} />
              <RiskLine label="Too close to close" value={String(summary.tradesTooCloseToClose)} danger={summary.tradesTooCloseToClose > 0} />
              <RiskLine label="Average actual edge" value={`${(summary.averageActualEdge * 100).toFixed(2)}%`} danger={summary.averageActualEdge < 0} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/55 p-4">
            <div className="mb-3 text-sm font-semibold">Loss Causes</div>
            <div className="grid gap-2 text-sm">
              <RiskLine label="Fees" value={String(summary.lossesCausedByFees)} danger={summary.lossesCausedByFees > 0} />
              <RiskLine label="Slippage" value={String(summary.lossesCausedBySlippage)} danger={summary.lossesCausedBySlippage > 0} />
              <RiskLine label="Stale data" value={String(summary.lossesCausedByStaleData)} danger={summary.lossesCausedByStaleData > 0} />
              <RiskLine label="Illiquidity" value={String(summary.lossesCausedByIlliquidity)} danger={summary.lossesCausedByIlliquidity > 0} />
              <RiskLine label="Best trade" value={summary.bestTrade ? `${money(summary.bestTrade.realizedPnlUsd + summary.bestTrade.unrealizedPnlUsd)} ${strategyLabel(summary.bestTrade.strategy)}` : "Waiting"} />
              <RiskLine label="Worst trade" value={summary.worstTrade ? `${money(summary.worstTrade.realizedPnlUsd + summary.worstTrade.unrealizedPnlUsd)} ${summary.worstTrade.lossReason ?? strategyLabel(summary.worstTrade.strategy)}` : "Waiting"} danger={Boolean(summary.worstTrade)} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/55 p-4">
            <div className="mb-3 text-sm font-semibold">Top Rejection Reasons</div>
            {summary.rejectionReasons.length === 0 ? (
              <EmptyState icon={ShieldAlert} title="No rejects yet" body="The diagnostic engine is waiting for strategy signals." compact />
            ) : (
              <div className="flex flex-wrap gap-2">
                {summary.rejectionReasons.slice(0, 8).map((item) => (
                  <Badge key={item.reason} variant="warning">
                    {item.count}x {item.reason}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background/55 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Strategy Ranking</div>
            <Badge variant="outline">Ranks after 100 trades or 1000 signals</Badge>
          </div>
          <div className="grid gap-2 lg:grid-cols-5">
            {summary.strategyRanking.map((item) => (
              <div key={item.strategy} className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold">{item.label}</div>
                  <Badge variant={item.status === "real-locked-positive" || item.status === "paper-candidate" ? "success" : item.status === "losing" ? "destructive" : "outline"}>
                    {item.status === "real-locked-positive"
                      ? "positive"
                      : item.status === "paper-candidate"
                        ? "paper >60%"
                        : item.status === "losing"
                          ? "losing"
                          : "testing"}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <MiniDatum label="PnL" value={money(item.netPnlUsd)} />
                  <MiniDatum label="Trades" value={String(item.trades)} />
                  <MiniDatum label="Signals" value={String(item.signals)} />
                  <MiniDatum label="Net edge" value={`${(item.averageNetEdge * 100).toFixed(2)}%`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PaperModeBanner({ mode }: { mode: "PAPER" | "LIVE" }) {
  const live = mode === "LIVE";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border px-4 py-3",
        live ? "border-red-500/50 bg-red-500/12 text-red-100" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      )}
    >
      <div className="flex items-center gap-3">
        {live ? <AlertTriangle className="h-5 w-5 text-red-300" /> : <ShieldAlert className="h-5 w-5 text-emerald-300" />}
        <div>
          <div className="text-sm font-semibold">{live ? "LIVE TRADING ACTIVE" : "PAPER MODE - NO REAL MONEY"}</div>
          <div className="text-xs text-muted-foreground">
            {live ? "Real orders would be active." : "Signals and positions are simulated with fake paper balance."}
          </div>
        </div>
      </div>
      <Badge variant={live ? "destructive" : "success"}>{live ? "LIVE" : "SAFE PAPER"}</Badge>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  tone = "neutral",
  changed
}: {
  title: string;
  value: string;
  icon: typeof Activity;
  tone?: "neutral" | "positive" | "negative";
  changed?: boolean;
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-300" : tone === "negative" ? "text-red-300" : "text-foreground";
  return (
    <Card className={cn("overflow-hidden bg-card/90 transition", changed && "animate-flash")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className={cn("mt-3 text-2xl font-semibold tracking-normal", toneClass)}>{value}</div>
      </CardContent>
    </Card>
  );
}

function EquityChart({ data }: { data: EquityPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity / PnL</CardTitle>
        <Badge variant="outline">Real-time SSE</Badge>
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <EmptyState icon={BarChart3} title="Building chart history" body="Waiting for live portfolio updates..." />
        ) : (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height={320} minWidth={300} minHeight={260}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="equity" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="unrealized" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2937" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={{
                    background: "#080f1d",
                    border: "1px solid #263244",
                    borderRadius: 8,
                    color: "#e5eefb"
                  }}
                  formatter={(value) => money(Number(value))}
                />
                <Area type="monotone" dataKey="equity" stroke="#2dd4bf" strokeWidth={2} fill="url(#equity)" />
                <Area type="monotone" dataKey="unrealized" stroke="#f59e0b" strokeWidth={1.5} fill="url(#unrealized)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenPositionsTable({ positions }: { positions: PaperPosition[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Positions</CardTitle>
        <Badge variant={positions.length ? "success" : "outline"}>{positions.length} open</Badge>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <EmptyState icon={Wallet} title="No open positions" body="Waiting for copy signals to pass filters and risk checks." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-0">
              <thead className="table-head">
                <tr>
                  {["Market", "Side", "Entry", "Current price", "Size", "Unrealized PnL", "Trader copied", "Time opened", "Status"].map((head) => (
                    <th key={head} className="px-3 py-2">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id} className="transition hover:bg-accent/35">
                    <td className="table-cell max-w-[260px]">
                      <div className="font-medium">{position.marketTitle ?? shortWallet(position.conditionId)}</div>
                      <div className="text-xs text-muted-foreground">{position.outcome ?? shortWallet(position.assetId)}</div>
                    </td>
                    <td className="table-cell"><SideBadge side={position.side ?? "BUY"} /></td>
                    <td className="table-cell">{position.avgEntryPrice.toFixed(3)}</td>
                    <td className="table-cell">{position.currentPrice.toFixed(3)}</td>
                    <td className="table-cell">{position.shares.toFixed(3)}</td>
                    <td className={cn("table-cell font-semibold", position.unrealizedPnlUsd >= 0 ? "text-emerald-300" : "text-red-300")}>
                      {money(position.unrealizedPnlUsd)}
                    </td>
                    <td className="table-cell">{shortWallet(position.traderCopied)}</td>
                    <td className="table-cell text-muted-foreground">{timeAgo(position.openedAt)}</td>
                    <td className="table-cell"><Badge variant="success">{position.status ?? "OPEN"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClosedPositionsTable({
  positions,
  filters,
  setFilters
}: {
  positions: ClosedPosition[];
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Closed Positions</CardTitle>
        <select className="select-input" value={filters.tradeResult} onChange={(event) => setFilters((prev) => ({ ...prev, tradeResult: event.target.value }))}>
          <option value="all">All results</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
        </select>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <EmptyState icon={History} title="No closed positions" body="Closed paper trades will appear here with result and duration." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-0">
              <thead className="table-head">
                <tr>
                  {["Market", "Side", "Entry", "Exit", "Size", "Realized PnL", "Duration", "Result"].map((head) => (
                    <th key={head} className="px-3 py-2">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id} className="transition hover:bg-accent/35">
                    <td className="table-cell max-w-[260px]">
                      <div className="font-medium">{position.marketTitle ?? shortWallet(position.conditionId)}</div>
                      <div className="text-xs text-muted-foreground">{position.outcome ?? shortWallet(position.assetId)}</div>
                    </td>
                    <td className="table-cell"><SideBadge side={position.side ?? "BUY"} /></td>
                    <td className="table-cell">{position.entryPrice.toFixed(3)}</td>
                    <td className="table-cell">{position.exitPrice.toFixed(3)}</td>
                    <td className="table-cell">{position.shares.toFixed(3)}</td>
                    <td className={cn("table-cell font-semibold", position.realizedPnlUsd >= 0 ? "text-emerald-300" : "text-red-300")}>
                      {money(position.realizedPnlUsd)}
                    </td>
                    <td className="table-cell text-muted-foreground">{duration(position.openedAt, position.closedAt)}</td>
                    <td className="table-cell"><Badge variant={position.realizedPnlUsd > 0 ? "success" : "destructive"}>{position.realizedPnlUsd > 0 ? "Win" : "Loss"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalsFeed({
  signals,
  state,
  skippedBySignal,
  filters,
  setFilters
}: {
  signals: CopySignal[];
  state: DashboardState;
  skippedBySignal: Map<string, SkippedTrade>;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  return (
    <Card>
      <CardHeader className="items-start">
        <div>
          <CardTitle>Latest Copy Signals</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">Real watched-wallet and demo paper signals</div>
        </div>
        <ListFilter className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative sm:col-span-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input className="control-input w-full pl-8" placeholder="Filter signals" value={filters.signalSearch} onChange={(event) => setFilters((prev) => ({ ...prev, signalSearch: event.target.value }))} />
          </div>
          <select className="select-input" value={filters.signalStatus} onChange={(event) => setFilters((prev) => ({ ...prev, signalStatus: event.target.value }))}>
            <option value="all">All status</option>
            <option value="filled">Filled</option>
            <option value="skipped">Skipped</option>
            <option value="watching">Watching</option>
          </select>
          <select className="select-input" value={filters.signalSide} onChange={(event) => setFilters((prev) => ({ ...prev, signalSide: event.target.value }))}>
            <option value="all">All sides</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>

        <ScrollArea className="h-[428px] pr-3">
          {signals.length === 0 ? (
            <EmptyState icon={Signal} title="Waiting for new watched-wallet trades..." body="Demo mode will also create fake paper signals when SIMULATE_SIGNALS=true." />
          ) : (
            <div className="space-y-3">
              {signals.map((signal) => {
                const status = signalStatus(signal, state, skippedBySignal);
                const currentPrice = currentSignalPrice(signal, state);
                const skip = skippedBySignal.get(signal.id);
                return (
                  <div key={signal.id} className="rounded-lg border border-border bg-background/60 p-3 transition hover:border-primary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <SideBadge side={signal.side} />
                          <Badge variant={signal.simulated ? "warning" : "default"}>{signal.simulated ? "DEMO PAPER" : "WATCHED"}</Badge>
                          <Badge variant={status === "Skipped" ? "destructive" : status === "Filled" ? "success" : "outline"}>{status}</Badge>
                        </div>
                        <div className="mt-2 truncate text-sm font-semibold">{signal.marketTitle ?? shortWallet(signal.conditionId)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {signal.outcome ?? shortWallet(signal.assetId)} copied from {signal.traderName ?? shortWallet(signal.traderWallet)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold">{signal.traderScore.toFixed(0)}</div>
                        <div className="text-xs text-muted-foreground">score</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <MiniDatum label="Detected" value={signal.traderPrice.toFixed(3)} />
                      <MiniDatum label="Current" value={currentPrice.toFixed(3)} />
                      <MiniDatum label="Time" value={timeAgo(signal.createdAt)} />
                    </div>
                    {skip && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {skip.reasons.slice(0, 3).map((reason) => (
                          <Badge key={reason} variant="destructive">{reason}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function WatchedTradersTable({ traders }: { traders: TraderScore[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watched Traders</CardTitle>
        <Badge variant={traders.length ? "success" : "outline"}>{traders.length} wallets</Badge>
      </CardHeader>
      <CardContent>
        {traders.length === 0 ? (
          <EmptyState icon={Users} title="No watched wallets selected" body="Auto-selection may be waiting for qualifying trader scores, or WATCHED_WALLETS is empty." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-separate border-spacing-0">
              <thead className="table-head">
                <tr>
                  {["Wallet", "Name", "Score", "PnL", "Win Rate", "Recent activity", "Status"].map((head) => (
                    <th key={head} className="px-3 py-2">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {traders.map((trader) => (
                  <tr key={trader.wallet} className="transition hover:bg-accent/35">
                    <td className="table-cell font-mono text-xs">{shortWallet(trader.wallet)}</td>
                    <td className="table-cell">{trader.userName ?? "Unnamed"}</td>
                    <td className="table-cell font-semibold text-primary">{trader.score.toFixed(1)}</td>
                    <td className={cn("table-cell font-semibold", trader.realizedPnlUsd >= 0 ? "text-emerald-300" : "text-red-300")}>{money(trader.realizedPnlUsd)}</td>
                    <td className="table-cell">{percent(trader.winRate)}</td>
                    <td className="table-cell text-muted-foreground">{trader.marketsTraded} markets</td>
                    <td className="table-cell"><Badge variant={trader.score >= 75 ? "success" : "warning"}>{trader.score >= 75 ? "Watching" : "Low score"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RiskPanel({
  state,
  exposureUsd,
  exposureUsage,
  dailyLossUsed
}: {
  state: DashboardState;
  exposureUsd: number;
  exposureUsage: number;
  dailyLossUsed: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk Status</CardTitle>
        <Badge variant={state.risk.killSwitchActive ? "destructive" : state.risk.paused ? "warning" : "success"}>
          {state.risk.killSwitchActive ? "Killed" : state.risk.paused ? "Paused" : "Normal"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <RiskLine label="Max trade size" value={money(state.safeConfig.maxTradeUsd)} />
        <RiskLine label="Max position size" value={percent(state.safeConfig.maxPositionSizePct)} />
        <RiskLine label="Max deployed capital" value={percent(state.safeConfig.maxDeployedCapitalPct)} />
        <RiskLine label="Min net arb edge" value={`${(state.safeConfig.minNetArbEdge * 100).toFixed(2)}%`} />
        <RiskLine label="Max stale data age" value={`${state.safeConfig.maxStaleDataMs}ms`} />
        <RiskLine label="Final entry buffer" value={`${state.safeConfig.finalEntryBufferSeconds}s`} />
        <RiskLine label="Forced close check" value={`${state.safeConfig.forcedRiskCheckSeconds}s`} />
        <RiskLine label="Crypto taker / maker fee" value={`${(state.safeConfig.cryptoTakerFeeRate * 100).toFixed(2)}% / ${(state.safeConfig.makerFeeRate * 100).toFixed(2)}%`} />
        <RiskLine label="MM min edge / max age" value={`${(state.safeConfig.marketMakingMinEdge * 100).toFixed(2)}% / ${state.safeConfig.marketMakingMaxDataAgeMs}ms`} />
        <RiskLine label="Current exposure" value={money(exposureUsd)} />
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Daily loss limit usage</span>
            <span>{dailyLossUsed.toFixed(0)}%</span>
          </div>
          <Progress value={dailyLossUsed} className={dailyLossUsed > 70 ? "[&>div]:bg-red-500" : "[&>div]:bg-amber-400"} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Exposure usage</span>
            <span>{exposureUsage.toFixed(0)}%</span>
          </div>
          <Progress value={exposureUsage} />
        </div>
        <RiskLine label="Open positions count" value={`${state.portfolio.openPositions.length}/${state.safeConfig.maxOpenPositions}`} />
        <RiskLine label="Errors count" value={`${state.risk.errorCount}/${state.risk.stopAfterErrors}`} />
        <RiskLine label="Kill switch status" value={state.risk.killSwitchActive ? "Active" : "Inactive"} danger={state.risk.killSwitchActive} />
      </CardContent>
    </Card>
  );
}

function HealthPanel({ state, sseConnected }: { state: DashboardState; sseConnected: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bot Health</CardTitle>
        <Badge variant={sseConnected ? "success" : "destructive"}>{sseConnected ? "Streaming" : "Fallback"}</Badge>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <HealthLine icon={Clock3} label="Last poll time" value={timeAgo(state.status.lastPollTime)} />
        <HealthLine icon={Signal} label="Last signal time" value={timeAgo(state.status.lastSimulatedSignalAt ?? state.portfolio.latestSignals[0]?.createdAt)} />
        <HealthLine icon={Wallet} label="Last trade time" value={timeAgo(state.portfolio.closedPositions[0]?.closedAt ?? state.portfolio.openPositions[0]?.openedAt)} />
        <HealthLine icon={Users} label="Last wallet activity detected" value={timeAgo(state.status.lastNewTradeDetectedAt)} />
        <HealthLine icon={Radio} label="WebSocket latency" value={state.status.webSocketLatencyMs === undefined ? "Waiting" : `${state.status.webSocketLatencyMs}ms`} />
        <HealthLine icon={Users} label="Watched wallets" value={String(state.status.watchedWalletCount)} />
        <HealthLine icon={Cpu} label="Active markets loaded" value={String(state.status.marketsLoaded)} />
      </CardContent>
    </Card>
  );
}

function SkippedTradesPanel({ skipped }: { skipped: SkippedTrade[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skipped Trades</CardTitle>
        <Badge variant={skipped.length ? "warning" : "success"}>{skipped.length}</Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[360px] pr-3">
          {skipped.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No skipped trades" body="Rejected signals will appear here with clear reason badges." />
          ) : (
            <div className="space-y-3">
              {skipped.map((skip) => (
                <div key={skip.id} className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{skip.signal?.marketTitle ?? shortWallet(skip.signalId)}</div>
                    <div className="text-xs text-muted-foreground">{timeAgo(skip.timestamp)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skip.reasons.map((reason) => (
                      <Badge key={reason} variant="destructive">{reason}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function LogsPanel({
  title,
  logs,
  filters,
  setFilters
}: {
  title: string;
  logs: LogEvent[];
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  const errorCount = logs.filter((log) => log.level === "error").length;
  return (
    <Card>
      <CardHeader className="items-start">
        <div>
          <CardTitle>{title}</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">{errorCount} errors in filtered view</div>
        </div>
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <input className="control-input" placeholder="Filter logs" value={filters.logSearch} onChange={(event) => setFilters((prev) => ({ ...prev, logSearch: event.target.value }))} />
          <select className="select-input" value={filters.logLevel} onChange={(event) => setFilters((prev) => ({ ...prev, logLevel: event.target.value }))}>
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <ScrollArea className="h-[286px] pr-3">
          {logs.length === 0 ? (
            <EmptyState icon={ScrollText} title="No logs match filters" body="Adjust the log level or search text." />
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="rounded-md border border-border bg-background/60 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={log.level === "error" ? "destructive" : log.level === "warn" ? "warning" : "outline"}>{log.level.toUpperCase()}</Badge>
                    <span className="text-muted-foreground">{timeAgo(log.timestamp)}</span>
                  </div>
                  <div className="mt-2 text-sm">{log.message}</div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function LatencyPanel({ state, logs }: { state: DashboardState; logs: LogEvent[] }) {
  const recentErrors = logs.filter((log) => log.level === "error").slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Error Logs & Latency</CardTitle>
        <Badge variant={recentErrors.length ? "destructive" : "success"}>{recentErrors.length ? "Attention" : "Clean"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <MiniDatum label="WS latency" value={state.status.webSocketLatencyMs === undefined ? "Waiting" : `${state.status.webSocketLatencyMs}ms`} />
          <MiniDatum label="Subscribed assets" value={String(state.status.marketWebSocketSubscribedAssets)} />
          <MiniDatum label="Last WS msg" value={timeAgo(state.status.lastMarketWebSocketMessageAt)} />
          <MiniDatum label="Demo interval" value={`${state.safeConfig.simulateSignalIntervalSeconds}s`} />
        </div>
        {recentErrors.length === 0 ? (
          <EmptyState icon={Zap} title="No recent bot errors" body="API, polling, and paper execution are currently clean." compact />
        ) : (
          <div className="space-y-2">
            {recentErrors.map((log) => (
              <div key={log.id} className="rounded-md border border-red-500/25 bg-red-500/10 p-2 text-sm text-red-100">
                {log.message}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-96" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Skeleton className="h-[520px]" />
        <Skeleton className="h-[520px]" />
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="max-w-lg border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="h-5 w-5" />
            Dashboard connection error
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{error}</p>
          <p>Check that the bot server is still running on port 3000.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, compact = false }: { icon: typeof Activity; title: string; body: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/45 text-center", compact ? "p-5" : "min-h-[190px] p-6")}>
      <Icon className="h-7 w-7 text-muted-foreground" />
      <div className="mt-3 text-sm font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function ModeBadge({ mode }: { mode: "PAPER" | "LIVE" }) {
  return <Badge variant={mode === "LIVE" ? "destructive" : "success"}>{mode}</Badge>;
}

function StatusBadge({ label, active, destructive }: { label: string; active?: boolean; destructive?: boolean }) {
  return <Badge variant={destructive ? "destructive" : active ? "success" : "warning"}>{label}</Badge>;
}

function ConnectionBadge({ label, connected, mutedWhenOff = false }: { label: string; connected: boolean; mutedWhenOff?: boolean }) {
  const Icon = connected ? Wifi : WifiOff;
  return (
    <Badge variant={connected ? "success" : mutedWhenOff ? "outline" : "destructive"}>
      <Icon className="h-3 w-3" />
      {label} {connected ? "connected" : "off"}
    </Badge>
  );
}

function SideBadge({ side }: { side: "BUY" | "SELL" }) {
  return <Badge variant={side === "BUY" ? "success" : "warning"}>{side}</Badge>;
}

function StrategyStatusBadge({ status }: { status: string }) {
  const variant =
    status === "filled" || status === "accepted" || status === "alert"
      ? "success"
      : status === "partial" || status === "missed" || status === "cancelled"
        ? "warning"
        : status === "rejected"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function MetricTile({ label, value, positive = true }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/55 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", positive ? "text-emerald-300" : "text-red-300")}>{value}</div>
    </div>
  );
}

function strategyLabel(strategy: string): string {
  switch (strategy) {
    case "net-arbitrage":
      return "Net Arbitrage";
    case "maker-arbitrage":
      return "Maker Arbitrage";
    case "market-making":
      return "Market Making";
    case "btc-momentum-filter":
      return "BTC Momentum Filter";
    case "whale-tracker":
      return "Whale Tracker";
    default:
      return strategy;
  }
}

function MiniDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function RiskLine({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", danger && "text-red-300")}>{value}</span>
    </div>
  );
}

function HealthLine({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/55 px-3 py-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function signalStatus(signal: CopySignal, state: DashboardState, skippedBySignal: Map<string, SkippedTrade>): "Filled" | "Skipped" | "Watching" {
  if (skippedBySignal.has(signal.id)) return "Skipped";
  const open = state.portfolio.openPositions.some((position) => position.sourceSignalId === signal.id || position.assetId === signal.assetId);
  const closed = state.portfolio.closedPositions.some((position) => position.sourceSignalId === signal.id || position.assetId === signal.assetId);
  return open || closed ? "Filled" : "Watching";
}

function currentSignalPrice(signal: CopySignal, state: DashboardState): number {
  const open = state.portfolio.openPositions.find((position) => position.assetId === signal.assetId);
  if (open) return open.currentPrice;
  const closed = state.portfolio.closedPositions.find((position) => position.assetId === signal.assetId);
  if (closed) return closed.exitPrice;
  return signal.traderPrice;
}
