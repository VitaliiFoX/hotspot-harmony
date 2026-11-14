import { describe, expect, it } from 'vitest';
import meta from '../fixtures/meta.json';
import { frpBinLabel, parseCountryReport } from './report';

describe('parseCountryReport', () => {
  it('never throws on missing or malformed reports', () => {
    for (const bad of [undefined, null, 'text', 42, [], {}, { countries: null }]) {
      const r = parseCountryReport(bad, 'Ukraine');
      expect(r.found).toBe(false);
      expect(r.validation).toEqual([]);
      expect(r.seam).toBeNull();
      expect(r.detectionCurve).toEqual([]);
    }
    expect(parseCountryReport({ countries: { Ukraine: {} } }, null).found).toBe(false);
  });

  it('tolerates partial entries', () => {
    const r = parseCountryReport(
      {
        countries: {
          X: {
            validation: {
              viirs_to_modis_leave_one_year_out: { bias: 'n/a', wape_country_year: 0.05 },
              baseline_raw_viirs: 'broken',
            },
            seam: { raw: { jump_ratio: 2 } },
            detection_curve: [{ has_day: 1, frp_from_mw: 0, p: 0.1 }, { p: 0.5 }, null],
          },
        },
      },
      'X',
    );
    expect(r.found).toBe(true);
    expect(r.validation).toHaveLength(1);
    expect(r.validation[0]?.metrics.bias).toBeNull();
    expect(r.validation[0]?.metrics.wapeCountryYear).toBe(0.05);
    expect(r.seam).toEqual({ raw: { before: null, after: null, jumpRatio: 2 }, harmonized: null });
    expect(r.detectionCurve).toEqual([{ day: true, frpFrom: 0, frpTo: null, p: 0.1 }]);
  });

  it('reads the saved real report for Ukraine', () => {
    const r = parseCountryReport(meta.report, 'Ukraine');
    expect(r.found).toBe(true);
    expect(r.calibration).toBe('own');
    expect(r.validation.map((v) => v.key)).toEqual([
      'viirs_to_modis_leave_one_year_out',
      'baseline_raw_viirs',
      'baseline_single_factor',
      'noaa20_independent',
      'terra_only_leave_one_year_out',
    ]);
    expect(r.validation[0]?.metrics.wapeCountryYear).toBeCloseTo(0.0429);
    expect(r.seam?.raw?.jumpRatio).toBeCloseTo(1.998);
    expect(r.seam?.harmonized?.jumpRatio).toBeCloseTo(0.902);
    expect(r.detectionCurve).toHaveLength(16);
    expect(r.metric).toContain('WAPE');
  });

  it('reads a country that has a note and no validation', () => {
    const r = parseCountryReport(meta.report, 'Argentina');
    expect(r.found).toBe(true);
    expect(r.calibration).toBe('pooled');
    expect(r.note).toContain('calibration borrowed');
    expect(r.validation).toEqual([]);
    expect(r.seam).toBeNull();
  });

  it('labels FRP bins', () => {
    expect(frpBinLabel({ day: true, frpFrom: 8, frpTo: 16, p: 0.4 })).toBe('8–16');
    expect(frpBinLabel({ day: false, frpFrom: 64, frpTo: null, p: 0.6 })).toBe('64+');
  });
});
