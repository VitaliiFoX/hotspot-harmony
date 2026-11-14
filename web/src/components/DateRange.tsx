import { MonthPicker } from './MonthPicker';

interface DateRangeProps {
  /** Series bounds, "YYYY-MM". */
  seriesStart: string;
  seriesEnd: string;
  /** Selected bounds; null means "the series bound". */
  start: string | null;
  end: string | null;
  onChange: (range: { start: string | null; end: string | null }) => void;
  error: string | null;
}

/** Date range of the calendar. The default is the whole series. */
export function DateRange({ seriesStart, seriesEnd, start, end, onChange, error }: DateRangeProps) {
  const whole = start === null && end === null;
  const normal = (value: string, bound: string) => (value === bound ? null : value);
  return (
    <div className="date-range">
      <h3 className="mini-heading">Date range</h3>
      <div className="date-range__row">
        <MonthPicker
          label="From"
          value={start ?? seriesStart}
          min={seriesStart}
          max={seriesEnd}
          onChange={(value) => onChange({ start: normal(value, seriesStart), end })}
        />
        <MonthPicker
          label="To"
          value={end ?? seriesEnd}
          min={seriesStart}
          max={seriesEnd}
          onChange={(value) => onChange({ start, end: normal(value, seriesEnd) })}
        />
        <button
          type="button"
          className="button"
          disabled={whole}
          onClick={() => onChange({ start: null, end: null })}
        >
          Whole series
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
