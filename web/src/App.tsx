import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AreaGeometry, type Bbox, type Calendar, type Cells, type DayHotspots, type Meta, type MonthDays, type SeriesName, type Validation,
  boxPolygon, fetchCalendar, fetchDayHotspots, fetchHotspotsCsv, fetchMeta, fetchMonthDays, fetchTopCells, fetchValidation,
} from "./api";
import {
  type Corner, boundsText, boxCorners, cornersBounds, cornersPolygon, cornersWkt, formatAreaParam, parseAreaParam, regionOfArea, roundCorner,
} from "./area";
import { type Country, countryBoxText, fetchCountries, findCountry, namesCountry, regionOfCountry } from "./countries";
import { AnomalyTiles } from "./components/AnomalyTiles";
import { CalendarHeatmap, CalendarTable } from "./components/CalendarHeatmap";
import { ChartCard } from "./components/ChartCard";
import { calendarCsv, downloadBlob, exportName } from "./exports";
import { DateTimePanel } from "./components/DateTimePanel";
import { type FilterState, Filters } from "./components/Filters";
import { Globe } from "./components/Globe";
import { GlobeBoundary } from "./components/GlobeBoundary";
import {
  DEFAULT_TIME, type MapView, clampDate, countHotspots, defaultDate, parseDateParam, parseTimeParam, parseViewParam, timeLabel,
} from "./globe";
import { PeakMonthsChart, PeakMonthsSummary, PeakMonthsTable } from "./components/PeakMonths";
import { SeasonalChart, SeasonalTable } from "./components/SeasonalChart";
import { InShort } from "./components/InShort";
import { TopPlaces } from "./components/TopPlaces";
import { UnusualMonths } from "./components/UnusualMonths";
import { summaryLines, unusualMonths } from "./insights";
import { TrustBlock } from "./components/TrustBlock";
import { YearlyChart, YearlyTable } from "./components/YearlyChart";
import { type ThemeChoice, useDarkMode } from "./hooks";
import { CalendarCache, type CalendarBody, delayFor, otherSeries } from "./requests";
import { PRESETS, presetHref } from "./presets";
import { monthError, sameMonthRatio, verdictKind } from "./trust";
import { PEAK_SHARE, type ScaleMode, lastDay, monthLabel, peakMonths } from "./scale";

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

/** Put the view into the address, keeping the commas, colons and semicolons of its values readable. */
function writeAddress(query: URLSearchParams) {
  const text = query.toString().replaceAll("%2C", ",").replaceAll("%3A", ":").replaceAll("%3B", ";");
  window.history.replaceState(null, "", `?${text}`);
}

export function App() {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(
    () => (new URLSearchParams(window.location.search).get("theme") as ThemeChoice | null) ?? "auto",
  );
  const dark = useDarkMode(themeChoice);
  const [meta, setMeta] = useState<Meta | null>(null);
  // How far the harmonized record can be trusted; null until the API answers, or when it has no report.
  const [validation, setValidation] = useState<Validation | null>(null);
  const [filters, setFilters] = useState<FilterState | null>(null);
  // The borders a country is picked by on the globe; null until they arrive, empty when they cannot be loaded.
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  // The same view in the record not on screen, from the look-ahead: the raw line over the harmonized years.
  const [otherCalendar, setOtherCalendar] = useState<Calendar | null>(null);
  // The busiest grid cells of the area, and the one the globe should fly to ("Show on the globe").
  const [topCells, setTopCells] = useState<Cells | null>(null);
  const [globeFocus, setGlobeFocus] = useState<{ lat: number; lon: number; n: number } | null>(null);
  const [date, setDate] = useState<string | null>(null);
  // Time of day on the globe, in minutes after 00:00 UTC.
  const [time, setTime] = useState<number>(() => {
    const query = new URLSearchParams(window.location.search);
    return parseTimeParam(query.get("time"), query.get("hour")) ?? DEFAULT_TIME;
  });
  // The map at the top of the page: the 3D globe, or the flat world map.
  const [view, setView] = useState<MapView>(() => parseViewParam(new URLSearchParams(window.location.search).get("view")));
  const [monthDays, setMonthDays] = useState<MonthDays | null>(null);
  const [day, setDay] = useState<DayHotspots | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);

  // The days the globe can show; months stand in until the API reports days.
  const firstDay = meta?.first_day ?? (meta?.first_month ? `${meta.first_month}-01` : null);
  const finalDay = meta?.last_day ?? (meta?.last_month ? lastDay(meta.last_month) : null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Log by default: on a linear scale a few record months wash every other month out to the lightest blue.
  const [scaleMode, setScaleMode] = useState<ScaleMode>("log");
  const [highlightYear, setHighlightYear] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const cache = useRef(new CalendarCache());
  const lastView = useRef<FilterState | null>(null);

  useEffect(() => {
    // A missing report (404) only hides the trust block: the calendar works without it.
    fetchValidation().then(setValidation).catch(() => setValidation(null));
  }, []);

  useEffect(() => {
    // Without the borders the page still works by region and box; only picking a country is off.
    fetchCountries().then(setCountries).catch(() => setCountries([]));
  }, []);

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
        const box = query.get("box")?.split(",") ?? [];
        // A drawn area comes as &area=lon,lat;lon,lat;... and wins over the box, which then holds its bounds.
        // It also names the region, as when it is drawn here, so a link without &region= still says the right one.
        const drawn = parseAreaParam(query.get("area"));
        const named = loaded.regions.find((r) => r.name === query.get("region")) ?? region;
        const linked = (drawn && regionOfArea(loaded.regions, drawn)) || named;
        const series = query.get("series") as SeriesName | null;
        setFilters({
          region: linked.name,
          box: (drawn ? boundsText(drawn) : box.length === 4 ? box : linked.bbox.map(String)) as FilterState["box"],
          area: drawn,
          // A country picked on the globe comes as &country=Name; a drawn area wins over it.
          country: drawn ? null : query.get("country"),
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
    if (filters.area) query.set("area", formatAreaParam(filters.area));
    else query.delete("area");
    if (filters.country) query.set("country", filters.country);
    else query.delete("country");
    writeAddress(query);
  }, [filters]);

  // The country behind the filters, and the region whose record holds it; without one there is nothing to show yet.
  const picked = useMemo(() => findCountry(countries ?? [], filters?.country ?? null), [countries, filters?.country]);
  const pickedRegion = useMemo(() => (picked && meta ? regionOfCountry(meta.regions, picked) : null), [picked, meta]);
  const noData = Boolean(picked && meta && !pickedRegion);

  // A link can carry a country alone (&country=Name), or one the borders do not have. Once the borders are here,
  // the first gets the bounds and the region of its country, the second falls back to the box the link carries.
  useEffect(() => {
    if (!countries || !filters?.country) return;
    setFilters((current) => {
      if (!current?.country) return current;
      if (!picked) return { ...current, country: null };
      const box = countryBoxText(picked);
      const region = pickedRegion?.name ?? current.region;
      const same = current.country === picked.name && current.region === region && current.box.join() === box.join();
      return same ? current : { ...current, country: picked.name, region, box };
    });
  }, [countries, filters?.country, picked, pickedRegion]);

  useEffect(() => {
    if (!date) return;
    const query = new URLSearchParams(window.location.search);
    query.set("date", date);
    query.delete("hour");
    query.set("time", timeLabel(time));
    writeAddress(query);
  }, [date, time]);

  // Only the flat map is written, so a link to the globe stays what it was.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if ((query.get("view") === "flat") === (view === "flat")) return;
    if (view === "flat") query.set("view", "flat");
    else query.delete("view");
    writeAddress(query);
  }, [view]);

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
  const counts = useMemo(() => (day ? countHotspots(day.hotspots, time, day.regions.length) : null), [day, time]);

  /** Take the country double-clicked on the globe as the area of interest, or go back to the region's box. */
  function pickCountry(name: string | null) {
    if (!meta) return;
    const country = findCountry(countries ?? [], name);
    setFilters((current) => {
      if (!current) return current;
      if (!country) {
        const region = meta.regions.find((r) => r.name === current.region);
        return region ? { ...current, box: region.bbox.map(String) as FilterState["box"], area: null, country: null } : current;
      }
      // A country with no record keeps the region of the filters, so "back" has somewhere to go.
      const region = regionOfCountry(meta.regions, country)?.name ?? current.region;
      return { ...current, region, box: countryBoxText(country), area: null, country: country.name };
    });
  }

  /** Take an area drawn on the globe as the area of interest, or go back to the region's box. */
  function drawArea(corners: Corner[] | null) {
    if (!meta) return;
    setFilters((current) => {
      if (!current) return current;
      if (!corners) {
        const region = meta.regions.find((r) => r.name === current.region);
        return region ? { ...current, box: region.bbox.map(String) as FilterState["box"], area: null, country: null } : current;
      }
      const drawn = corners.map(roundCorner);
      const region = regionOfArea(meta.regions, drawn)?.name ?? current.region;
      return { ...current, region, box: boundsText(drawn) as FilterState["box"], area: drawn, country: null };
    });
  }

  // The area of interest behind every request and export: the drawn corners, the border of the picked country,
  // or else the typed box. Null while there is nothing to ask for: before the filters and the borders arrive, and
  // for a country no record is loaded for.
  const area = useMemo((): { bbox: Bbox; geometry: AreaGeometry; wkt: string } | { problem: string } | null => {
    if (!filters) return null;
    if (filters.area) {
      return { bbox: cornersBounds(filters.area), geometry: cornersPolygon(filters.area), wkt: cornersWkt(filters.area) };
    }
    if (filters.country) {
      if (!countries || !picked) return null; // the borders are on their way, or the name is being dropped
      // The border is not repeated as well-known text: it has thousands of points (see calendarCsv).
      return pickedRegion ? { bbox: picked.bbox, geometry: picked.geometry, wkt: "" } : null;
    }
    const read = readBox(filters.box);
    if ("problem" in read) return read;
    return { bbox: read.bbox, geometry: boxPolygon(read.bbox), wkt: cornersWkt(boxCorners(read.bbox)) };
  }, [filters, countries, picked, pickedRegion]);
  const problem = area && "problem" in area ? area.problem : null;

  // Ask the API as little and as early as possible: a view seen before comes from the cache, only a box
  // typed by hand waits for a pause, and the record not on screen is fetched ahead so the switch is instant.
  useEffect(() => {
    if (!filters || !area || "problem" in area) return;
    const body: CalendarBody = { geometry: area.geometry, start: filters.start, end: filters.end, series: filters.series };
    const delay = delayFor(lastView.current, filters);
    lastView.current = filters;
    const controller = new AbortController();
    const show = (result: Calendar) => {
      setCalendar(result);
      setError(null);
      setHighlightYear((year) => (year && result.yearly.some((y) => y.year === year) ? year : (result.season_peak ?? result.anomaly).year));
      const other = otherSeries(filters.series, meta?.series ?? []);
      const ahead = other && { ...body, series: other };
      const known = ahead ? cache.current.get(ahead) : undefined;
      setOtherCalendar(known ?? null);
      if (ahead && !known) {
        fetchCalendar(ahead, controller.signal)
          .then((result) => {
            cache.current.set(ahead, result);
            if (!controller.signal.aborted) setOtherCalendar(result);
          })
          .catch(() => undefined); // a failed look-ahead costs nothing: the switch will ask again
      }
    };
    const cached = cache.current.get(body);
    if (cached) {
      setLoading(false);
      show(cached);
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetchCalendar(body, controller.signal)
        .then((result) => {
          cache.current.set(body, result);
          show(result);
        })
        .catch((reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, area, meta]);

  // Where in the area it burns most, harmonized record over the same period. Fetched with the view; its failure only
  // hides the card.
  useEffect(() => {
    if (!filters || !area || "problem" in area || !meta?.series.includes("harmonized")) {
      setTopCells(null);
      return;
    }
    const controller = new AbortController();
    fetchTopCells({ geometry: area.geometry, start: filters.start, end: filters.end }, controller.signal)
      .then(setTopCells)
      .catch(() => setTopCells(null));
    return () => controller.abort();
  }, [area, filters?.start, filters?.end, meta]);

  function showOnGlobe(cell: { lat: number; lon: number }) {
    setGlobeFocus((current) => ({ ...cell, n: (current?.n ?? 0) + 1 }));
    document.querySelector(".stage")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function download() {
    if (!filters || !area || "problem" in area) return;
    setDownloading(true);
    setExportNote(null);
    try {
      const start = `${filters.start}-01`;
      const end = lastDay(filters.end);
      const { blob, truncated } = await fetchHotspotsCsv({ geometry: area.geometry, start, end });
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
  // The harmonized record shows its parts as a strip over the yearly columns (MODIS as reported up to 2021, VIIRS
  // harmonized after); the raw record marks the month it switches sensor, where it jumps.
  const recordParts = calendar?.series === "harmonized" ? (meta?.harmonized_record ?? undefined) : undefined;
  const sensorSwitch =
    calendar?.series === "raw" && meta
      ? { year: Number(meta.raw_sensor_switch.slice(0, 4)), label: "VIIRS S-NPP replaces MODIS" }
      : undefined;
  // The seasonal chart opens on the year of the headline month.
  const year = highlightYear ?? (calendar?.season_peak ?? calendar?.anomaly)?.year ?? 0;
  // Over the harmonized columns, the raw record as a line: its jump in 2012 is what the harmonization removes.
  const rawLine =
    calendar?.series === "harmonized" && otherCalendar?.series === "raw"
      ? { yearly: otherCalendar.yearly, label: "Raw record", unit: otherCalendar.unit, columns: "Harmonized record" }
      : undefined;
  // The trust block reads the country figure only when the area is the region's whole box, as checked.
  const regionBox = meta?.regions.find((r) => r.name === filters?.region)?.bbox;
  // A country picked by its border is the whole country too, when the region is that country and not the world.
  const wholeRegion = Boolean(
    filters && !filters.area && (
      picked
        ? pickedRegion && namesCountry(pickedRegion.name, picked)
        : regionBox && filters.box.every((text, i) => Number(text) === regionBox[i])
    ),
  );
  const trusted = validation && filters ? validation.countries[filters.region] : undefined;
  // The headline month, its sensor, and what the method's error and the raw record say about it.
  const headline = calendar ? (calendar.season_peak ?? calendar.anomaly) : null;
  const headlineSensor =
    headline && calendar ? (calendar.months.find((m) => m.year === headline.year && m.month === headline.month)?.sensor ?? null) : null;
  const headlineError =
    calendar?.series === "harmonized" && trusted
      ? { share: monthError(trusted, headlineSensor, wholeRegion), modis: headlineSensor === "modis" }
      : null;
  const rawSame =
    headline && calendar?.series === "harmonized" && otherCalendar?.series === "raw"
      ? sameMonthRatio(otherCalendar, headline.year, headline.month)
      : null;
  // Only where the raw record is VIIRS (from 2012-02) does it say something else than MODIS.
  const headlineRaw = rawSame && rawSame.sensor?.startsWith("viirs") ? { ratio: rawSame.ratio } : null;
  // Unusual months and the area in words, from what the page computes; the raw record has no method error.
  const harmonizedTrust = calendar?.series === "harmonized" ? trusted : undefined;
  const unusual = useMemo(
    () =>
      calendar
        ? unusualMonths(calendar.months, (sensor) => (harmonizedTrust ? monthError(harmonizedTrust, sensor, wholeRegion) : null))
        : [],
    [calendar, harmonizedTrust, wholeRegion],
  );
  const inShort = calendar
    ? summaryLines({
        peak: (() => {
          const peak = peakMonths(calendar.climatology);
          return peak.months.length ? { months: peak.months, held: peak.held } : null;
        })(),
        yearly: calendar.yearly,
        unit: calendar.unit,
        headline: headline
          ? { year: headline.year, month: headline.month, ratio: headline.ratio, kind: verdictKind(headline.ratio, headlineError?.share ?? null) }
          : null,
        unusual,
        yearError: harmonizedTrust ? harmonizedTrust.checks.harmonized[wholeRegion ? "country_year" : "tile_year"] : null,
      })
    : [];

  function showYearOnCalendar(year: number) {
    setHighlightYear(year);
    document.getElementById("burning-calendar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Parts every exported file is named by: what, where, when and which record.
  const fileParts = filters && calendar ? [filters.region, filters.start, filters.end, calendar.series] : [];
  function saveCalendarCsv() {
    if (!calendar || !filters || !area || "problem" in area) return;
    const csv = calendarCsv(calendar, { region: filters.region, country: picked?.name, box: area.bbox, wkt: area.wkt });
    downloadBlob(new Blob([csv], { type: "text/csv" }), exportName(["burning-activity-calendar", ...fileParts], "csv"));
  }

  // What an example link keeps of the current view: the theme and the flat map.
  const presetView = new URLSearchParams();
  if (themeChoice !== "auto") presetView.set("theme", themeChoice);
  if (view === "flat") presetView.set("view", "flat");

  return (
    <>
      <GlobeBoundary>
      <Globe
        regions={meta?.regions ?? []}
        date={date}
        time={time}
        day={day}
        counts={counts}
        focusRegion={filters?.region ?? null}
        dark={dark}
        countries={countries ?? []}
        country={picked}
        countryHasData={!noData}
        onPickCountry={pickCountry}
        view={view}
        onViewChange={setView}
        area={filters?.area ?? null}
        onDrawArea={drawArea}
        areaError={filters?.area || picked ? error : null}
        period={filters ? { start: filters.start, end: filters.end } : null}
        focus={globeFocus}
        series={filters?.series}
        trendError={
          validation ? Math.max(0, ...Object.values(validation.countries).map((c) => c.checks.harmonized.tile_year)) : 0
        }
        panel={
          date && firstDay && finalDay ? (
            <DateTimePanel
              date={date}
              time={time}
              firstDay={firstDay}
              lastDay={finalDay}
              monthDays={monthDays}
              day={day}
              counts={counts}
              loading={dayLoading}
              error={dayError}
              onDate={setDate}
              onTime={setTime}
            />
          ) : null
        }
      />
      </GlobeBoundary>
      <div className="page" id="calendar">
        <header className="top">
          <div>
            <p className="subtitle">Burning activity calendar from satellite fire hotspots, 2000 to 2025</p>
            {picked && <h2 className="place">{picked.name}</h2>}
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
            hasData={!noData}
          />
        )}

        {meta && (
          <nav className="presets" aria-label="Example areas">
            <span>Examples</span>
            {PRESETS.filter((preset) => meta.regions.some((r) => r.name === preset.region)).map((preset) => (
              <a
                key={preset.name}
                href={presetHref(preset, presetView)}
                title={preset.note}
              >
                {preset.name}
              </a>
            ))}
          </nav>
        )}

        {noData && picked && meta && filters && (
          <section className="card no-data" role="status">
            <h2>{`No record for ${picked.name} yet`}</h2>
            <p>
              {`This build holds the hotspots of ${meta.regions.map((r) => r.name).join(" and ")}. Once the record of ${picked.name} is loaded, its burning activity calendar, peak months, yearly totals and unusual months appear here, counted inside its border.`}
            </p>
            <p>
              To load it, add the country to <code>config/regions.yaml</code> and run <code>make data</code>; nothing on
              this page has to change.
            </p>
            <button type="button" onClick={() => pickCountry(null)}>{`Back to ${filters.region}`}</button>
          </section>
        )}

        {!noData && error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {exportNote && <p className="notice">{exportNote}</p>}
        {!noData && picked && calendar && (
          <p className="notice">
            {`Counted inside the border of ${picked.name}: a grid cell belongs to the country when its centre is inside the border, so a cell on the border counts in full or not at all. Border: Natural Earth, simplified to about 2 km.`}
          </p>
        )}
        {!noData && calendar?.warnings.map((warning) => (
          <p className="notice" key={warning}>
            {warning}
          </p>
        ))}
        {!noData && calendar?.series === "raw" && meta && (
          <p className="notice">
            {`Raw record: MODIS before ${monthLabel(meta.raw_sensor_switch)}, VIIRS S-NPP from then on, counted as ${calendar.unit} with no correction. VIIRS sees many small fires that MODIS misses, so the values jump at that month and cannot be compared across it.`}
          </p>
        )}
        {!noData && calendar?.series === "harmonized" && meta?.harmonized_record && (
          <p className="notice">
            {`Harmonized record, in ${calendar.unit}: each value is the number of 1 km cells with fire on a day, as MODIS Terra + Aqua would have reported them, so ${meta.harmonized_record[0].from.slice(0, 4)} and ${meta.last_month?.slice(0, 4)} can be compared. ${meta.harmonized_record.map((part) => `${part.label}: ${part.to ? `${monthLabel(part.from)} to ${monthLabel(part.to)}` : `from ${monthLabel(part.from)}`}`).join("; ")}.`}
            {trusted && (
              <>
                {" "}
                <a href="#trust">How far to trust it</a>
              </>
            )}
          </p>
        )}

        {!noData && !calendar && !error && <p className="notice">Loading the record...</p>}

        {!noData && calendar && (
          <main className={loading ? "content is-loading" : "content"} aria-busy={loading}>
            <AnomalyTiles
              anomaly={calendar.season_peak ?? calendar.anomaly}
              climatology={calendar.climatology}
              unit={unit}
              busiest={Boolean(calendar.season_peak)}
              error={headlineError}
              raw={headlineRaw}
              recordEnd={meta?.last_month ?? null}
            />

            <InShort lines={inShort} />

            <ChartCard
              id="burning-calendar"
              title="Burning activity calendar"
              subtitle={`Monthly ${unit} in the area, over ${calendar.cells_used.toLocaleString("en-US")} ${calendar.cells_used === 1 ? "grid cell" : "grid cells"} with burning`}
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
              pngName={exportName(["burning-activity-calendar", ...fileParts], "png")}
              downloads={
                <button type="button" className="ghost download" onClick={saveCalendarCsv}>
                  Download calendar data (CSV)
                </button>
              }
            />

            <UnusualMonths
              unusual={unusual}
              unit={unit}
              raw={calendar.series === "raw"}
              onShow={showYearOnCalendar}
            />

            <ChartCard
              title="Peak burning months"
              subtitle={`The fewest months that together hold ${Math.round(PEAK_SHARE * 100)}% of a typical year, where a typical year adds up each month's median over every year of the record. Burning activity, not fire risk.${calendar.series === "raw" ? " Counted on the raw record, which jumps in 2012; the harmonized record compares the years fairly." : ""}`}
              chart={
                <>
                  <PeakMonthsSummary climatology={calendar.climatology} />
                  <PeakMonthsChart climatology={calendar.climatology} unit={unit} />
                </>
              }
              table={
                <>
                  <PeakMonthsSummary climatology={calendar.climatology} />
                  <PeakMonthsTable climatology={calendar.climatology} unit={unit} />
                </>
              }
              pngName={exportName(["peak-burning-months", ...fileParts], "png")}
            />

            {topCells && <TopPlaces top={topCells} onShow={showOnGlobe} />}

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
                pngName={exportName([`season-${year}`, ...fileParts], "png")}
              />
              <ChartCard
                title="Burning per year"
                subtitle={
                  rawLine && meta
                    ? `Yearly ${unit} within the selected period. The line is the raw record: MODIS before ${monthLabel(meta.raw_sensor_switch)}, VIIRS S-NPP from then on, in ${rawLine.unit} with no correction`
                    : `Yearly ${unit} within the selected period`
                }
                chart={
                  <YearlyChart
                    yearly={calendar.yearly}
                    unit={unit}
                    sensorSwitch={sensorSwitch}
                    line={rawLine}
                    record={recordParts}
                  />
                }
                table={<YearlyTable yearly={calendar.yearly} unit={unit} line={rawLine} record={recordParts} />}
                pngName={exportName(["burning-per-year", ...fileParts], "png")}
              />
            </div>

            {validation && filters && <TrustBlock validation={validation} region={filters.region} wholeRegion={wholeRegion} />}
          </main>
        )}

        <footer className="credit">
          Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). This project is not affiliated with or endorsed by NASA.
        </footer>
      </div>
    </>
  );
}
