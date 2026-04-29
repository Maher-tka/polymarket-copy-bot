export default function RiskPanel({ state }) {
  return (
    <section className="panel">
      <h2>Risk Status</h2>
      <RiskLine label="Blocked" value={(state.blocked_reasons || []).length ? "Yes" : "No"} />
      <RiskLine label="Drawdown" value={`${((state.max_drawdown_pct || 0) * 100).toFixed(1)}%`} />
      <RiskLine label="Cash Reserve" value="20%" />
      <RiskLine label="Exposure" value={`$${(state.positions || []).reduce((t, p) => t + (p.cost_basis || 0), 0).toFixed(2)}`} />
      {(state.blocked_reasons || []).map((reason) => <div className="badge danger" key={reason}>{reason}</div>)}
    </section>
  );
}

function RiskLine({ label, value }) {
  return <div className="row"><span>{label}</span><strong>{value}</strong></div>;
}
