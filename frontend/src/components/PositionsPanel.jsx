export default function PositionsPanel({ positions }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Open Positions</h2>
        <span>{positions.length} active</span>
      </div>
      <table>
        <thead><tr><th>Market</th><th>Shares</th><th>Cost</th><th>Value</th></tr></thead>
        <tbody>{positions.length === 0 ? <tr><td colSpan="4"><span className="emptyState compact">No open positions.</span></td></tr> : positions.map((position) => (
          <tr key={position.market_id}>
            <td>{position.market_id}</td>
            <td>{Number(position.shares).toFixed(3)}</td>
            <td>${Number(position.cost_basis).toFixed(2)}</td>
            <td>${Number(position.market_value).toFixed(2)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
