import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function PnlChart({ state }) {
  const data = [{ name: "Start", nav: 1000 }, { name: "Now", nav: state.nav || 1000 }];
  return (
    <section className="panel">
      <h2>Live PnL</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="name" stroke="#9ca3af" />
          <YAxis stroke="#9ca3af" />
          <Tooltip />
          <Line dataKey="nav" stroke="#38bdf8" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
