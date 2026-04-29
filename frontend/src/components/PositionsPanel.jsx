export default function PositionsPanel({ positions }) {
  return (
    <section className="panel">
      <h2>Positions</h2>
      <table>
        <thead><tr><th>Market</th><th>Shares</th><th>Cost</th><th>Value</th></tr></thead>
        <tbody>{positions.length === 0 ? <tr><td colSpan="4">No positions</td></tr> : positions.map((p) => (
          <tr key={p.market_id}><td>{p.market_id}</td><td>{Number(p.shares).toFixed(3)}</td><td>${Number(p.cost_basis).toFixed(2)}</td><td>${Number(p.market_value).toFixed(2)}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}
