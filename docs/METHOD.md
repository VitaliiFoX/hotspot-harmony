# Method

How MODIS and VIIRS hotspots become one record. The numbers that back this up are generated, not
typed: see [VALIDATION.md](VALIDATION.md) and `data/agg/harmonization_report.json`.

## The problem in one picture

MODIS (1 km pixels, since 2000) and VIIRS (375 m pixels, since 2012) look at the same fires and
report different amounts of them. VIIRS sees small fires that MODIS misses, and puts several
detections on a fire that MODIS reports once. Splice the two archives and every area shows a jump
in 2012 that never happened on the ground.

![Yearly totals, raw record vs harmonized record](sensor_jump_before_after.png)

## Unit

**MODIS-equivalent fire cell-days.** One fire cell-day is one ~1 km cell with at least one
detection on one local solar day. The record answers "what would Terra + Aqua MODIS have reported",
because that is the direction that needs no invention: a finer sensor can be made to imitate a
coarser one, but a coarse sensor cannot recover fires it never saw.

## Steps

1. **Keep vegetation fires.** FIRMS `type = 0`; low-confidence detections dropped. Static sources
   (industry, flares), volcanoes and offshore detections stay in the point store but out of the record.
2. **Local solar day.** Overpass time is shifted by longitude, so a night overpass just before
   00 UTC lands on the same day as the afternoon overpass of the same fire.
3. **Fire cell-days on a ~1 km equal-area grid.** Counting burning cells instead of detections
   removes the pixel-size effect: VIIRS averages about 1.6 detections per cell-day, MODIS about 1.1.
4. **A weight for every VIIRS cell-day.** What is left after gridding is sensitivity: MODIS misses
   weak fires. So each VIIRS cell-day gets

       weight = k x p(fire power, day or night) x r(calendar month)

   - `p` is measured, not assumed: among VIIRS cell-days of that fire power, the share where MODIS
     also reported fire within one cell the same day. It rises steadily with fire power
     (table in VALIDATION.md).
   - `k` is one scale that makes totals match. MODIS also sees fires at hours when VIIRS is not
     overhead (Terra passes in the morning), which no VIIRS detection can stand in for.
   - `r` is the seasonal difference that remains.

   All three are fitted on 2012-02 .. 2021-12, when both sensors flew and MODIS orbits were stable.
5. **NOAA-20 continues the record.** Suomi NPP stopped delivering data on 2 November 2026. NOAA-20
   carries the same instrument in the same orbit and is tied to S-NPP with one factor. Months where
   the two disagree by more than 20% are treated as sensor gaps, left out of that factor and
   reported (the pipeline finds S-NPP's July-August 2022 gap this way).
6. **Terra-only start.** Before Aqua (until July 2002) Terra alone is scaled to Terra + Aqua by
   calendar month, fitted on 2003-2011.

Which sensor speaks for which period:

| Period | Source | Weight |
|---|---|---|
| 2000-11 .. 2002-06 | MODIS Terra | Terra-to-MODIS factor by month |
| 2002-07 .. 2021-12 | MODIS Terra + Aqua | 1 (the reference) |
| 2022-01 .. | VIIRS NOAA-20 | weight above x NOAA-20-to-S-NPP factor |

Because the correction lives on each cell-day, the harmonized value of any polygon and any period
is a plain sum. Fields with small agricultural burns and forests with large fires get different
corrections automatically, which a single ratio per country cannot do.

## How we know it works

- **Leave-one-year-out.** Each overlap year is predicted from VIIRS by weights fitted on the other
  years and compared with what MODIS actually reported, at four scales: country and 1-degree tile,
  year and month.
- **An independent sensor.** NOAA-20 never took part in fitting `p`, `k`, `r`; it is still checked
  against MODIS.
- **Sensor jump check.** Mean yearly total of 2012-2016 over 2007-2011, raw record against
  harmonized record.
- **Two baselines** in the same table: VIIRS as delivered, and one scaling factor per country.
- **Uncertainty in the app.** The 90% range shown next to a harmonized month comes from the same
  held-out predictions, by size of the value: small areas are noisier and get wider ranges. Months
  measured by the reference sensor carry no harmonization error.

## Tried and rejected

Run once on Ukraine on 2026-11-14, scripts in `research/experiments/`. Same leave-one-year-out
check as above; figures are country x month error.

| Idea | Result | Why not |
|---|---|---|
| Gradient-boosted model for the weight (pixel size, detection count, confidence) | 7.7% against 8.0% | no real gain, harder to explain |
| The same plus neighbouring cells and the days before and after | 8.7% | worse: clusters get over-counted |
| Count-preserving target with neighbours | 7.5% | best found, half a point, not worth a black box |
| Model that corrects area totals instead of points | 9.0% | worse |
| Correction by 1-degree tile on top of the weights | no change | regional bias is already small |
| Dropping the calendar-month factor | 10.5% | seasonality matters |

Two identical VIIRS instruments 50 minutes apart (S-NPP and NOAA-20) disagree by 4.6% per month
after the same weighting. That is the noise of observation itself, so the remaining room for any
method is a few percentage points.

## Limits

- Hotspots are thermal anomalies at overpass time: not confirmed fires and not burned area. Cloud,
  smoke and canopy hide fires from both sensors.
- Fires that MODIS saw in the morning and VIIRS never saw are restored only on average (through
  `k` and `r`), not day by day.
- Terra and Aqua orbits drift after 2021. Terra alone reports clearly less by 2025; Terra + Aqua
  together still agree with VIIRS within the usual scatter (table in VALIDATION.md). The record
  switches to VIIRS in 2022 as a precaution.
- The method is validated where the full archive was processed. A country with too little overlap
  borrows the pooled calibration and is marked as such in the app.
- Near-real-time data carry no `type` field; current-year ingest is not built yet.

Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), <https://firms.modaps.eosdis.nasa.gov/>.
