export default function SettingsPanel({ state }) {
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
      <p className="muted">News and smart-money are disabled by default.</p>
    </section>
  );
}
