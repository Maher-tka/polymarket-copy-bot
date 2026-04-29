export default function MarketTable({ decisions }) {
  return (
    <section className="panel">
      <h2>Market Signals</h2>
      <table>
        <thead><tr><th>Market</th><th>Score</th><th>Edge</th><th>Decision</th></tr></thead>
        <tbody>
          {decisions.length === 0 ? <tr><td colSpan="4">No decisions yet.</td></tr> : decisions.map((item, index) => (
            <tr key={`${item.market_id}-${index}`}>
              <td>{item.market_id}</td>
              <td>{Number(item.score || 0).toFixed(2)}</td>
              <td>{(Number(item.edge || 0) * 100).toFixed(1)}%</td>
              <td>{item.decision}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
