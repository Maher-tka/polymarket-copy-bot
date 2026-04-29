export default function TradeHistory({ trades }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Trade History</h2>
        <span>{trades.length} recent</span>
      </div>
      <table>
        <thead><tr><th>Mode</th><th>Market</th><th>Entry</th><th>Size</th></tr></thead>
        <tbody>{trades.length === 0 ? <tr><td colSpan="4"><span className="emptyState compact">No trades recorded.</span></td></tr> : trades.map((trade, index) => (
          <tr key={`${trade.market_id}-${index}`}>
            <td>{trade.mode}</td>
            <td>
              <strong>{trade.question || trade.market_id}</strong>
              <span>{trade.decision} · {trade.signal_source || "aggregator"}</span>
            </td>
            <td>
              <strong>{Number(trade.avg_price || 0).toFixed(3)}</strong>
              <span>{dateTime(trade.created_at)}</span>
            </td>
            <td>
              <strong>${Number(trade.size_usd).toFixed(2)}</strong>
              <span>fees ${Number(trade.fees_usd || 0).toFixed(2)}</span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function dateTime(value) {
  if (!value) return "Recorded";
  return new Date(Number(value) * 1000).toLocaleString();
}
