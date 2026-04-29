export default function SignalBreakdown({ decisions }) {
  const latest = decisions?.[0];
  const components = latest?.components || {};
  const entries = Object.entries(components);

  return (
    <section className="panel signalPanel">
      <PanelHeader title="Signal Score Breakdown" subtitle="Latest decision inputs" />
      {!latest ? (
        <div className="emptyState">No signal scored yet.</div>
      ) : (
        <>
          <div className="signalHero">
            <div>
              <span>Final score</span>
              <strong>{Number(latest.score || 0).toFixed(2)}</strong>
            </div>
            <div>
              <span>Decision</span>
              <strong>{latest.decision}</strong>
            </div>
            <div>
              <span>Expected edge</span>
              <strong>{percent(latest.edge)}</strong>
            </div>
            <div>
              <span>After costs</span>
              <strong>{percent(latest.adjusted_edge)}</strong>
            </div>
          </div>

          {latest.edge_costs ? (
            <div className="costStrip">
              <span>Costs: resolution {percent(latest.edge_costs.resolution_fee)}, slippage {percent(latest.edge_costs.slippage)}, capital {percent(latest.edge_costs.capital_lockup)}</span>
            </div>
          ) : null}

          <div className="scoreRows">
            {entries.length === 0 ? (
              <div className="emptyState compact">No component scores were emitted.</div>
            ) : entries.map(([name, value]) => (
              <div className="scoreRow" key={name}>
                <div>
                  <span>{labelize(name)}</span>
                  <strong>{Number(value).toFixed(2)}</strong>
                </div>
                <div className="scoreTrack"><div style={{ width: `${Math.max(0, Math.min(100, Number(value) * 100))}%` }} /></div>
              </div>
            ))}
          </div>

          <div className="reasonList">
            {(latest.reasons || []).slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        </>
      )}
    </section>
  );
}

function PanelHeader({ title, subtitle }) {
  return (
    <div className="panelHeader">
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function labelize(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
