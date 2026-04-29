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
              <stop offset="0%" stopColor="#8b6cff" stopOpacity={0.34} />
              <stop offset="100%" stopColor="#8b6cff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="name" stroke="#8f8a9d" />
          <YAxis stroke="#8f8a9d" />
          <Tooltip contentStyle={{ background: "#111018", border: "1px solid #2b2739", borderRadius: 8 }} />
          <Area dataKey="nav" stroke="#8b6cff" strokeWidth={2} fill="url(#navFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
