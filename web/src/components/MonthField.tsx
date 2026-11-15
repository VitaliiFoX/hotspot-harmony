import { useEffect, useId, useRef, useState } from "react";
import { monthShort, monthTitle, t } from "../i18n";
import { monthAllowed, shiftMonth } from "../nav";

type Props = {
  /** What the field is, read out before the month: "Period, from". */
  label: string;
  /** The month chosen, as `YYYY-MM`. */
  value: string;
  /** The first and the last month that can be chosen, both `YYYY-MM`. */
  min: string;
  max: string;
  onChange: (month: string) => void;
};

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** How far each key moves through the months of the grid, which is three months wide. */
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 };

/**
 * A month of a year, picked as the region is: a button that names the month and opens a card with the year
 * between two arrows over its twelve months. The browser's own month field writes its months in the language of
 * the browser, not of the page, and its lists open in the browser's own style; this one follows the page in both,
 * and offers only the months the record has. Arrow keys move a month or a row, Page Up and Page Down a year,
 * Enter takes the month, Escape closes.
 */
export function MonthField({ label, value, min, max, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // The month the keyboard is on; its year is the one the card shows.
  const [view, setView] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  const year = Number(view.slice(0, 4));
  const month = Number(view.slice(5, 7));

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }
  function pick(next: string) {
    close(true);
    if (next !== value) onChange(next);
  }

  // A click anywhere else closes the card, as a native select does.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The focus follows the month the keyboard is on.
  useEffect(() => {
    if (open && grid.current?.contains(document.activeElement)) {
      grid.current.querySelector<HTMLButtonElement>(`[data-month="${month}"]`)?.focus();
    }
  }, [open, view]);

  function onGridKey(event: React.KeyboardEvent) {
    const step = STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setView(shiftMonth(view, step, min, max));
    }
  }

  return (
    <div
      className="month-field"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <span className="month-field-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        className="month-field-button"
        id={`${id}-button`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-button`}
        onClick={() => {
          if (open) close(false);
          else {
            setView(value);
            setOpen(true);
          }
        }}
      >
        <CalendarIcon />
        <span>
          {monthTitle(Number(value.slice(5, 7)))} {value.slice(0, 4)}
        </span>
      </button>
      {open && (
        <div className="month-field-pop" role="dialog" aria-labelledby={`${id}-label`}>
          <div className="month-field-year">
            <button
              type="button"
              aria-label={t("Previous year")}
              disabled={year <= Number(min.slice(0, 4))}
              onClick={() => setView(shiftMonth(view, -12, min, max))}
            >
              ‹
            </button>
            <strong aria-live="polite">{year}</strong>
            <button
              type="button"
              aria-label={t("Next year")}
              disabled={year >= Number(max.slice(0, 4))}
              onClick={() => setView(shiftMonth(view, 12, min, max))}
            >
              ›
            </button>
          </div>
          <div className="month-field-grid" ref={grid} onKeyDown={onGridKey}>
            {MONTHS.map((item) => {
              const text = `${year}-${String(item).padStart(2, "0")}`;
              return (
                <button
                  key={item}
                  type="button"
                  data-month={item}
                  aria-label={`${monthTitle(item)} ${year}`}
                  aria-pressed={text === value}
                  disabled={!monthAllowed(year, item, min, max)}
                  tabIndex={item === month ? 0 : -1}
                  // The month the card opens on takes the focus, so the keys work at once.
                  autoFocus={item === month}
                  onClick={() => pick(text)}
                >
                  {monthShort(item)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
