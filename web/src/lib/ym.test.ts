import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareYM,
  daysInMonth,
  formatYM,
  labelYM,
  lastDay,
  lastTwelveMonths,
  parseYM,
} from './ym';

describe('ym', () => {
  it('parses and formats YYYY-MM', () => {
    expect(parseYM('2000-11')).toEqual({ year: 2000, month: 11 });
    expect(formatYM({ year: 2012, month: 2 })).toBe('2012-02');
  });

  it('rejects malformed text', () => {
    expect(parseYM('2025-13')).toBeNull();
    expect(parseYM('2025-00')).toBeNull();
    expect(parseYM('2025-1')).toBeNull();
    expect(parseYM('2025-01-01')).toBeNull();
    expect(parseYM(null)).toBeNull();
    expect(parseYM(undefined)).toBeNull();
  });

  it('adds months across year boundaries', () => {
    expect(addMonths({ year: 2025, month: 12 }, 1)).toEqual({ year: 2026, month: 1 });
    expect(addMonths({ year: 2025, month: 1 }, -1)).toEqual({ year: 2024, month: 12 });
    expect(addMonths({ year: 2025, month: 12 }, -11)).toEqual({ year: 2025, month: 1 });
  });

  it('compares', () => {
    expect(compareYM({ year: 2012, month: 1 }, { year: 2012, month: 2 })).toBeLessThan(0);
    expect(compareYM({ year: 2012, month: 2 }, { year: 2012, month: 2 })).toBe(0);
  });

  it('knows month lengths, leap years included', () => {
    expect(daysInMonth({ year: 2024, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2025, month: 2 })).toBe(28);
    expect(lastDay({ year: 2025, month: 12 })).toBe('2025-12-31');
  });

  it('labels a month', () => {
    expect(labelYM({ year: 2024, month: 8 })).toBe('August 2024');
  });

  it('gives the last 12 months of the series for the CSV export', () => {
    expect(lastTwelveMonths({ year: 2025, month: 12 })).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(lastTwelveMonths({ year: 2024, month: 2 })).toEqual({
      start: '2023-03-01',
      end: '2024-02-29',
    });
  });
});
