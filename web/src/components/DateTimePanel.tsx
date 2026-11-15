import { formatCount, t, tn } from "../i18n";
import { type Span, type View, cursorLabel, inSpan, makeSpan, monthLabel, spanDays, spanLabel, spanNote } from "../period";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DayHotspots, MonthDays } from "../api";
import {
  type HourCounts, LAST_MINUTE, dayKey, dotStyle, longDate, longMonth, monthGrid, moveToMonth, parseTimeParam, sensorLabel, shiftMonth, timeLabel,
  zeroNote,
} from "../globe";

type Props = {
  date: string;
  /** Minutes after 00:00 UTC. */
  time: number;
  firstDay: string;
  lastDay: string;
  monthDays: MonthDays | null;
  day: DayHotspots | null;
  counts: HourCounts | null;
  loading: boolean;
  error: string | null;
  onDate: (date: string) => void;
  onTime: (time: number) => void;
  /** One day, a calendar month or a period from day to day. */
  view: View;
  /** The month or period on screen; null for one day. */
  span: Span | null;
  /** Day of the span the slider is on, 0 for its first. */
  cursor: number;
  onView: (view: View) => void;
  onPeriod: (span: Span) => void;
  onCursor: (day: number) => void;
};

const VIEWS: readonly { view: View; label: string }[] = [
  { view: "day", label: "Day" },
  { view: "month", label: "Month" },
  { view: "period", label: "Period" },
];

/** Sensor ids as people read them; a span across the 2012 switch has two, joined by "+". */
function sensorsLabel(sensor: string): string {
  return sensor.split("+").map(sensorLabel).join(", ");
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Playback: the clock moves PLAY_STEP minutes every PLAY_TICK_MS, so a whole day plays in about 24 seconds. */
const PLAY_STEP = 5;
const PLAY_TICK_MS = 80;

/** The floating glass panel that picks the UTC day and minute the globe shows, plays the day, and reads out its hotspots. */
export function DateTimePanel({
  date, time, firstDay, lastDay, monthDays, day, counts, loading, error, onDate, onTime,
  view, span, cursor, onView, onPeriod, onCursor,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const days = span ? spanDays(span) : 0;
  // The slider runs over the minutes of a day, or over the days of a span; playback moves it to the end.
  const position = span ? cursor : time;
  const end = span ? days - 1 : LAST_MINUTE;
  const move = span ? onCursor : onTime;
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    if (!playing) return;
    // A day plays in about 24 seconds; a span in 6 to 15, however many days it has.
    const tick = span ? Math.max(40, Math.min(500, 12_000 / days)) : PLAY_TICK_MS;
    const timer = window.setInterval(() => {
      const next = Math.min(end, positionRef.current + (span ? 1 : PLAY_STEP));
      move(next);
      if (next >= end) setPlaying(false);
    }, tick);
    return () => window.clearInterval(timer);
  }, [playing, move, end, span, days]);
  // A new day or span stops the clock where it is.
  useEffect(() => setPlaying(false), [date, view, span?.start, span?.end]);
  // The first day of a period being picked, until its last day is clicked; and the day under the pointer meanwhile.
  const [pending, setPending] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => setPending(null), [view]);
  const shownSpan = pending ? makeSpan(pending, hovered ?? pending, firstDay, lastDay) : span;
  function pickDay(d: string) {
    if (view !== "period") return onDate(d);
    if (pending === null) return setPending(d);
    onPeriod(makeSpan(pending, d, firstDay, lastDay));
    setPending(null);
  }
  // The typed time, while it is being edited; HH:MM in 24-hour form, whatever the browser's locale.
  const [draft, setDraft] = useState<string | null>(null);
  function commitDraft() {
    const parsed = draft === null ? null : parseTimeParam(draft.trim());
    if (parsed !== null) onTime(parsed);
    setDraft(null);
  }
  function togglePlay() {
    if (!playing && position >= end) move(0); // at the end, play from the start
    setPlaying(!playing);
  }
  const month = date.slice(0, 7);
  const grid = useMemo(() => monthGrid(month), [month]);
  const values = useMemo(() => {
    const byDay = new Map<string, number>();
    if (monthDays?.month === month) for (const item of monthDays.days) byDay.set(dayKey(month, item.day), item.value);
    return byDay;
  }, [monthDays, month]);
  const monthMax = Math.max(0, ...values.values());
  // Days the sensor was down: no dot must read as "no fires" there.
  const gaps = useMemo(
    () => new Set(monthDays?.month === month ? (monthDays.gap_days ?? []).map((d) => dayKey(month, d)) : []),
    [monthDays, month],
  );
  const gapSensor = sensorLabel(monthDays?.sensor ?? day?.sensor ?? "");
  const dayUnit = t(monthDays?.unit ?? day?.unit ?? "");

  const firstYear = Number(firstDay.slice(0, 4));
  const lastYear = Number(lastDay.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
  const canGoBack = shiftMonth(month, -1) >= firstDay.slice(0, 7);
  const canGoForward = shiftMonth(month, 1) <= lastDay.slice(0, 7);

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const enabled = (d: string | null): d is string => d !== null && d >= firstDay && d <= lastDay;
  const tabbable =
    (focusDay && grid.includes(focusDay) && enabled(focusDay) && focusDay) ||
    (grid.includes(date) ? date : grid.find(enabled) ?? null);

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    const current = tabbable ? grid.indexOf(tabbable) : -1;
    if (step === undefined || current < 0) return;
    event.preventDefault();
    let next = current + step;
    while (next >= 0 && next < grid.length && !enabled(grid[next])) next += Math.sign(step);
    const target = grid[next];
    if (next < 0 || next >= grid.length || !enabled(target)) return;
    setFocusDay(target);
    buttons.current[next]?.focus();
  }

  let status: string | null = null;
  if (loading) status = span ? t("Loading the hotspots of these days...") : t("Loading the hotspots of this day...");
  else if (error) status = span ? t("Cannot load these days: {error}", { error }) : t("Cannot load this day: {error}", { error });
  else if (span && day?.gap_days?.length)
    status = tn(
      day.gap_days.length,
      "{sensor} was down on {n} day of this span, so its hotspots are missing or incomplete there.",
      "{sensor} was down on {n} days of this span, so its hotspots are missing or incomplete there.",
      { sensor: sensorsLabel(day.sensor) },
    );
  else if (span && day && day.count === 0)
    status = t("No hotspots in these days. Clouds and smoke can hide fires from the satellites, so this is not proof there were none.");
  else if (span) status = null;
  else if (day?.sensor_gap)
    status = t(
      "{sensor} was down on this day, so its hotspots are missing or incomplete: a low count or a zero here is missing data, not a quiet day.",
      { sensor: sensorLabel(day.sensor) },
    );
  else if (day && day.count === 0)
    status = t("No hotspots on this day. Clouds and smoke can hide fires from the satellites, so this is not proof there were none.");
  const zero = day && counts ? zeroNote(day.regions, counts, Boolean(span)) : null;

  return (
    <section className="dt-panel" aria-label={t("Date and time")}>
      <div className="dt-sheen" aria-hidden="true" />
      <div className="dt-views segmented" role="group" aria-label={t("Show")}>
        {VIEWS.map((item) => (
          <button key={item.view} type="button" aria-pressed={view === item.view} onClick={() => onView(item.view)}>
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className="dt-heading">
        <h2 className="dt-date">
          {view === "day" || !span ? longDate(date) : view === "month" ? monthLabel(span.start) : spanLabel(shownSpan ?? span)}
        </h2>
        <p className="dt-secondary">
          {!span
            ? t("Hotspots from 00:00 through {time} UTC", { time: timeLabel(time) })
            : pending
              ? t("Now click the last day; Esc starts over.")
              : view === "period"
                ? `${spanNote(view, span)}. ${t("Click a first and a last day to pick another.")}`
                : spanNote(view, span)}
        </p>
      </div>

      <div className="dt-month">
        <button
          type="button"
          className="dt-round"
          aria-label={t("Previous month")}
          disabled={!canGoBack}
          onClick={() => onDate(moveToMonth(date, shiftMonth(month, -1), firstDay, lastDay))}
        >
          <Chevron direction="left" />
        </button>
        <div className="dt-month-name">
          <span>{longMonth(month).split(" ")[0]}</span>
          <label className="dt-year">
            <span className="dt-hidden">{t("Year")}</span>
            <select
              value={Number(month.slice(0, 4))}
              onChange={(event) => onDate(moveToMonth(date, `${event.target.value}-${month.slice(5, 7)}`, firstDay, lastDay))}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="dt-round"
          aria-label={t("Next month")}
          disabled={!canGoForward}
          onClick={() => onDate(moveToMonth(date, shiftMonth(month, 1), firstDay, lastDay))}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <div className="dt-calendar">
        <div className="dt-weekdays" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <span key={name}>{t(name).toUpperCase()}</span>
          ))}
        </div>
        <div
          className={view === "day" ? "dt-days" : "dt-days is-span"}
          role="group"
          aria-label={t("Days of {month}", { month: longMonth(month) })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && pending) setPending(null);
            onGridKey(event);
          }}
          onPointerLeave={() => setHovered(null)}
        >
          {grid.map((d, index) => {
            if (d === null) return <span key={`blank-${index}`} aria-hidden="true" />;
            const value = values.get(d);
            const dot = value === undefined ? null : dotStyle(value, monthMax);
            const gap = gaps.has(d);
            const label =
              (value === undefined
                ? longDate(d)
                : `${longDate(d)}, ${formatCount(value)} ${dayUnit}`.trim())
              + (gap ? t(", {sensor} was down: missing data", { sensor: gapSensor }) : "");
            const within = view !== "day" && inSpan(d, shownSpan);
            const classes = [
              "dt-day",
              gap && "is-gap",
              within && "is-in-span",
              within && d === shownSpan?.start && "is-span-start",
              within && d === shownSpan?.end && "is-span-end",
              pending === d && "is-pending",
            ];
            return (
              <button
                key={d}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                className={classes.filter(Boolean).join(" ")}
                title={gap ? t("{sensor} was down: missing data, not a quiet day", { sensor: gapSensor }) : undefined}
                disabled={!enabled(d)}
                aria-pressed={view === "day" ? d === date : within}
                aria-label={label}
                tabIndex={d === tabbable ? 0 : -1}
                onFocus={() => setFocusDay(d)}
                onPointerEnter={() => setHovered(d)}
                onClick={() => pickDay(d)}
              >
                <span>{Number(d.slice(8, 10))}</span>
                <i
                  className="dt-dot"
                  aria-hidden="true"
                  style={dot ? { width: dot.size, height: dot.size, opacity: dot.opacity } : { visibility: "hidden" }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="dt-divider" />

      <div className="dt-time">
        <div className="dt-time-row">
          <label htmlFor="dt-time" className="dt-secondary">
            {span ? t("Through the day") : t("Time, UTC")}
          </label>
          <div className="dt-time-controls">
            {span ? (
              <output className="dt-time-input dt-cursor" htmlFor="dt-time">
                {cursorLabel(span, cursor)}
              </output>
            ) : (
            <input
              className="dt-time-input"
              type="text"
              inputMode="numeric"
              maxLength={5}
              pattern="[0-2]?[0-9]:[0-5][0-9]"
              aria-label={t("Time, UTC, as HH:MM")}
              value={draft ?? timeLabel(time)}
              onFocus={() => setPlaying(false)}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitDraft();
                if (event.key === "Escape") setDraft(null);
              }}
            />
            )}
            <button
              type="button"
              className="dt-round dt-play"
              aria-pressed={playing}
              aria-label={playing ? t("Pause the clock") : span ? t("Play the days") : t("Play the day")}
              title={playing ? t("Pause") : span ? t("Play the days") : t("Play the day")}
              onClick={togglePlay}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <input
          id="dt-time"
          type="range"
          min={0}
          max={end}
          step={1}
          value={position}
          aria-valuetext={span ? cursorLabel(span, cursor) : `${timeLabel(time)} UTC`}
          onChange={(event) => {
            setPlaying(false);
            move(Number(event.target.value));
          }}
        />
        <div className="dt-time-ends dt-secondary" aria-hidden="true">
          <span>{span ? cursorLabel(span, 0) : "00:00"}</span>
          <span>{span ? cursorLabel(span, days - 1) : "23:59"}</span>
        </div>
      </div>

      <div className="dt-readout" aria-live="polite">
        {status && <p className="dt-status">{status}</p>}
        {!loading && !error && day && counts && day.count > 0 && (
          <>
            <p className="dt-big">{formatCount(counts.throughHour)}</p>
            <p className="dt-secondary">
              {span
                ? t("{unit} from {first} through {day}", {
                    unit: t(day.unit), first: cursorLabel(span, 0), day: cursorLabel(span, cursor),
                  })
                : t("{unit} so far that day", { unit: t(day.unit) })}
            </p>
            <dl className="dt-figures">
              {day.regions.map((name, index) => (
                <div key={name}>
                  <dt>{t(name)}</dt>
                  <dd className={(counts.regions[index]?.throughHour ?? 0) === 0 ? "is-zero" : undefined}>
                    {formatCount(counts.regions[index]?.throughHour ?? 0)}
                  </dd>
                </div>
              ))}
              <div>
                <dt>{span ? t("That day") : t("Last hour")}</dt>
                <dd className={counts.inHour === 0 ? "is-zero" : undefined}>{formatCount(counts.inHour)}</dd>
              </div>
            </dl>
            {zero && <p className="dt-note">{zero}</p>}
            {day.truncated && (
              <p className="dt-status">
                {span
                  ? t("These days hold {count} hotspots; the globe and these figures show an even sample of {shown}.", {
                      count: formatCount(day.count), shown: formatCount(day.hotspots.length),
                    })
                  : t("This day is cut at {count} hotspots, so the figures are lower than the full record.", {
                      count: formatCount(day.hotspots.length),
                    })}
              </p>
            )}
          </>
        )}
      </div>
      {day && <p className="dt-sensor">{t("Sensor: {sensor}", { sensor: sensorsLabel(day.sensor) })}</p>}
    </section>
  );
}
