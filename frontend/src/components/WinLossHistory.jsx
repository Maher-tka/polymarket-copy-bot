export default function WinLossHistory({ history = [], summary = {} }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Win / Loss History</h2>
        <span>{history.length} open mark-to-market</span>
      </div>

      <div className="historySummary">
        <MiniStat label="Open wins" value={summary.open_wins || 0} tone="positive" />
        <MiniStat label="Open losses" value={summary.open_losses || 0} tone="negative" />
        <MiniStat label="Win rate" value={`${(Number(summary.open_win_rate || 0) * 100).toFixed(1)}%`} />
        <MiniStat label="Open PnL" value={money(summary.open_unrealized_pnl)} tone={Number(summary.open_unrealized_pnl || 0) >= 0 ? "positive" : "negative"} />
      </div>

      <table>
        <thead>
          <tr><th>Status</th><th>Market</th><th>Entry / Now</th><th>PnL</th></tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr><td colSpan="4"><span className="emptyState compact">No paper wins or losses yet.</span></td></tr>
          ) : history.map((item) => (
            <tr key={`${item.market_id}-${item.opened_at || ""}`}>
              <td><span className={`outcomeBadge ${toneFor(item.status)}`}>{labelFor(item.status)}</span></td>
              <td>
                <strong>{item.question || item.market_id}</strong>
                <span>{item.side} · {Number(item.shares || 0).toFixed(3)} shares</span>
              </td>
              <td>
                <strong>{price(item.avg_price)} / {price(item.current_price)}</strong>
                <span>{dateTime(item.opened_at)}</span>
              </td>
              <td>
                <strong className={Number(item.pnl || 0) >= 0 ? "pnlPositive" : "pnlNegative"}>{money(item.pnl)}</strong>
                <span>{(Number(item.pnl_pct || 0) * 100).toFixed(2)}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MiniStat({ label, value, tone = "" }) {
  return (
    <div className={`miniStat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function labelFor(status) {
  if (status === "WIN") return "Winning";
  if (status === "LOSS") return "Losing";
  return "Flat";
}

function toneFor(status) {
  if (status === "WIN") return "win";
  if (status === "LOSS") return "loss";
  return "flat";
}

function money(value) {
  const numeric = Number(value || 0);
  return `${numeric < 0 ? "-" : ""}$${Math.abs(numeric).toFixed(2)}`;
}

function price(value) {
  return Number(value || 0).toFixed(3);
}

function dateTime(value) {
  if (!value) return "Open position";
  return new Date(Number(value) * 1000).toLocaleString();
}
