import type { TopMonth } from '../api/types';
import { formatCount, formatRatio } from '../lib/format';
import type { Headline } from '../lib/headline';
import { shortLabelYM, type YM } from '../lib/ym';

interface HeadlineBlockProps {
  headline: Headline;
  topMonths: readonly TopMonth[];
  highlight: YM | null;
  onHighlight: (ym: YM | null) => void;
}

/** Plain-language summary plus the months that stand out most. */
export function HeadlineBlock({ headline, topMonths, highlight, onHighlight }: HeadlineBlockProps) {
  return (
    <div className="headline">
      <p className="headline__text">{headline.text}</p>
      {headline.note ? <p className="headline__note">{headline.note}</p> : null}
      {topMonths.length > 0 ? (
        <div className="top-months">
          <h3 className="mini-heading" id="top-months-heading">
            Most unusual months
          </h3>
          <ul className="chip-row" aria-labelledby="top-months-heading">
            {topMonths.map((top) => {
              const active = highlight?.year === top.year && highlight.month === top.month;
              const detail =
                top.ratio === null
                  ? `${formatCount(top.value)}, usually none`
                  : `${formatCount(top.value)}, ${formatRatio(top.ratio)} usual`;
              return (
                <li key={`${top.year}-${top.month}`}>
                  <button
                    type="button"
                    className="chip chip--data"
                    aria-pressed={active}
                    onClick={() =>
                      onHighlight(active ? null : { year: top.year, month: top.month })
                    }
                  >
                    <strong>{shortLabelYM(top)}</strong>
                    <span>{detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="note">Select a month to point at it in the calendar.</p>
        </div>
      ) : null}
    </div>
  );
}
