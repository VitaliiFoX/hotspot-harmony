import { useEffect, useMemo, useState } from "react";
import {
  type Bbox, type Calendar, type DayHotspots, type Meta, type MonthDays, type SeriesName, boxPolygon, fetchCalendar,
  fetchDayHotspots, fetchHotspotsCsv, fetchMeta, fetchMonthDays,
} from "./api";
import { AnomalyTiles } from "./components/AnomalyTiles";
import { CalendarHeatmap, CalendarTable } from "./components/CalendarHeatmap";
import { ChartCard } from "./components/ChartCard";
import { DateTimePanel } from "./components/DateTimePanel";
import { type FilterState, Filters } from "./components/Filters";
import { Globe } from "./components/Globe";
import { DEFAULT_HOUR, clampDate, countHotspots, defaultDate, parseDateParam, parseHourParam } from "./globe";
import { SeasonalChart, SeasonalTable } from "./components/SeasonalChart";
import { YearlyChart, YearlyTable } from "./components/YearlyChart";
import { type ThemeChoice, useDarkMode } from "./hooks";
import { type ScaleMode, lastDay, monthLabel } from "./scale";

/** The typed box as numbers, or the reason it cannot be used. */
function readBox(box: FilterState["box"]): { bbox: Bbox } | { problem: string } {
  const [west, south, east, north] = box.map(Number);
  if (box.some((text) => text.trim() === "") || [west, south, east, north].some(Number.isNaN)) {
    return { problem: "Fill in all four edges of the area." };
  }
  if (west >= east) return { problem: "West must be smaller than east." };
  if (south >= north) return { problem: "South must be smaller than north." };
  if (west < -180 || east > 180 || south < -90 || north > 90) return { problem: "The area is off the map." };
  return { bbox: [west, south, east, north] };
}

export function App() {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(
    () => (new URLSearchParams(window.location.search).get("theme") as ThemeChoice | null) ?? "auto",
  );
  const dark = useDarkMode(themeChoice);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filters, setFilters] = useState<FilterState | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [hour, setHour] = useState<number>(
    () => parseHourParam(new URLSearchParams(window.location.search).get("hour")) ?? DEFAULT_HOUR,
  );
  const [monthDays, setMonthDays] = useState<MonthDays | null>(null);
  const [day, setDay] = useState<DayHotspots | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);

  // The days the globe can show; months stand in until the API reports days.
  const firstDay = meta?.first_day ?? (meta?.first_month ? `${meta.first_month}-01` : null);
  const finalDay = meta?.last_day ?? (meta?.last_month ? lastDay(meta.last_month) : null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("linear");
  const [highlightYear, setHighlightYear] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    fetchMeta()
      .then((loaded) => {
        setMeta(loaded);
        const region = loaded.regions[0];
        if (!region || !loaded.default_series || !loaded.first_month || !loaded.last_month) {
          setError("The API has no data yet. Run `make data`, then restart `make api`.");
          return;
        }
        // A link can carry a view: ?region=Ukraine&box=29,50,32,51.5&start=2010-01&end=2025-12&series=raw
        const query = new URLSearchParams(window.location.search);
        const linked = loaded.regions.find((r) => r.name === query.get("region")) ?? region;
        const box = query.get("box")?.split(",") ?? [];
        const series = query.get("series") as SeriesName | null;
        setFilters({
          region: linked.name,
          box: (box.length === 4 ? box : linked.bbox.map(String)) as FilterState["box"],
          start: query.get("start") ?? loaded.first_month,
          end: query.get("end") ?? loaded.last_month,
          series: series && loaded.series.includes(series) ? series : loaded.default_series,
        });
        const first = loaded.first_day ?? `${loaded.first_month}-01`;
        const last = loaded.last_day ?? lastDay(loaded.last_month);
        const linkedDate = parseDateParam(query.get("date"));
        setDate(linkedDate ? clampDate(linkedDate, first, last) : defaultDate(first, last));
      })
      .catch((reason: Error) => setError(`Cannot reach the API: ${reason.message}. Start it with \`make api\`.`));
  }, []);

  // Keep the address in step with the filters, so the current view can be shared as a link.
  useEffect(() => {
    if (!filters) return;
    const query = new URLSearchParams(window.location.search);
    query.set("region", filters.region);
    query.set("box", filters.box.join(","));
    query.set("start", filters.start);
    query.set("end", filters.end);
    query.set("series", filters.series);
    window.history.replaceState(null, "", `?${query.toString().replaceAll("%2C", ",")}`);
  }, [filters]);

  useEffect(() => {
    if (!date) return;
    const query = new URLSearchParams(window.location.search);
    query.set("date", date);
    query.set("hour", String(hour).padStart(2, "0"));
    window.history.replaceState(null, "", `?${query.toString().replaceAll("%2C", ",")}`);
  }, [date, hour]);

  const month = date?.slice(0, 7) ?? null;
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    fetchMonthDays(month, controller.signal)
      .then(setMonthDays)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setMonthDays(null);
      });
    return () => controller.abort();
  }, [month]);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    setDayLoading(true);
    setDayError(null);
    fetchDayHotspots(date, controller.signal)
      .then(setDay)
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setDay(null);
        setDayError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDayLoading(false);
      });
    return () => controller.abort();
  }, [date]);

  // Changing the hour only filters the day already loaded.
  const counts = useMemo(() => (day ? countHotspots(day.hotspots, hour, day.regions.length) : null), [day, hour]);

  function pickRegion(name: string) {
    const region = meta?.regions.find((r) => r.name === name);
    if (!region) return;
    const box = region.bbox.map(String) as FilterState["box"];
    setFilters((current) => (current ? { ...current, region: name, box } : current));
  }

  const area = useMemo(() => (filters ? readBox(filters.box) : null), [filters]);
  const problem = area && "problem" in area ? area.problem : null;

  useEffect(() => {
    if (!filters || !area || "problem" in area) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchCalendar(
        { geometry: boxPolygon(area.bbox), start: filters.start, end: filters.end, series: filters.series },
        controller.signal,
      )
        .then((result) => {
          setCalendar(result);
          setError(null);
          setHighlightYear((year) => (year && result.yearly.some((y) => y.year === year) ? year : result.anomaly.year));
        })
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, area]);

  async function download() {
    if (!filters || !area || "problem" in area) return;
    setDownloading(true);
    setExportNote(null);
    try {
      const start = `${filters.start}-01`;
      const end = lastDay(filters.end);
      const { blob, truncated } = await fetchHotspotsCsv({ geometry: boxPolygon(area.bbox), start, end });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `hotspots_${start}_${end}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      if (truncated && meta) {
        setExportNote(
          `The export stops at ${meta.csv_row_limit.toLocaleString("en-US")} hotspots. Choose a smaller area or a shorter period to get all of them.`,
        );
      }
    } catch (reason) {
      setExportNote(`The export failed: ${(reason as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  const unit = calendar?.unit ?? "";
  // Where the yearly chart marks a change of sensor: the raw record jumps there, the harmonized one should not.
  const viirsTakesOver = meta?.harmonized_record?.find((part) => part.sensor.startsWith("viirs"));
  const sensorSwitch =
    calendar?.series === "raw" && meta
      ? { year: Number(meta.raw_sensor_switch.slice(0, 4)), label: "VIIRS S-NPP replaces MODIS" }
      : viirsTakesOver
        ? { year: Number(viirsTakesOver.from.slice(0, 4)), label: "VIIRS NOAA-20 takes over" }
        : undefined;
  const year = highlightYear ?? calendar?.anomaly.year ?? 0;

  return (
    <>
      <Globe
        regions={meta?.regions ?? []}
        date={date}
        hour={hour}
        day={day}
        counts={counts}
        focusRegion={filters?.region ?? null}
        dark={dark}
        onPickRegion={pickRegion}
        panel={
          date && firstDay && finalDay ? (
            <DateTimePanel
              date={date}
              hour={hour}
              firstDay={firstDay}
              lastDay={finalDay}
              monthDays={monthDays}
              day={day}
              counts={counts}
              loading={dayLoading}
              error={dayError}
              onDate={setDate}
              onHour={setHour}
            />
          ) : null
        }
      />
      <div className="page">
        <header className="top">
          <div>
            <p className="subtitle">Burning activity calendar from satellite fire hotspots, 2000 to 2025</p>
          </div>
          <label className="theme">
            <span>Theme</span>
            <select value={themeChoice} onChange={(event) => setThemeChoice(event.target.value as ThemeChoice)}>
              <option value="auto">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </header>

        {meta && filters && (
          <Filters
            meta={meta}
            value={filters}
            onChange={setFilters}
            onDownload={download}
            downloading={downloading}
            problem={problem}
          />
        )}

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {exportNote && <p className="notice">{exportNote}</p>}
        {calendar?.warnings.map((warning) => (
          <p className="notice" key={warning}>
            {warning}
          </p>
        ))}
        {calendar?.series === "raw" && meta && (
          <p className="notice">
            {`Raw record: MODIS before ${monthLabel(meta.raw_sensor_switch)}, VIIRS S-NPP from then on, counted as ${calendar.unit} with no correction. VIIRS sees many small fires that MODIS misses, so the values jump at that month and cannot be compared across it.`}
          </p>
        )}
        {calendar?.series === "harmonized" && meta?.harmonized_record && (
          <p className="notice">
            {`Harmonized record, in ${calendar.unit}: each value is the number of 1 km cells with fire on a day, as MODIS Terra + Aqua would have reported them, so ${meta.harmonized_record[0].from.slice(0, 4)} and ${meta.last_month?.slice(0, 4)} can be compared. ${meta.harmonized_record.map((part) => `${part.label}: ${part.to ? `${monthLabel(part.from)} to ${monthLabel(part.to)}` : `from ${monthLabel(part.from)}`}`).join("; ")}.`}
          </p>
        )}

        {!calendar && !error && <p className="notice">Loading the record...</p>}

        {calendar && (
          <main className={loading ? "content is-loading" : "content"} aria-busy={loading}>
            <AnomalyTiles anomaly={calendar.anomaly} climatology={calendar.climatology} unit={unit} />

            <ChartCard
              title="Burning activity calendar"
              subtitle={`Monthly ${unit} in the area, over ${calendar.cells_used.toLocaleString("en-US")} grid cells with burning`}
              options={
                <div className="segmented" role="group" aria-label="Colour scale">
                  {(["linear", "log"] as ScaleMode[]).map((mode) => (
                    <button key={mode} type="button" aria-pressed={scaleMode === mode} onClick={() => setScaleMode(mode)}>
                      {mode === "log" ? "Log scale" : "Linear scale"}
                    </button>
                  ))}
                </div>
              }
              chart={
                <CalendarHeatmap
                  months={calendar.months}
                  climatology={calendar.climatology}
                  unit={unit}
                  mode={scaleMode}
                  dark={dark}
                  highlightYear={year}
                  onHighlightYear={setHighlightYear}
                />
              }
              table={<CalendarTable months={calendar.months} unit={unit} />}
            />

            <div className="pair">
              <ChartCard
                title={`${year} against the usual season`}
                subtitle={`Monthly ${unit}; median and middle half over all years`}
                options={
                  <label className="inline">
                    <span>Year</span>
                    <select value={year} onChange={(event) => setHighlightYear(Number(event.target.value))}>
                      {calendar.yearly.map((item) => (
                        <option key={item.year}>{item.year}</option>
                      ))}
                    </select>
                  </label>
                }
                chart={<SeasonalChart months={calendar.months} climatology={calendar.climatology} year={year} unit={unit} />}
                table={<SeasonalTable months={calendar.months} climatology={calendar.climatology} year={year} unit={unit} />}
              />
              <ChartCard
                title="Burning per year"
                subtitle={`Yearly ${unit} within the selected period`}
                chart={
                  <YearlyChart yearly={calendar.yearly} unit={unit} sensorSwitch={sensorSwitch} />
                }
                table={<YearlyTable yearly={calendar.yearly} unit={unit} />}
              />
            </div>
          </main>
        )}

        <footer className="credit">
          Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). This project is not affiliated with or endorsed by NASA.
        </footer>
      </div>
    </>
  );
}
