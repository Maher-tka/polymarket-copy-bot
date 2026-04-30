export default function BucketPerformancePanel({ buckets = [] }) {
  return (
    <section className="panel tablePanel">
      <div className="panelHeader">
        <h2>Learning Buckets</h2>
        <span>Profit by market type</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Markets</th>
            <th>Decisions</th>
            <th>Trades</th>
            <th>Exposure</th>
            <th>Open PnL</th>
            <th>Open W/L</th>
          </tr>
        </thead>
        <tbody>
          {buckets.length === 0 ? (
            <tr><td colSpan="7"><span className="emptyState compact">No bucket learning data yet.</span></td></tr>
          ) : buckets.map((bucket) => (
            <tr key={bucket.bucket}>
              <td>
                <strong>{labelize(bucket.bucket)}</strong>
                <span>{Number(bucket.blocked || 0)} blocked · avg score {Number(bucket.avg_score || 0).toFixed(2)}</span>
              </td>
              <td>{Number(bucket.markets || 0)}</td>
              <td>{Number(bucket.decisions || 0)}</td>
              <td>{Number(bucket.trades || 0)}</td>
              <td>{money(bucket.exposure)}</td>
              <td><strong className={Number(bucket.open_pnl || 0) >= 0 ? "pnlPositive" : "pnlNegative"}>{money(bucket.open_pnl)}</strong></td>
              <td>{Number(bucket.wins || 0)} / {Number(bucket.losses || 0)} · {(Number(bucket.open_win_rate || 0) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function money(value) {
  const numeric = Number(value || 0);
  return `${numeric < 0 ? "-" : ""}$${Math.abs(numeric).toFixed(2)}`;
}

function labelize(value) {
  return String(value || "general").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
