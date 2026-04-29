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
    <section className="panel controls">
      <button onClick={() => run("start")}>Start</button>
      <button onClick={() => run("pause")}>Pause</button>
      <button onClick={() => run("stop")}>Stop</button>
      <button onClick={() => run("demo-tick")}>Demo Tick</button>
      <button className="dangerButton" onClick={() => run("emergency-stop")}>Emergency Stop</button>
      {error ? <span className="controlError">{error}</span> : null}
    </section>
  );
}
