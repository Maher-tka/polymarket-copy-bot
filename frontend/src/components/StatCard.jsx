export default function StatCard({ label, value, helper, tone = "neutral", icon }) {
  return (
    <div className={`statCard ${tone}`}>
      <div className="statIconRow">
        <span>{label}</span>
        {icon ? <div className="statIcon">{icon}</div> : null}
      </div>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}
