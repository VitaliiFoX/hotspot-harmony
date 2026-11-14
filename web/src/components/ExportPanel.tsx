import { useId, useState } from 'react';
import { ApiError, isAbortError, postHotspotsCsv } from '../api/client';
import type { AreaGeometry } from '../lib/geometry';
import { downloadBlob } from '../lib/download';

interface ExportPanelProps {
  geometry: AreaGeometry | null;
  /** Default CSV window, "YYYY-MM-DD". */
  defaultStart: string;
  defaultEnd: string;
  /** Earliest and latest day of the series. */
  minDate: string;
  maxDate: string;
  /** Null when there is no calendar to export. */
  onExportPng: (() => Promise<void>) | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; message: string; warning: boolean }
  | { kind: 'error'; message: string };

/** CSV of the raw points and PNG of the calendar. */
export function ExportPanel({
  geometry,
  defaultStart,
  defaultEnd,
  minDate,
  maxDate,
  onExportPng,
}: ExportPanelProps) {
  const startId = useId();
  const endId = useId();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [csv, setCsv] = useState<Status>({ kind: 'idle' });
  const [png, setPng] = useState<Status>({ kind: 'idle' });

  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const orderValid = datesValid && start <= end;

  const downloadCsv = async () => {
    if (!geometry || !orderValid) return;
    setCsv({ kind: 'busy' });
    try {
      const result = await postHotspotsCsv({ geometry, start, end });
      downloadBlob(result.blob, result.filename);
      setCsv(
        result.truncated
          ? {
              kind: 'done',
              warning: true,
              message:
                'The file was cut off at 500,000 rows, so it is incomplete. Choose a shorter period or a smaller area to get every point.',
            }
          : { kind: 'done', warning: false, message: `Saved ${result.filename}.` },
      );
    } catch (error) {
      if (isAbortError(error)) return;
      setCsv({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'The download failed.',
      });
    }
  };

  const downloadPng = async () => {
    if (!onExportPng) return;
    setPng({ kind: 'busy' });
    try {
      await onExportPng();
      setPng({ kind: 'done', warning: false, message: 'Saved the calendar image.' });
    } catch {
      setPng({ kind: 'error', message: 'The image could not be created.' });
    }
  };

  return (
    <div className="export">
      <div className="export__block">
        <h3 className="mini-heading">Hotspot points (CSV)</h3>
        <p className="note">
          Every raw detection inside the area, from all sensors, before harmonization.
        </p>
        <div className="export__row">
          <div className="field">
            <label htmlFor={startId} className="field-label">
              From
            </label>
            <input
              id={startId}
              type="date"
              value={start}
              min={minDate}
              max={maxDate}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={endId} className="field-label">
              To
            </label>
            <input
              id={endId}
              type="date"
              value={end}
              min={minDate}
              max={maxDate}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void downloadCsv()}
            disabled={!geometry || !orderValid || csv.kind === 'busy'}
          >
            {csv.kind === 'busy' ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
        {!orderValid ? (
          <p className="form-error" role="alert">
            {datesValid ? 'The first day must not be after the last day.' : 'Enter both dates.'}
          </p>
        ) : null}
        <p className="status-line" role="status">
          {csv.kind === 'done' ? (
            <span className={csv.warning ? 'status-line--warning' : undefined}>{csv.message}</span>
          ) : null}
          {csv.kind === 'error' ? (
            <span className="status-line--error">CSV export failed: {csv.message}</span>
          ) : null}
        </p>
      </div>

      <div className="export__block">
        <h3 className="mini-heading">Calendar image (PNG)</h3>
        <p className="note">
          The calendar as shown now (record, colour scale and date range), with a title and the data
          credit.
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void downloadPng()}
          disabled={!onExportPng || png.kind === 'busy'}
        >
          {png.kind === 'busy' ? 'Preparing…' : 'Download PNG'}
        </button>
        <p className="status-line" role="status">
          {png.kind === 'done' ? png.message : null}
          {png.kind === 'error' ? <span className="status-line--error">{png.message}</span> : null}
        </p>
      </div>
    </div>
  );
}
