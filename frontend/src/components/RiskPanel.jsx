export default function RiskPanel({ state }) {
  const exposure = (state.positions || []).reduce((total, position) => total + Number(position.cost_basis || 0), 0);
  const nav = Number(state.nav || 0);
  const exposurePct = nav > 0 ? exposure / nav : 0;
  const drawdown = Number(state.max_drawdown_pct || 0);
  const dailyLossUsed = Math.max(0, Number(state.daily_pnl || 0) < 0 ? Math.abs(Number(state.daily_pnl)) / Math.max(nav * 0.05, 1) : 0);

  return (
    <section className="panel riskPanel">
      <div className="panelHeader">
        <h2>Risk Meter</h2>
        <span>{(state.blocked_reasons || []).length ? "Action blocked" : "Limits clear"}</span>
      </div>
      <RiskMeter label="Exposure" value={exposurePct} helper={`$${exposure.toFixed(2)} deployed`} />
      <RiskMeter label="Daily loss usage" value={dailyLossUsed} helper="Limit is 5% NAV" />
      <RiskMeter label="Drawdown" value={drawdown} helper="Stop at 10%" />
      <RiskLine label="Cash reserve" value="20% minimum" />
      <RiskLine label="Orderbook freshness" value={state.stale_data ? "Stale" : "Fresh"} />
      <div className="blockList">
        {(state.blocked_reasons || []).length === 0 ? <span className="riskGood">No active block reasons</span> : null}
        {(state.blocked_reasons || []).map((reason) => <div className="badge danger" key={reason}>{reason}</div>)}
      </div>
    </section>
  );
}

function RiskLine({ label, value }) {
  return <div className="row"><span>{label}</span><strong>{value}</strong></div>;
}

function RiskMeter({ label, value, helper }) {
  const width = `${Math.max(0, Math.min(100, value * 100))}%`;
  return (
    <div className="riskMeter">
      <div className="riskMeterTop"><span>{label}</span><strong>{(value * 100).toFixed(1)}%</strong></div>
      <div className="riskTrack"><div style={{ width }} /></div>
      <small>{helper}</small>
    </div>
  );
}
