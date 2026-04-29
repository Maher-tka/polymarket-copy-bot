export default function TradeHistory({ trades }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Trade History</h2>
        <span>{trades.length} recent</span>
      </div>
      <table>
        <thead><tr><th>Mode</th><th>Market</th><th>Decision</th><th>Size</th></tr></thead>
        <tbody>{trades.length === 0 ? <tr><td colSpan="4"><span className="emptyState compact">No trades recorded.</span></td></tr> : trades.map((trade, index) => (
          <tr key={`${trade.market_id}-${index}`}>
            <td>{trade.mode}</td>
            <td>{trade.market_id}</td>
            <td>{trade.decision}</td>
            <td>${Number(trade.size_usd).toFixed(2)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
