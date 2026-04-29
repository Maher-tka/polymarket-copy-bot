import { useEffect, useState } from "react";
import { getDashboard } from "./api";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setState(await getDashboard());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, []);

  if (error && !state) return <main className="screen"><div className="panel danger">Backend unavailable: {error}</div></main>;
  if (!state) return <main className="screen"><div className="panel">Loading bot dashboard...</div></main>;
  return <Dashboard state={state} onRefresh={refresh} />;
}
