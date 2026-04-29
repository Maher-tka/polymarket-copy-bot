import { botAction } from "../api";

export default function BotControls({ onRefresh }) {
  async function run(action) {
    await botAction(action);
    await onRefresh();
  }

  return (
    <section className="panel controls">
      <button onClick={() => run("start")}>Start</button>
      <button onClick={() => run("pause")}>Pause</button>
      <button onClick={() => run("stop")}>Stop</button>
      <button onClick={() => run("demo-tick")}>Demo Tick</button>
      <button className="dangerButton" onClick={() => run("emergency-stop")}>Emergency Stop</button>
    </section>
  );
}
