import { useState } from "react";

import BotControls from "./BotControls.jsx";
import LogsPanel from "./LogsPanel.jsx";
import MarketTable from "./MarketTable.jsx";
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
            <h1>{titleFor(activeView)}</h1>
            <p>Paper-first strategy lab for calibration, orderbook imbalance, and spread capture.</p>
          </div>
          <BotControls onRefresh={onRefresh} />
        </div>

        {state.mode === "REAL" ? (
          <section className="realModeBanner">
            REAL mode is enabled. Every order must pass risk checks and runtime confirmation.
          </section>
        ) : null}

        <section className="statGrid">
          <StatCard label="Net Asset Value" value={money(state.nav)} helper="Fake balance in PAPER mode" />
          <StatCard label="Cash Balance" value={money(state.balance)} helper="Available buying power" />
          <StatCard label="Daily PnL" value={money(dailyPnl)} helper="Today only" tone={dailyPnl >= 0 ? "positive" : "negative"} />
          <StatCard label="Open Exposure" value={money(exposure)} helper={`${positions.length} active position${positions.length === 1 ? "" : "s"}`} />
          <StatCard label="Live Cycles" value={Number(state.cycle_count || 0)} helper={`${Number(state.scanned_markets || 0)} markets scanned last cycle`} />
        </section>

        {activeView === "overview" ? (
          <>
            <section className="contentGrid primary">
              <PnlChart state={state} />
              <RiskPanel state={state} />
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
    settings: "Settings",
  };
  return titles[view] || "Command Center";
}
