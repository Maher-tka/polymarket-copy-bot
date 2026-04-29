import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function PnlChart({ state }) {
  const start = Number(state.nav || 1000) - Number(state.daily_pnl || 0);
  const data = [
    { name: "Open", nav: start },
    { name: "Mid", nav: start + Number(state.daily_pnl || 0) * 0.35 },
    { name: "Now", nav: Number(state.nav || 1000) },
  ];
  return (
    <section className="panel chartPanel">
      <div className="panelHeader">
        <h2>PnL Chart</h2>
        <span>NAV over session</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="name" stroke="#9ca3af" />
          <YAxis stroke="#9ca3af" />
          <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid #263447", borderRadius: 8 }} />
          <Area dataKey="nav" stroke="#38bdf8" strokeWidth={2} fill="url(#navFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
