import { monthTitle, t } from "../i18n";
import { monthAllowed, pickMonth, yearsBetween } from "../nav";

type Props = {
  /** What the field is, read out before "month" and "year": "Period, from". */
  label: string;
  /** The month chosen, as `YYYY-MM`. */
  value: string;
  /** The first and the last month that can be chosen, both `YYYY-MM`. */
  min: string;
  max: string;
  onChange: (month: string) => void;
};

/**
 * A month of a year as two lists, month and year. The browser's own month field is a plain text box in Firefox
 * and Safari and writes its months in the language of the browser, not of the page; two lists work the same
 * everywhere, with a keyboard and on a phone, and offer only the months the record has.
 */
export function MonthField({ label, value, min, max, onChange }: Props) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return (
    <div className="month-field" role="group" aria-label={label}>
      <span className="month-field-label" aria-hidden="true">
        {label}
      </span>
      <div className="month-field-lists">
        <select
          aria-label={`${label}: ${t("Month")}`}
          value={month}
          onChange={(event) => onChange(pickMonth(year, Number(event.target.value), min, max))}
        >
          {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => (
            <option key={item} value={item} disabled={!monthAllowed(year, item, min, max)}>
              {monthTitle(item)}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label}: ${t("Year")}`}
          value={year}
          onChange={(event) => onChange(pickMonth(Number(event.target.value), month, min, max))}
        >
          {yearsBetween(min, max).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
