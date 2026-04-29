import { AlertTriangle, Lock, Radio, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { botAction } from "../api";

export default function TopStatusBar({ state, onRefresh }) {
  const [error, setError] = useState("");
  const isReal = state.mode === "REAL";

  async function emergencyStop() {
    try {
      setError("");
      await botAction("emergency-stop");
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <header className="statusBar">
      <div className="statusPrimary">
        <div className={isReal ? "modeBadge real" : "modeBadge paper"}>
          {isReal ? <ShieldAlert size={22} /> : <Lock size={22} />}
          <div>
            <span>Mode</span>
            <strong>{state.mode}</strong>
          </div>
        </div>
        <StatusPill label="Bot" value={state.status} tone={state.status === "RUNNING" ? "good" : "idle"} />
        <StatusPill label="Market data" value={state.stale_data ? "Stale" : "Ready"} tone={state.stale_data ? "bad" : "good"} />
        <StatusPill label="Loop" value={state.loop_running ? "Active" : "Idle"} tone={state.loop_running ? "good" : "idle"} />
        <StatusPill label="WebSocket" value={state.websocket_connected ? "Live" : "Waiting"} tone={state.websocket_connected ? "good" : "idle"} icon={<Radio size={15} />} />
      </div>

      {isReal ? (
        <div className="realWarning">
          <AlertTriangle size={17} />
          <span>REAL mode can use real money. Runtime confirmation is required.</span>
        </div>
      ) : null}

      <button className="emergencyButton" onClick={emergencyStop} title="Emergency stop">
        <ShieldAlert size={18} />
        Emergency Stop
      </button>
      {error ? <span className="topError">{error}</span> : null}
    </header>
  );
}

function StatusPill({ label, value, tone = "idle", icon }) {
  return (
    <div className={`statusPill ${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
