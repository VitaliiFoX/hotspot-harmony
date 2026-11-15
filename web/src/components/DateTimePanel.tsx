import { formatCount, t } from "../i18n";
import { ReadoutSkeleton } from "./Skeleton";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DayHotspots, MonthDays } from "../api";
import {
  type HourCounts, LAST_MINUTE, dayKey, dotStyle, longDate, longMonth, monthGrid, moveToMonth, parseTimeParam, sensorLabel, shiftMonth, timeLabel,
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
};

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
}: Props) {
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = Math.min(LAST_MINUTE, timeRef.current + PLAY_STEP);
      onTime(next);
      if (next >= LAST_MINUTE) setPlaying(false);
    }, PLAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, onTime]);
  // A new day stops the clock where it is.
  useEffect(() => setPlaying(false), [date]);
  // The typed time, while it is being edited; HH:MM in 24-hour form, whatever the browser's locale.
  const [draft, setDraft] = useState<string | null>(null);
  function commitDraft() {
    const parsed = draft === null ? null : parseTimeParam(draft.trim());
    if (parsed !== null) onTime(parsed);
    setDraft(null);
  }
  function togglePlay() {
    if (!playing && time >= LAST_MINUTE) onTime(0); // at the end of the day, play from the start
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
  if (loading) status = t("Loading the hotspots of this day...");
  else if (error) status = t("Cannot load this day: {error}", { error });
  else if (day?.sensor_gap)
    status = t(
      "{sensor} was down on this day, so its hotspots are missing or incomplete: a low count or a zero here is missing data, not a quiet day.",
      { sensor: sensorLabel(day.sensor) },
    );
  else if (day && day.count === 0) status = t("No hotspots on this day.");

  return (
    <section className="dt-panel" aria-label={t("Date and time")}>
      <div className="dt-sheen" aria-hidden="true" />
      <div className="dt-heading">
        <h2 className="dt-date">{longDate(date)}</h2>
        <p className="dt-secondary">{t("Hotspots from 00:00 through {time} UTC", { time: timeLabel(time) })}</p>
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
        <div className="dt-days" role="group" aria-label={t("Days of {month}", { month: longMonth(month) })} onKeyDown={onGridKey}>
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
            return (
              <button
                key={d}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                className={gap ? "dt-day is-gap" : "dt-day"}
                title={gap ? t("{sensor} was down: missing data, not a quiet day", { sensor: gapSensor }) : undefined}
                disabled={!enabled(d)}
                aria-pressed={d === date}
                aria-label={label}
                tabIndex={d === tabbable ? 0 : -1}
                onFocus={() => setFocusDay(d)}
                onClick={() => onDate(d)}
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
            {t("Time, UTC")}
          </label>
          <div className="dt-time-controls">
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
            <button
              type="button"
              className="dt-round dt-play"
              aria-pressed={playing}
              aria-label={playing ? t("Pause the clock") : t("Play the day")}
              title={playing ? t("Pause") : t("Play the day")}
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
          max={LAST_MINUTE}
          step={1}
          value={time}
          aria-valuetext={`${timeLabel(time)} UTC`}
          onChange={(event) => {
            setPlaying(false);
            onTime(Number(event.target.value));
          }}
        />
        <div className="dt-time-ends dt-secondary" aria-hidden="true">
          <span>00:00</span>
          <span>23:59</span>
        </div>
      </div>

      <div className="dt-readout" aria-live="polite">
        {status && <p className={loading ? "dt-hidden" : "dt-status"}>{status}</p>}
        {loading && <ReadoutSkeleton />}
        {!loading && !error && day && counts && day.count > 0 && (
          <>
            <p className="dt-big">{formatCount(counts.throughHour)}</p>
            <p className="dt-secondary">{t("{unit} so far that day", { unit: t(day.unit) })}</p>
            <dl className="dt-figures">
              {day.regions.map((name, index) => (
                <div key={name}>
                  <dt>{t(name)}</dt>
                  <dd>{formatCount(counts.regions[index]?.throughHour ?? 0)}</dd>
                </div>
              ))}
              <div>
                <dt>{t("Last hour")}</dt>
                <dd>{formatCount(counts.inHour)}</dd>
              </div>
            </dl>
            {day.truncated && (
              <p className="dt-status">
                {t("This day is cut at {count} hotspots, so the figures are lower than the full record.", {
                  count: formatCount(day.hotspots.length),
                })}
              </p>
            )}
          </>
        )}
      </div>
      {day && <p className="dt-sensor">{t("Sensor: {sensor}", { sensor: sensorLabel(day.sensor) })}</p>}
    </section>
  );
}
