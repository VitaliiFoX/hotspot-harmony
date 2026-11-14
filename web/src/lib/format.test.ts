import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatCompact,
  formatCount,
  formatPercent,
  formatRange,
  formatRatio,
  formatRatioBare,
} from './format';

describe('formatCount', () => {
  it('groups thousands and rounds large values', () => {
    expect(formatCount(1830.4)).toBe('1,830');
    expect(formatCount(4210)).toBe('4,210');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('keeps one decimal for small fractional values', () => {
    expect(formatCount(71.8)).toBe('71.8');
    expect(formatCount(0.34)).toBe('0.3');
    expect(formatCount(3.04)).toBe('3');
    expect(formatCount(0)).toBe('0');
  });

  it('shows a dash for missing values', () => {
    expect(formatCount(null)).toBe('–');
    expect(formatCount(undefined)).toBe('–');
    expect(formatCount(Number.NaN)).toBe('–');
  });
});

describe('formatCompact', () => {
  it('shortens axis values', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1200)).toBe('1.2k');
    expect(formatCompact(34000)).toBe('34k');
    expect(formatCompact(2100000)).toBe('2.1M');
  });
});

describe('formatRatio', () => {
  it('formats ratios to the usual level', () => {
    expect(formatRatio(2.31)).toBe('2.3x');
    expect(formatRatio(21.38)).toBe('21x');
    expect(formatRatio(0.42)).toBe('0.4x');
    expect(formatRatio(0.05)).toBe('0.05x');
    expect(formatRatio(0)).toBe('0x');
    expect(formatRatioBare(0)).toBe('0');
    expect(formatRatio(null)).toBe('–');
    expect(formatRatioBare(2.07)).toBe('2.1');
  });
});

describe('formatPercent', () => {
  it('turns fractions into percentages', () => {
    expect(formatPercent(0.0429)).toBe('4.3%');
    expect(formatPercent(1.2229)).toBe('122%');
    expect(formatPercent(-0.0013, { signed: true })).toBe('-0.1%');
    expect(formatPercent(0.0219, { signed: true })).toBe('+2.2%');
    expect(formatPercent(0, { signed: true })).toBe('0.0%');
    expect(formatPercent(null)).toBe('–');
  });
});

describe('formatRange', () => {
  it('joins two counts with an en dash', () => {
    expect(formatRange(1650, 2010)).toBe('1,650–2,010');
    expect(formatRange(null, 3)).toBe('–');
  });
});

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml('<b>"MODIS" & \'VIIRS\'</b>')).toBe(
      '&lt;b&gt;&quot;MODIS&quot; &amp; &#39;VIIRS&#39;&lt;/b&gt;',
    );
  });
});
