import { Radio, Trophy } from "lucide-react";

export default function NicheCopyPanel({ summary = {} }) {
  const buckets = summary.top_traders || {};
  const bucketEntries = Object.entries(buckets);
  const signals = summary.copy_signals || [];
  const allowed = summary.allowed_buckets || [];

  return (
    <section className="panel nicheCopyPanel">
      <div className="panelHeader">
        <h2>Top Trader Copy</h2>
        <span>Weather + crypto up/down only</span>
      </div>

      <div className="copyStatusGrid">
        <div>
          <span>Status</span>
          <strong className={summary.enabled ? "pnlPositive" : "pnlNegative"}>{summary.enabled ? "Enabled" : "Disabled"}</strong>
        </div>
        <div>
          <span>Allowed niches</span>
          <strong>{allowed.map(labelize).join(" / ") || "None"}</strong>
        </div>
        <div>
          <span>Confirmation</span>
          <strong>{summary.requires_confirmation ? "Required" : "Optional"}</strong>
        </div>
        <div>
          <span>Last discovery</span>
          <strong>{relativeTime(summary.last_discovery_at)}</strong>
        </div>
        <div>
          <span>Last copy poll</span>
          <strong>{relativeTime(summary.last_poll_at)}</strong>
        </div>
      </div>

      <div className="copyNote">
        <Radio size={16} />
        <span>Trader ranking runs in the background. The live bot only reads fresh cached copy signals.</span>
      </div>

      {summary.last_error ? <div className="copyError">{summary.last_error}</div> : null}

      <div className="copyGrid">
        <div className="copyColumn">
          <div className="miniPanelHeader">
            <Trophy size={16} />
            <strong>Top Traders</strong>
          </div>
          {bucketEntries.length === 0 ? (
            <div className="emptyState">Discovery is still warming up.</div>
          ) : (
            <div className="copyBucketList">
              {bucketEntries.map(([bucket, profiles]) => (
                <div className="copyBucket" key={bucket}>
                  <div className="copyBucketTitle">
                    <strong>{labelize(bucket)}</strong>
                    <span>{approvedCount(profiles, summary.min_trader_score)} approved / {profiles.length} ranked</span>
                  </div>
                  {(profiles || []).slice(0, 5).map((profile) => (
                    <div className="copyTrader" key={`${bucket}-${profile.wallet}`}>
                      <div>
                        <strong>{profile.name || shortWallet(profile.wallet)}</strong>
                        <span>{shortWallet(profile.wallet)} · {Number(profile.trades || 0)} trades</span>
                      </div>
                      <div>
                        <strong>{Number(profile.score || 0).toFixed(2)}</strong>
                        <span>{money(profile.pnl)} PnL</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="copyColumn">
          <div className="miniPanelHeader">
            <Radio size={16} />
            <strong>Fresh Copy Signals</strong>
          </div>
          {signals.length === 0 ? (
            <div className="emptyState">No approved trader signal in the current cache window.</div>
          ) : (
            <div className="copySignalList">
              {signals.slice(0, 8).map((signal) => (
                <div className="copySignal" key={`${signal.market_id}-${signal.timestamp}`}>
                  <div>
                    <strong>{labelize(signal.bucket)} · BUY {signal.side}</strong>
                    <span>{signal.trader_name} @ {Number(signal.source_price || 0).toFixed(3)}</span>
                  </div>
                  <div>
                    <strong>{Number(signal.trader_score || 0).toFixed(2)}</strong>
                    <span>{relativeTime(signal.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function labelize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortWallet(wallet) {
  const value = String(wallet || "");
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function relativeTime(timestamp) {
  if (!timestamp) return "Not yet";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp)));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function money(value) {
  const numeric = Number(value || 0);
  return `${numeric < 0 ? "-" : ""}$${Math.abs(numeric).toFixed(2)}`;
}

function approvedCount(profiles, threshold) {
  return (profiles || []).filter((profile) => Number(profile.score || 0) >= Number(threshold || 0)).length;
}
