export default function TradeHistory({ trades }) {
  return (
    <section className="panel">
      <h2>Trade History</h2>
      <table>
        <thead><tr><th>Mode</th><th>Market</th><th>Decision</th><th>Size</th></tr></thead>
        <tbody>{trades.length === 0 ? <tr><td colSpan="4">No trades</td></tr> : trades.map((t, index) => (
          <tr key={index}><td>{t.mode}</td><td>{t.market_id}</td><td>{t.decision}</td><td>${Number(t.size_usd).toFixed(2)}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}
