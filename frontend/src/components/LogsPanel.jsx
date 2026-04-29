export default function LogsPanel({ logs }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Bot Logs</h2>
        <span>{logs.length} messages</span>
      </div>
      <div className="logbox">
        {logs.length === 0 ? <span className="emptyState compact">No logs yet.</span> : logs.map((log, index) => <div key={`${log}-${index}`}>{log}</div>)}
      </div>
    </section>
  );
}
