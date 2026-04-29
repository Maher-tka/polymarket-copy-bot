export default function PositionsPanel({ positions }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Open Positions</h2>
        <span>{positions.length} active</span>
      </div>
      <table>
        <thead><tr><th>Market</th><th>Shares</th><th>Cost / Value</th><th>PnL</th></tr></thead>
        <tbody>{positions.length === 0 ? <tr><td colSpan="4"><span className="emptyState compact">No open positions.</span></td></tr> : positions.map((position) => (
          <tr key={position.market_id}>
            <td>
              <strong>{position.question || position.market_id}</strong>
              <span>{position.side}</span>
            </td>
            <td>{Number(position.shares).toFixed(3)}</td>
            <td>
              <strong>${Number(position.cost_basis).toFixed(2)} / ${Number(position.market_value).toFixed(2)}</strong>
              <span>{Number(position.avg_price || 0).toFixed(3)} entry · {Number(position.current_price || 0).toFixed(3)} now</span>
            </td>
            <td>
              <strong className={Number(position.unrealized_pnl || 0) >= 0 ? "pnlPositive" : "pnlNegative"}>
                {money(position.unrealized_pnl)}
              </strong>
              <span>{(Number(position.pnl_pct || 0) * 100).toFixed(2)}%</span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function money(value) {
  const numeric = Number(value || 0);
  return `${numeric < 0 ? "-" : ""}$${Math.abs(numeric).toFixed(2)}`;
}
