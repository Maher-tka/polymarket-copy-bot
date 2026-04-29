export default function OrderbookPanel({ state }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Orderbook Feed</h2>
        <span>WebSocket-first data</span>
      </div>
      <div className="row"><span>WebSocket</span><strong>{state.websocket_connected ? "Connected" : "Waiting"}</strong></div>
      <div className="row"><span>Last WS message</span><strong>{state.websocket_last_message_age_seconds == null ? "None yet" : `${Number(state.websocket_last_message_age_seconds).toFixed(1)}s ago`}</strong></div>
      <div className="row"><span>Cached books</span><strong>{Number(state.websocket_cached_books || 0)}</strong></div>
      <div className="row"><span>REST recovery</span><strong>{Number(state.rest_fallback_count || 0)} fallback reads</strong></div>
      <div className="row"><span>Stale data</span><strong>{state.stale_data ? "Yes" : "No"}</strong></div>
      <div className="dataHealth">
        <span className={state.stale_data ? "healthDot bad" : "healthDot good"} />
        <span>{state.stale_data ? "Trading should pause until fresh data returns." : "Data guard is clear."}</span>
      </div>
    </section>
  );
}
