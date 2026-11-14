import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL, ApiError, USE_FIXTURES, getMeta, isAbortError, postCalendar } from './api/client';
import type { CalendarRequest, CalendarResponse, Meta } from './api/types';
import { modeLabel } from './charts/calendarOption';
import { exportCalendarPng } from './charts/exportPng';
import { AnomalyBlock } from './components/AnomalyBlock';
import { AreaForm } from './components/AreaForm';
import { CalendarPanel } from './components/CalendarPanel';
import { ChartsPanel } from './components/ChartsPanel';
import { DateRange } from './components/DateRange';
import { ExportPanel } from './components/ExportPanel';
import { HeadlineBlock } from './components/HeadlineBlock';
import { MapPanel } from './components/MapPanel';
import { ATTRIBUTION, MethodPanel } from './components/MethodPanel';
import { Segmented } from './components/Segmented';
import { buildExamples, defaultArea, defaultCountry } from './lib/examples';
import { formatCount } from './lib/format';
import {
  coverageOf,
  geometryAreaKm2,
  normalizeGeometry,
  type AreaGeometry,
  type BBox,
} from './lib/geometry';
import { buildHeadline, unusualMonths } from './lib/headline';
import {
  buildMonthGrid,
  isEmptyResult,
  rawRecord,
  visiblePeriods,
  type ColorScale,
  type RecordMode,
} from './lib/monthGrid';
import { decodeHash, encodeGeometry, encodeHash } from './lib/urlState';
import { firstDay, lastDay, lastTwelveMonths, parseYM, type YM } from './lib/ym';

interface Range {
  start: string | null;
  end: string | null;
}

interface MetaState {
  attempt: number;
  meta: Meta | null;
  error: ApiError | null;
}

interface CalendarState {
  key: string;
  data: CalendarResponse | null;
  error: ApiError | null;
}

const FALLBACK_SERIES = { start: '2000-11', end: '2025-12' };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError('invalid', error instanceof Error ? error.message : 'Unexpected error.');
}

function errorTitle(error: ApiError): string {
  if (error.kind === 'network') return 'The API cannot be reached';
  if (error.status === 422) return 'No data for this area';
  if (error.status === 400) return 'The request was not accepted';
  return 'Something went wrong';
}

/** The hash as the browser holds it, decoded; empty when it cannot be decoded. */
function currentHash(): string {
  const raw = window.location.hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

export function App() {
  const [initial] = useState(() => decodeHash(window.location.hash));
  const [geometry, setGeometry] = useState<AreaGeometry | null>(
    initial.geometry ? normalizeGeometry(initial.geometry) : null,
  );
  const [range, setRange] = useState<Range>({ start: initial.start, end: initial.end });
  const [mode, setMode] = useState<RecordMode>(initial.raw ? 'raw' : 'harmonized');
  const [scale, setScale] = useState<ColorScale>('log');
  const [highlight, setHighlight] = useState<YM | null>(null);

  const [metaAttempt, setMetaAttempt] = useState(0);
  const [metaState, setMetaState] = useState<MetaState | null>(null);
  const [calendarAttempt, setCalendarAttempt] = useState(0);
  const [calendarState, setCalendarState] = useState<CalendarState | null>(null);

  // --- API description -------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    getMeta(controller.signal).then(
      (meta) => {
        setMetaState({ attempt: metaAttempt, meta, error: null });
        // First visit without a shared link: show the whole default country.
        setGeometry((current) => current ?? defaultArea(meta));
      },
      (error: unknown) => {
        if (isAbortError(error)) return;
        setMetaState({ attempt: metaAttempt, meta: null, error: toApiError(error) });
      },
    );
    return () => controller.abort();
  }, [metaAttempt]);

  const metaLoading = metaState === null || metaState.attempt !== metaAttempt;
  const meta = metaState?.meta ?? null;
  const metaError = metaLoading ? null : (metaState?.error ?? null);
  const series = meta?.series ?? FALLBACK_SERIES;
  const unit = meta?.unit_short || 'fire cell-days';

  // --- Calendar request ------------------------------------------------------
  const rangeError =
    range.start && range.end && range.start > range.end
      ? 'The first month must not be after the last month.'
      : null;

  const request = useMemo<{ key: string; body: CalendarRequest } | null>(() => {
    if (!meta || !geometry || rangeError) return null;
    const body: CalendarRequest = { geometry };
    if (range.start) body.start = range.start;
    if (range.end) body.end = range.end;
    const key = [
      encodeGeometry(geometry),
      range.start ?? '',
      range.end ?? '',
      calendarAttempt,
    ].join('|');
    return { key, body };
  }, [meta, geometry, range.start, range.end, rangeError, calendarAttempt]);

  useEffect(() => {
    if (!request) return undefined;
    const controller = new AbortController();
    // A short delay so that a burst of edits sends one request.
    const timer = setTimeout(() => {
      postCalendar(request.body, controller.signal).then(
        (data) => setCalendarState({ key: request.key, data, error: null }),
        (error: unknown) => {
          if (isAbortError(error)) return;
          setCalendarState({ key: request.key, data: null, error: toApiError(error) });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  const calendarLoading = request !== null && calendarState?.key !== request.key;
  const calendarError =
    request !== null && !calendarLoading ? (calendarState?.error ?? null) : null;
  // While a new request runs, the previous answer stays on screen (dimmed).
  const data = request !== null ? (calendarState?.data ?? null) : null;

  // --- Shareable state in the URL hash --------------------------------------
  useEffect(() => {
    const hash = encodeHash({
      geometry,
      start: range.start,
      end: range.end,
      raw: mode === 'raw',
    });
    if (currentHash() === hash) return;
    const url = hash ? `#${hash}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }, [geometry, range.start, range.end, mode]);

  useEffect(() => {
    const onHashChange = () => {
      const next = decodeHash(window.location.hash);
      if (next.geometry) {
        const incoming = normalizeGeometry(next.geometry);
        setGeometry((current) =>
          current && encodeGeometry(current) === encodeGeometry(incoming) ? current : incoming,
        );
      }
      setRange((current) =>
        current.start === next.start && current.end === next.end
          ? current
          : { start: next.start, end: next.end },
      );
      setMode(next.raw ? 'raw' : 'harmonized');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // --- Derived values --------------------------------------------------------
  const examples = useMemo(() => buildExamples(meta), [meta]);
  const countries = useMemo(() => meta?.countries ?? [], [meta]);
  const grid = useMemo(() => (data ? buildMonthGrid(data.months, data.climatology) : null), [data]);
  const periods = useMemo(() => {
    if (!grid || !meta) return [];
    const record = mode === 'raw' ? rawRecord(meta.series.start) : meta.record;
    return visiblePeriods(record, grid.first, grid.last);
  }, [grid, meta, mode]);
  const headline = useMemo(
    () =>
      data
        ? buildHeadline({
            anomaly: data.anomaly,
            climatology: data.climatology,
            months: data.months,
            topMonths: data.top_months,
            unit,
          })
        : null,
    [data, unit],
  );

  const coverage = useMemo(
    () =>
      geometry && meta
        ? coverageOf(
            geometry,
            meta.countries.map((c) => c.bbox as BBox),
          )
        : null,
    [geometry, meta],
  );
  const countryNames = countries.map((c) => c.name).join(', ');
  const reportCountry = data?.countries[0] ?? defaultCountry(meta)?.name ?? null;
  const areaKm2 = geometry ? geometryAreaKm2(geometry) : null;
  const empty = grid ? isEmptyResult(grid) : false;

  const handleGeometry = useCallback((next: AreaGeometry | null) => {
    setGeometry(next ? normalizeGeometry(next) : null);
    setHighlight(null);
  }, []);

  const handleRange = useCallback((next: Range) => {
    setRange(next);
    setHighlight(null);
  }, []);

  const seriesEnd = parseYM(series.end) ?? { year: 2025, month: 12 };
  const seriesStart = parseYM(series.start) ?? { year: 2000, month: 11 };
  const csvDefaults = lastTwelveMonths(seriesEnd);

  const exportPng =
    grid && meta && data
      ? () =>
          exportCalendarPng(
            {
              grid,
              mode,
              scale,
              periods,
              record: meta.record,
              unit,
              exportInfo: {
                title: 'Hotspot Harmony: burning activity calendar',
                subtitle: [
                  data.countries.join(', ') || 'Selected area',
                  areaKm2 !== null ? `about ${formatCount(Math.round(areaKm2))} km²` : '',
                  `${unit} per month, ${modeLabel(mode)}`,
                  scale === 'deviation'
                    ? 'colour: ratio to the usual level'
                    : `${scale} colour scale`,
                ]
                  .filter((part) => part !== '')
                  .join(' · '),
                attribution: meta.attribution || ATTRIBUTION,
              },
            },
            `hotspot-harmony-calendar-${mode}.png`,
          )
      : null;

  return (
    <div className="app">
      <a className="skip-link" href="#results">
        Skip to results
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <h1 className="brand">
            <span className="brand__mark" aria-hidden="true" />
            Hotspot Harmony
          </h1>
          <p className="tagline">
            One comparable record of satellite fire hotspots, 2000 to today, for any area you draw.
          </p>
          {USE_FIXTURES ? (
            <p className="badge" title="VITE_USE_FIXTURES=1">
              Demo data: synthetic numbers, no backend
            </p>
          ) : null}
        </div>
      </header>

      <main className="layout">
        <section className="column column--area" aria-labelledby="area-heading">
          <div className="card card--flush">
            <h2 id="area-heading" className="card__title">
              Choose an area
            </h2>
            <MapPanel countries={countries} geometry={geometry} onGeometryChange={handleGeometry} />
            {coverage === 'outside' ? (
              <p className="callout callout--warning" role="status">
                This area is outside the regions with data, so there is nothing to show for it.
                {countryNames ? ` Data is available for: ${countryNames}.` : ''}
              </p>
            ) : null}
            {coverage === 'partial' ? (
              <p className="callout" role="status">
                Part of this area lies outside the regions with data. Only the part inside is
                counted.
              </p>
            ) : null}
            <AreaForm examples={examples} geometry={geometry} onGeometry={handleGeometry} />
            <DateRange
              seriesStart={series.start}
              seriesEnd={series.end}
              start={range.start}
              end={range.end}
              onChange={handleRange}
              error={rangeError}
            />
          </div>
        </section>

        <section
          className="column column--results"
          id="results"
          aria-labelledby="results-heading"
          aria-busy={metaLoading || calendarLoading}
          tabIndex={-1}
        >
          <h2 id="results-heading" className="visually-hidden">
            Results
          </h2>

          <p className="visually-hidden" role="status">
            {metaLoading
              ? 'Connecting to the data service.'
              : calendarLoading
                ? 'Loading the calendar for this area.'
                : data
                  ? 'Calendar loaded.'
                  : ''}
          </p>

          {metaLoading ? (
            <div className="card state">
              <span className="spinner" aria-hidden="true" />
              <p>Connecting to the data service&hellip;</p>
            </div>
          ) : null}

          {metaError ? (
            <div className="card state state--error" role="alert">
              <h2>{errorTitle(metaError)}</h2>
              <p>{metaError.message}</p>
              {metaError.kind === 'network' ? (
                <p className="note">
                  Check that the backend is running at <code>{API_URL}</code>, then try again.
                </p>
              ) : null}
              <button
                type="button"
                className="button button--primary"
                onClick={() => setMetaAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : null}

          {meta && !geometry ? (
            <div className="card state">
              <h2>No area selected</h2>
              <p>
                Draw a polygon on the map, pick an example area, or enter a bounding box or a centre
                with a radius.
              </p>
            </div>
          ) : null}

          {meta && geometry && calendarLoading && !data ? (
            <div className="card state">
              <span className="spinner" aria-hidden="true" />
              <p>Loading the calendar for this area&hellip;</p>
            </div>
          ) : null}

          {calendarError ? (
            <div className="card state state--error" role="alert">
              <h2>{errorTitle(calendarError)}</h2>
              <p>{calendarError.message}</p>
              {calendarError.kind === 'network' ? (
                <p className="note">
                  Check that the backend is running at <code>{API_URL}</code>, then try again.
                </p>
              ) : null}
              {calendarError.status === 422 || calendarError.status === 400 ? null : (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setCalendarAttempt((n) => n + 1)}
                >
                  Try again
                </button>
              )}
            </div>
          ) : null}

          {meta && data && grid && headline ? (
            <div className={`results${calendarLoading ? ' results--stale' : ''}`}>
              <section className="card" aria-labelledby="summary-heading">
                <h2 id="summary-heading" className="visually-hidden">
                  Summary
                </h2>
                <HeadlineBlock
                  headline={headline}
                  topMonths={empty ? [] : unusualMonths(data.top_months ?? [])}
                  highlight={highlight}
                  onHighlight={setHighlight}
                />
                <p className="area-facts">
                  {formatCount(data.cells_used)} grid {data.cells_used === 1 ? 'cell' : 'cells'} of{' '}
                  {meta.grid.cell_deg}&deg;
                  {data.countries.length > 0 ? ` in ${data.countries.join(', ')}` : ''}
                  {areaKm2 !== null ? `, area about ${formatCount(Math.round(areaKm2))} km²` : ''}.
                  Unit: {data.unit || meta.unit}.
                </p>
                {empty ? (
                  <p className="callout" role="status">
                    No hotspots were detected here in this period. That is a valid result, not an
                    error: the calendar below is simply empty.
                  </p>
                ) : null}
              </section>

              <section className="card" aria-labelledby="calendar-heading">
                <div className="card__head">
                  <h2 id="calendar-heading">Burning activity calendar</h2>
                  <p className="note">
                    {unit} per month: one grid cell of about 1 km with fire on one day counts as
                    one.
                  </p>
                </div>

                <div className="record-switch">
                  <Segmented
                    legend="Record"
                    value={mode}
                    onChange={setMode}
                    prominent
                    options={[
                      { value: 'harmonized', label: 'Harmonized' },
                      { value: 'raw', label: 'Raw (uncorrected)' },
                    ]}
                  />
                  <p className="record-switch__why">
                    {mode === 'raw'
                      ? 'Raw: MODIS counts until January 2012, VIIRS counts after. VIIRS sees several times more hotspots, so everything jumps in 2012 without any change on the ground.'
                      : 'Harmonized: every period is converted to what MODIS would have counted, so 2003 and 2025 can be compared. Switch to Raw to see the artificial 2012 jump this removes.'}
                  </p>
                </div>

                <CalendarPanel
                  grid={grid}
                  mode={mode}
                  scale={scale}
                  onScale={setScale}
                  periods={periods}
                  record={meta.record}
                  unit={unit}
                  highlight={highlight}
                />
              </section>

              <section className="card" aria-labelledby="anomaly-heading">
                <h2 id="anomaly-heading">Latest month against the usual level</h2>
                <AnomalyBlock anomaly={data.anomaly} unit={unit} />
              </section>

              <ChartsPanel
                grid={grid}
                climatology={data.climatology}
                yearly={data.yearly}
                mode={mode}
                unit={unit}
              />
            </div>
          ) : null}

          {meta ? (
            <section className="card" aria-labelledby="export-heading">
              <h2 id="export-heading">Export</h2>
              <ExportPanel
                key={`${csvDefaults.start}-${csvDefaults.end}`}
                geometry={geometry}
                defaultStart={csvDefaults.start}
                defaultEnd={csvDefaults.end}
                minDate={firstDay(seriesStart)}
                maxDate={lastDay(seriesEnd)}
                onExportPng={exportPng}
              />
            </section>
          ) : null}

          <MethodPanel report={meta?.report} country={reportCountry} unit={unit} />
        </section>
      </main>

      <footer className="site-footer">
        <p>
          Data: {meta?.attribution || ATTRIBUTION}. Basemap &copy; OpenStreetMap contributors,
          OpenFreeMap.
        </p>
        <p>
          Hotspots are thermal anomalies, not confirmed fires or burned area. Not affiliated with or
          endorsed by NASA.
        </p>
      </footer>
    </div>
  );
}
