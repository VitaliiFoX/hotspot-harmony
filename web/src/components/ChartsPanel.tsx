import { useMemo } from 'react';
import type { ClimatologyMonth, YearValue } from '../api/types';
import { buildSeasonalOption, buildYearlyOption, latestYear } from '../charts/chartOptions';
import type { MonthGrid, RecordMode } from '../lib/monthGrid';
import { EChart } from './EChart';

interface ChartsPanelProps {
  grid: MonthGrid;
  climatology: readonly ClimatologyMonth[];
  yearly: readonly YearValue[];
  mode: RecordMode;
  unit: string;
}

/** Seasonal profile and yearly totals. */
export function ChartsPanel({ grid, climatology, yearly, mode, unit }: ChartsPanelProps) {
  const seasonal = useMemo(
    () => buildSeasonalOption({ climatology, grid, unit }),
    [climatology, grid, unit],
  );
  const yearlyOption = useMemo(
    () => buildYearlyOption({ yearly, mode, unit }),
    [yearly, mode, unit],
  );
  const year = latestYear(grid);
  const hasIncomplete = yearly.some((y) => !y.complete);

  return (
    <div className="charts">
      <section className="card" aria-labelledby="seasonal-heading">
        <h2 id="seasonal-heading">Seasonal profile</h2>
        <p className="note">
          The usual level for each calendar month (median of all years, harmonized record), the band
          that holds the middle half of years (25th to 75th percentile), and{' '}
          {year ?? 'the latest year'} on top.
        </p>
        <EChart
          option={seasonal}
          height={280}
          label={`Line chart of the usual ${unit} per calendar month with the range of the middle half of years, and the year ${year ?? ''} for comparison.`}
        />
      </section>

      <section className="card" aria-labelledby="yearly-heading">
        <h2 id="yearly-heading">Yearly totals</h2>
        <p className="note">
          Harmonized and raw totals per year. The dotted line marks 2012, when the raw record
          switches from MODIS to VIIRS counts.
          {hasIncomplete ? ' Hollow points are incomplete years.' : ''}
        </p>
        <EChart
          option={yearlyOption}
          height={280}
          label={`Line chart of ${unit} per year: harmonized record and raw record, with a marker at 2012 where VIIRS begins.`}
        />
      </section>
    </div>
  );
}
