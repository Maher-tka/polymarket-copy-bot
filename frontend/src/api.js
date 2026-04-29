const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export async function getDashboard() {
  return request("/api/dashboard");
}

export async function botAction(action) {
  return request(`/api/bot/${action}`, { method: "POST" });
}

export async function getSettings() {
  return request("/api/settings");
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
