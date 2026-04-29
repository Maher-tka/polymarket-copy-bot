export default function OrderbookPanel({ state }) {
  return (
    <section className="panel">
      <h2>Orderbook</h2>
      <p className="muted">Waiting for CLOB market data.</p>
      <div className="row"><span>WebSocket</span><strong>{state.websocket_connected ? "Connected" : "Waiting"}</strong></div>
      <div className="row"><span>Stale data</span><strong>{state.stale_data ? "Yes" : "No"}</strong></div>
    </section>
  );
}
