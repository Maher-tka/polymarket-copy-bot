export default function SettingsPanel({ state }) {
  const audit = state.audit_summary || {};
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Settings</h2>
        <span>Safe defaults</span>
      </div>
      <div className="row"><span>Mode</span><strong>{state.mode}</strong></div>
      <div className="row"><span>REAL safety</span><strong>{state.mode === "REAL" ? "Runtime confirm required" : "Disabled"}</strong></div>
      <div className="row"><span>Strategies</span><strong>Calibration / Microstructure / Spread</strong></div>
      <div className="row"><span>Emergency stop</span><strong>Always visible</strong></div>
      <div className="row"><span>Live loop</span><strong>{state.loop_running ? "Active" : "Idle"}</strong></div>
      <div className="row"><span>Data source</span><strong>{state.data_source || "idle"}</strong></div>
      <div className="row"><span>Edge model</span><strong>Fees + slippage + resolution + time</strong></div>
      <div className="row"><span>Exposure model</span><strong>Market + correlated group caps</strong></div>
      <div className="row"><span>Research audit</span><strong>{Number(audit.signals || 0)} signals · {Number(audit.paper_trades || 0)} fills</strong></div>
      <p className="muted">News and smart-money are disabled by default.</p>
    </section>
  );
}
