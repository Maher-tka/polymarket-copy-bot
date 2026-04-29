export default function LogsPanel({ logs }) {
  return <section className="panel"><h2>Logs</h2><div className="logbox">{logs.length === 0 ? "No logs yet" : logs.map((log) => <div key={log}>{log}</div>)}</div></section>;
}
