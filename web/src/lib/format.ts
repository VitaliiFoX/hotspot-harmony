/** Number formatting. Deterministic (no locale lookups) so tests and exports are stable. */

const DASH = '–';

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function groupThousands(integerText: string): string {
  return integerText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a count of fire cell-days. Harmonized values are fractional, so small
 * values keep one decimal; from 100 up they are shown as whole numbers.
 */
export function formatCount(value: number | null | undefined): string {
  if (!isNum(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100 || Number.isInteger(value)) {
    return sign + groupThousands(String(Math.round(abs)));
  }
  const fixed = abs.toFixed(1);
  return sign + (fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed);
}

/** Compact form for chart axes: 950, 1.2k, 34k, 2.1M. */
export function formatCompact(value: number | null | undefined): string {
  if (!isNum(value)) return DASH;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const trim = (n: number): string => {
    const text = n >= 10 ? n.toFixed(0) : n.toFixed(1);
    return text.endsWith('.0') ? text.slice(0, -2) : text;
  };
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  return sign + formatCount(abs);
}

/** Ratio to the usual level: "2.3x", "12x", "0.05x". */
export function formatRatio(ratio: number | null | undefined): string {
  if (!isNum(ratio)) return DASH;
  if (ratio === 0) return '0x';
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  if (ratio > 0 && ratio < 0.1) return `${ratio.toFixed(2)}x`;
  return `${ratio.toFixed(1)}x`;
}

/** Ratio without the trailing "x", for ranges such as "2.1-2.6x". */
export function formatRatioBare(ratio: number | null | undefined): string {
  const text = formatRatio(ratio);
  return text.endsWith('x') ? text.slice(0, -1) : text;
}

/** Fraction to percent: 0.0429 -> "4.3%". With `signed`, positive values get a plus. */
export function formatPercent(
  fraction: number | null | undefined,
  options: { digits?: number; signed?: boolean } = {},
): string {
  if (!isNum(fraction)) return DASH;
  const { digits = 1, signed = false } = options;
  const pct = fraction * 100;
  const rounded = Number(pct.toFixed(digits));
  const text = Math.abs(rounded) >= 100 ? rounded.toFixed(0) : rounded.toFixed(digits);
  const plus = signed && rounded > 0 ? '+' : '';
  return `${plus}${text}%`;
}

/** "1,650-2,010" with an en dash. */
export function formatRange(lo: number | null | undefined, hi: number | null | undefined): string {
  if (!isNum(lo) || !isNum(hi)) return DASH;
  return `${formatCount(lo)}${DASH}${formatCount(hi)}`;
}

/** Escape text coming from the API before it goes into an HTML tooltip. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
