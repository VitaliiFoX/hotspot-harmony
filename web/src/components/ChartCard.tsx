import { type ReactNode, useState } from "react";

type Props = {
  title: string;
  subtitle?: string;
  /** Display options that belong to this chart only (never data filters). */
  options?: ReactNode;
  chart: ReactNode;
  /** The same numbers as a table: the way to read the chart without colour or a pointer. */
  table: ReactNode;
};

export function ChartCard({ title, subtitle, options, chart, table }: Props) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="card">
      <figcaption className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        <div className="card-options">
          {!showTable && options}
          <button type="button" className="ghost" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </figcaption>
      {showTable ? <div className="table-wrap">{table}</div> : chart}
    </figure>
  );
}
