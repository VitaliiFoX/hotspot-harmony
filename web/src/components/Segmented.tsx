import { useId } from 'react';

interface SegmentedProps<T extends string> {
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Larger, more prominent styling. */
  prominent?: boolean;
  /** Hide the legend visually (it stays available to screen readers). */
  hideLegend?: boolean;
}

/** A group of radio buttons styled as one segmented control. Fully keyboard operable. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  prominent = false,
  hideLegend = false,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={`segmented${prominent ? ' segmented--prominent' : ''}`}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
