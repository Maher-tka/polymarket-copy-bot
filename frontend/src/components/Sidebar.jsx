import { Activity, AlertTriangle, BarChart3, Gauge, History, Moon, Search, Settings, Shield } from "lucide-react";

const items = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "scanner", label: "Markets", icon: Search },
  { id: "fear", label: "Fear Seller", icon: AlertTriangle },
  { id: "risk", label: "Risk", icon: Shield },
  { id: "activity", label: "Activity", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ activeView, onChange, state }) {
  return (
    <aside className="sidebar">
      <div className="brandBlock">
        <div className="brandMark"><Activity size={20} /></div>
        <div>
          <strong>PolyLab</strong>
          <span>Trading research</span>
        </div>
      </div>

      <nav className="sidebarNav" aria-label="Dashboard sections">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activeView === item.id ? "navItem active" : "navItem"}
              onClick={() => onChange(item.id)}
              title={item.label}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebarFooter">
        <div className="miniRisk">
          <Gauge size={16} />
          <div>
            <span>Risk state</span>
            <strong>{(state.blocked_reasons || []).length ? "Blocked" : "Clear"}</strong>
          </div>
        </div>
        <div className="themeHint">
          <Moon size={16} />
          <span>Dark console</span>
        </div>
      </div>
    </aside>
  );
}
