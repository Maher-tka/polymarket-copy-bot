import { AlertTriangle } from "lucide-react";

export default function FearSellerPanel({ summary = {} }) {
  const candidates = summary.candidate_markets || [];
  const buckets = Object.entries(summary.bucket_exposure || {});

  return (
    <section className="panel fearSellerPanel">
      <div className="panelHeader">
        <h2>Fear Seller</h2>
        <span>{summary.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      <div className="tailRiskWarning">
        <AlertTriangle size={17} />
        <span>{summary.warning || "High win-rate strategy with rare catastrophic loss risk. One loss can erase many small wins."}</span>
      </div>

      <div className="fearStats">
        <div><span>Total exposure</span><strong>{money(summary.total_exposure)}</strong></div>
        <div><span>Exposure %</span><strong>{percent(summary.total_exposure_pct)}</strong></div>
        <div><span>Open positions</span><strong>{Number(summary.open_positions || 0)}</strong></div>
      </div>

      <div className="bucketStrip">
        {buckets.length === 0 ? (
          <span className="emptyState compact">No Fear Seller bucket exposure.</span>
        ) : buckets.map(([bucket, exposure]) => (
          <span className="badge" key={bucket}>{labelize(bucket)} · {money(exposure)}</span>
        ))}
      </div>

      <div className="fearCandidateList">
        {candidates.length === 0 ? (
          <span className="emptyState">No Fear Seller candidates scanned yet.</span>
        ) : candidates.slice(0, 6).map((candidate) => (
          <article className="fearCandidate" key={candidate.market_id}>
            <div>
              <strong>{candidate.question}</strong>
              <span>{candidate.reason}</span>
            </div>
            <div className="fearCandidateMetrics">
              <Metric label="Score" value={Number(candidate.score || 0).toFixed(0)} />
              <Metric label="Edge" value={percent(candidate.edge)} />
              <Metric label="NO" value={price(candidate.no_price)} />
              <Metric label="Expiry" value={candidate.expiry_days == null ? "n/a" : `${Number(candidate.expiry_days).toFixed(1)}d`} />
              <Metric label="Target" value={candidate.target_price ? money(candidate.target_price, 0) : "n/a"} />
              <Metric label="Spot" value={candidate.current_spot_price ? money(candidate.current_spot_price, 0) : "n/a"} />
              <Metric label="Disaster" value={percent(candidate.estimated_disaster_probability)} />
              <Metric label="Est. NO" value={percent(candidate.estimated_no_probability)} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function money(value, decimals = 2) {
  return `$${Number(value || 0).toFixed(decimals)}`;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function price(value) {
  if (value == null) return "n/a";
  return Number(value).toFixed(3);
}

function labelize(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
