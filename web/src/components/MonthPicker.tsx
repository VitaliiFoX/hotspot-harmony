import { useId } from 'react';
import { MONTH_NAMES, formatYM, parseYM, type YM } from '../lib/ym';

interface MonthPickerProps {
  label: string;
  /** "YYYY-MM" */
  value: string;
  /** "YYYY-MM", inclusive bounds */
  min: string;
  max: string;
  onChange: (value: string) => void;
}

function clamp(ym: YM, min: YM, max: YM): YM {
  const index = ym.year * 12 + ym.month;
  if (index < min.year * 12 + min.month) return min;
  if (index > max.year * 12 + max.month) return max;
  return ym;
}

/**
 * Month + year as two selects. `<input type="month">` is not supported by every
 * desktop browser, and selects work with the keyboard everywhere.
 */
export function MonthPicker({ label, value, min, max, onChange }: MonthPickerProps) {
  const id = useId();
  const minYM = parseYM(min) ?? { year: 2000, month: 1 };
  const maxYM = parseYM(max) ?? { year: 2100, month: 12 };
  const current = parseYM(value) ?? minYM;
  const years: number[] = [];
  for (let y = minYM.year; y <= maxYM.year; y += 1) years.push(y);

  const emit = (next: YM) => onChange(formatYM(clamp(next, minYM, maxYM)));

  return (
    <div className="month-picker" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="field-label">
        {label}
      </span>
      <div className="month-picker__selects">
        <select
          aria-label={`${label}: month`}
          value={current.month}
          onChange={(e) => emit({ year: current.year, month: Number(e.target.value) })}
        >
          {MONTH_NAMES.map((name, i) => {
            const month = i + 1;
            const disabled =
              (current.year === minYM.year && month < minYM.month) ||
              (current.year === maxYM.year && month > maxYM.month);
            return (
              <option key={name} value={month} disabled={disabled}>
                {name}
              </option>
            );
          })}
        </select>
        <select
          aria-label={`${label}: year`}
          value={current.year}
          onChange={(e) => emit({ year: Number(e.target.value), month: current.month })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
