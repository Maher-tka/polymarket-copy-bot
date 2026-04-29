import BotControls from "./BotControls.jsx";
import LogsPanel from "./LogsPanel.jsx";
import MarketTable from "./MarketTable.jsx";
import OrderbookPanel from "./OrderbookPanel.jsx";
import PnlChart from "./PnlChart.jsx";
import PositionsPanel from "./PositionsPanel.jsx";
import RiskPanel from "./RiskPanel.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import TradeHistory from "./TradeHistory.jsx";

export default function Dashboard({ state, onRefresh }) {
  const modeClass = state.mode === "REAL" ? "real" : "paper";
  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <h1>Polymarket Trading Bot</h1>
          <p>Calibration, microstructure, and spread-capture research system</p>
        </div>
        <div className={`mode ${modeClass}`}>{state.mode}</div>
        <Metric label="Status" value={state.status} />
        <Metric label="Balance" value={money(state.balance)} />
        <Metric label="NAV" value={money(state.nav)} />
        <Metric label="Daily PnL" value={money(state.daily_pnl)} />
      </header>

      <BotControls onRefresh={onRefresh} />

      <section className="grid two">
        <RiskPanel state={state} />
        <PnlChart state={state} />
      </section>

      <section className="grid two">
        <MarketTable decisions={state.last_decisions || []} />
        <OrderbookPanel state={state} />
      </section>

      <section className="grid two">
        <PositionsPanel positions={state.positions || []} />
        <TradeHistory trades={state.trades || []} />
      </section>

      <section className="grid two">
        <LogsPanel logs={state.logs || []} />
        <SettingsPanel state={state} />
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}
