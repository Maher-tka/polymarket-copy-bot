export default function MarketTable({ decisions, markets = [], compact = false }) {
  const rows = decisions.length ? decisions : markets.map((market) => ({
    market_id: market.id,
    question: market.question,
    score: 0,
    edge: 0,
    decision: "WATCH",
    risk_ok: true,
    research_bucket: market.research_bucket,
    reasons: [market.question],
  }));

  return (
    <section className="panel tablePanel">
      <div className="panelHeader">
        <h2>Market Scanner</h2>
        <span>{rows.length} market row{rows.length === 1 ? "" : "s"}</span>
      </div>
      <table className={compact ? "compactTable" : ""}>
        <thead><tr><th>Market</th><th>Score</th><th>Raw / net edge</th><th>Decision</th><th>Risk</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan="5"><span className="emptyState compact">No market signals yet.</span></td></tr> : rows.map((item, index) => (
            <tr key={`${item.market_id}-${index}`}>
              <td>
                <strong>{item.question || item.market_id}</strong>
                {!compact ? <span>{labelize(item.research_bucket || "general")} · {item.reasons?.[0] || ""}</span> : null}
              </td>
              <td><ScoreBadge value={item.score} /></td>
              <td>{(Number(item.edge || 0) * 100).toFixed(1)}% / {(Number(item.adjusted_edge ?? item.edge ?? 0) * 100).toFixed(1)}%</td>
              <td><span className="decisionBadge">{item.decision}</span></td>
              <td>{item.risk_ok === false ? <span className="riskBad">Blocked</span> : <span className="riskGood">Clear</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function labelize(value) {
  return String(value || "general").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function ScoreBadge({ value }) {
  const numeric = Number(value || 0);
  const tone = numeric >= 0.65 ? "high" : numeric >= 0.35 ? "mid" : "low";
  return <span className={`scoreBadge ${tone}`}>{numeric.toFixed(2)}</span>;
}
