export default function SettingsPanel({ state }) {
  return (
    <section className="panel">
      <h2>Settings</h2>
      <div className="row"><span>Mode</span><strong>{state.mode}</strong></div>
      <div className="row"><span>REAL safety</span><strong>{state.mode === "REAL" ? "Requires env confirmations" : "Disabled"}</strong></div>
      <div className="row"><span>Strategies</span><strong>Calibration / Microstructure / Spread</strong></div>
      <p className="muted">News and smart-money modules are present but disabled by default.</p>
    </section>
  );
}
