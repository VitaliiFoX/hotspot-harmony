export type TipRow = { value: string; label: string; swatch?: string };
export type Tip = { x: number; y: number; title: string; rows: TipRow[] };

/** One floating readout for every chart. Values lead, labels follow. */
export function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const width = 240;
  const left = Math.max(8, Math.min(tip.x + 14, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(tip.y + 14, window.innerHeight - 40 - tip.rows.length * 22));
  return (
    <div className="tooltip" role="status" style={{ left, top, width }}>
      <div className="tooltip-title">{tip.title}</div>
      {tip.rows.map((row) => (
        <div className="tooltip-row" key={row.label}>
          {row.swatch && <span className="line-key" style={{ background: row.swatch }} />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
