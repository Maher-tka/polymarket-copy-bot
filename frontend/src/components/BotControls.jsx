import { Pause, Play, RotateCw, Square } from "lucide-react";
import { useState } from "react";

import { botAction } from "../api";

export default function BotControls({ onRefresh }) {
  const [error, setError] = useState("");

  async function run(action) {
    try {
      setError("");
      await botAction(action);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="controls">
      <button onClick={() => run("start")} title="Start bot"><Play size={16} /> Start</button>
      <button onClick={() => run("pause")} title="Pause bot"><Pause size={16} /> Pause</button>
      <button onClick={() => run("stop")} title="Stop bot"><Square size={16} /> Stop</button>
      <button onClick={() => run("demo-tick")} title="Run a paper demo tick"><RotateCw size={16} /> Demo Tick</button>
      {error ? <span className="controlError">{error}</span> : null}
    </section>
  );
}
