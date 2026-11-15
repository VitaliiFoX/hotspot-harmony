import { t } from "../i18n";
import { type ReactNode, useRef, useState } from "react";
import { downloadPng } from "../exports";

type Props = {
  title: string;
  subtitle?: string;
  /** Display options that belong to this chart only (never data filters). */
  options?: ReactNode;
  chart: ReactNode;
  /** The same numbers as a table: the way to read the chart without colour or a pointer. */
  table: ReactNode;
  /** File name for "Download PNG"; the button is shown when it is given. */
  pngName?: string;
  /** Extra download buttons, e.g. the data behind the chart as CSV. */
  downloads?: ReactNode;
  /** Anchor for links and scrolling to this card. */
  id?: string;
};

export function ChartCard({ title, subtitle, options, chart, table, pngName, downloads, id }: Props) {
  const [showTable, setShowTable] = useState(false);
  const [saving, setSaving] = useState(false);
  const figure = useRef<HTMLElement>(null);

  async function savePng() {
    if (!figure.current || !pngName) return;
    setSaving(true);
    try {
      await downloadPng(figure.current, pngName);
    } finally {
      setSaving(false);
    }
  }

  return (
    <figure className="card" ref={figure} id={id}>
      <figcaption className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        <div className="card-options" data-export="skip">
          {!showTable && options}
          <button type="button" className="ghost" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
            {showTable ? t("Show chart") : t("Show table")}
          </button>
        </div>
      </figcaption>
      {showTable ? <div className="table-wrap">{table}</div> : chart}
      {(pngName || downloads) && (
        <div className="card-downloads" data-export="skip">
          {downloads}
          {pngName && !showTable && (
            <button type="button" className="ghost download" onClick={savePng} disabled={saving}>
              {saving ? t("Saving image...") : t("Download PNG")}
            </button>
          )}
        </div>
      )}
    </figure>
  );
}
