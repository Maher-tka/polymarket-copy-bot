import { useState } from "react";
import { Activity, BarChart3, Gauge, History, Shield } from "lucide-react";

import BotControls from "./BotControls.jsx";
import BucketPerformancePanel from "./BucketPerformancePanel.jsx";
import FearSellerPanel from "./FearSellerPanel.jsx";
import LogsPanel from "./LogsPanel.jsx";
import MarketTable from "./MarketTable.jsx";
import NicheCopyPanel from "./NicheCopyPanel.jsx";
import OrderbookPanel from "./OrderbookPanel.jsx";
import PnlChart from "./PnlChart.jsx";
import PositionsPanel from "./PositionsPanel.jsx";
import RiskPanel from "./RiskPanel.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import Sidebar from "./Sidebar.jsx";
import SignalBreakdown from "./SignalBreakdown.jsx";
import StatCard from "./StatCard.jsx";
import TopStatusBar from "./TopStatusBar.jsx";
import TradeHistory from "./TradeHistory.jsx";
import WinLossHistory from "./WinLossHistory.jsx";

export default function Dashboard({ state, onRefresh }) {
  const [activeView, setActiveView] = useState("overview");
  const positions = state.positions || [];
  const trades = state.trades || [];
  const decisions = state.last_decisions || [];
  const winLossHistory = state.win_loss_history || [];
  const performanceSummary = state.performance_summary || {};
  const exposure = positions.reduce((total, position) => total + Number(position.cost_basis || 0), 0);
  const dailyPnl = Number(state.daily_pnl || 0);

  return (
    <main className="appShell">
      <Sidebar activeView={activeView} onChange={setActiveView} state={state} />
      <section className="workspace">
        <TopStatusBar state={state} onRefresh={onRefresh} />

        <div className="workspaceHeader">
          <div>
            <span className="eyebrow">Polymarket research console</span>
            <h1>{activeView === "overview" ? greeting(state.mode) : titleFor(activeView)}</h1>
            <p>{state.mode} mode · {state.status} · {Number(state.scanned_markets || 0)} markets scanned</p>
          </div>
          <BotControls onRefresh={onRefresh} />
        </div>

        {state.mode === "REAL" ? (
          <section className="realModeBanner">
            REAL mode is enabled. Every order must pass risk checks and runtime confirmation.
          </section>
        ) : null}

        <section className="statGrid">
          <StatCard label="Net Asset Value" value={money(state.nav)} helper="Paper portfolio" icon={<BarChart3 size={17} />} />
          <StatCard label="Cash Balance" value={money(state.balance)} helper="Buying power" icon={<Activity size={17} />} />
          <StatCard label="Daily PnL" value={money(dailyPnl)} helper="Mark-to-market" tone={dailyPnl >= 0 ? "positive" : "negative"} icon={<History size={17} />} />
          <StatCard label="Open Exposure" value={money(exposure)} helper={`${positions.length} active position${positions.length === 1 ? "" : "s"}`} icon={<Shield size={17} />} />
          <StatCard label="Live Cycles" value={Number(state.cycle_count || 0)} helper={`${Number(state.scanned_markets || 0)} scanned`} icon={<Gauge size={17} />} />
        </section>

        {activeView === "overview" ? (
          <>
            <section className="heroGrid">
              <PortfolioHero state={state} exposure={exposure} performanceSummary={performanceSummary} />
              <PnlChart state={state} />
            </section>
            <section className="contentGrid primary overviewSplit">
              <RiskPanel state={state} />
              <OrderbookPanel state={state} />
            </section>
            <section className="contentGrid single">
              <BucketPerformancePanel buckets={state.bucket_performance || []} />
            </section>
            <section className="contentGrid single">
              <NicheCopyPanel summary={state.niche_copy || {}} />
            </section>
            <section className="contentGrid single">
              <FearSellerPanel summary={state.fear_seller || {}} />
            </section>
            <section className="contentGrid primary">
              <SignalBreakdown decisions={decisions} />
              <WinLossHistory history={winLossHistory} summary={performanceSummary} />
            </section>
            <section className="contentGrid single">
              <MarketTable decisions={decisions} markets={state.markets || []} compact />
            </section>
          </>
        ) : null}

        {activeView === "scanner" ? (
          <section className="contentGrid scanner">
            <MarketTable decisions={decisions} markets={state.markets || []} />
            <div className="stack">
              <BucketPerformancePanel buckets={state.bucket_performance || []} />
              <NicheCopyPanel summary={state.niche_copy || {}} />
              <SignalBreakdown decisions={decisions} />
              <OrderbookPanel state={state} />
            </div>
          </section>
        ) : null}

        {activeView === "risk" ? (
          <section className="contentGrid primary">
            <RiskPanel state={state} />
            <PositionsPanel positions={positions} />
          </section>
        ) : null}

        {activeView === "fear" ? (
          <section className="contentGrid single">
            <FearSellerPanel summary={state.fear_seller || {}} />
          </section>
        ) : null}

        {activeView === "copy" ? (
          <section className="contentGrid single">
            <NicheCopyPanel summary={state.niche_copy || {}} />
          </section>
        ) : null}

        {activeView === "activity" ? (
          <section className="contentGrid primary">
            <div className="stack">
              <WinLossHistory history={winLossHistory} summary={performanceSummary} />
              <TradeHistory trades={trades} />
            </div>
            <LogsPanel logs={state.logs || []} />
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="contentGrid primary">
            <SettingsPanel state={state} />
            <OrderbookPanel state={state} />
          </section>
        ) : null}
      </section>
    </main>
  );
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function titleFor(view) {
  const titles = {
    overview: "Command Center",
    scanner: "Market Scanner",
    risk: "Risk & Exposure",
    activity: "Trades & Logs",
    fear: "Fear Seller",
    copy: "Top Trader Copy",
    settings: "Settings",
  };
  return titles[view] || "Command Center";
}

function greeting(mode) {
  return mode === "REAL" ? "Real Mode Command" : "Welcome back, Paper Lab";
}

function PortfolioHero({ state, exposure, performanceSummary }) {
  const dailyPnl = Number(state.daily_pnl || 0);
  return (
    <section className="portfolioHero">
      <div className="heroTopline">
        <span>Portfolio value</span>
        <strong className={dailyPnl >= 0 ? "pnlPositive" : "pnlNegative"}>{dailyPnl >= 0 ? "+" : ""}{money(dailyPnl)}</strong>
      </div>
      <div className="heroBalance">{money(state.nav)}</div>
      <div className="heroMeta">
        <div><span>Cash</span><strong>{money(state.balance)}</strong></div>
        <div><span>Exposure</span><strong>{money(exposure)}</strong></div>
        <div><span>Open PnL</span><strong>{money(performanceSummary.open_unrealized_pnl)}</strong></div>
      </div>
    </section>
  );
}
