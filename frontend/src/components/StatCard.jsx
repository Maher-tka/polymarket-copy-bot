export default function StatCard({ label, value, helper, tone = "neutral" }) {
  return (
    <div className={`statCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}
