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

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

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
  const dayUnit = monthDays?.unit ?? day?.unit ?? "";

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
  if (loading) status = "Loading the hotspots of this day...";
  else if (error) status = `Cannot load this day: ${error}`;
  else if (day && day.count === 0) status = "No hotspots on this day.";

  return (
    <section className="dt-panel" aria-label="Date and time">
      <div className="dt-sheen" aria-hidden="true" />
      <div className="dt-heading">
        <h2 className="dt-date">{longDate(date)}</h2>
        <p className="dt-secondary">{`Hotspots from 00:00 through ${timeLabel(time)} UTC`}</p>
      </div>

      <div className="dt-month">
        <button
          type="button"
          className="dt-round"
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() => onDate(moveToMonth(date, shiftMonth(month, -1), firstDay, lastDay))}
        >
          <Chevron direction="left" />
        </button>
        <div className="dt-month-name">
          <span>{longMonth(month).split(" ")[0]}</span>
          <label className="dt-year">
            <span className="dt-hidden">Year</span>
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
          aria-label="Next month"
          disabled={!canGoForward}
          onClick={() => onDate(moveToMonth(date, shiftMonth(month, 1), firstDay, lastDay))}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <div className="dt-calendar">
        <div className="dt-weekdays" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <span key={name}>{name.toUpperCase()}</span>
          ))}
        </div>
        <div className="dt-days" role="group" aria-label={`Days of ${longMonth(month)}`} onKeyDown={onGridKey}>
          {grid.map((d, index) => {
            if (d === null) return <span key={`blank-${index}`} aria-hidden="true" />;
            const value = values.get(d);
            const dot = value === undefined ? null : dotStyle(value, monthMax);
            const label =
              value === undefined
                ? longDate(d)
                : `${longDate(d)}, ${value.toLocaleString("en-US")} ${dayUnit}`.trim();
            return (
              <button
                key={d}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                className="dt-day"
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
            Time, UTC
          </label>
          <div className="dt-time-controls">
            <input
              className="dt-time-input"
              type="text"
              inputMode="numeric"
              maxLength={5}
              pattern="[0-2]?[0-9]:[0-5][0-9]"
              aria-label="Time, UTC, as HH:MM"
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
              aria-label={playing ? "Pause the clock" : "Play the day"}
              title={playing ? "Pause" : "Play the day"}
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
        {status && <p className="dt-status">{status}</p>}
        {!loading && !error && day && counts && day.count > 0 && (
          <>
            <p className="dt-big">{counts.throughHour.toLocaleString("en-US")}</p>
            <p className="dt-secondary">{`${day.unit} so far that day`}</p>
            <dl className="dt-figures">
              {day.regions.map((name, index) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{(counts.regions[index]?.throughHour ?? 0).toLocaleString("en-US")}</dd>
                </div>
              ))}
              <div>
                <dt>Last hour</dt>
                <dd>{counts.inHour.toLocaleString("en-US")}</dd>
              </div>
            </dl>
            {day.truncated && (
              <p className="dt-status">
                {`This day is cut at ${day.hotspots.length.toLocaleString("en-US")} hotspots, so the figures are lower than the full record.`}
              </p>
            )}
          </>
        )}
      </div>
      {day && <p className="dt-sensor">{`Sensor: ${sensorLabel(day.sensor)}`}</p>}
    </section>
  );
}
