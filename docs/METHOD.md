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

       weight = k x p(fire power, day or night) x r(day of year)

   - `p` is measured, not assumed: among VIIRS cell-days of that fire power, the share where MODIS
     also reported fire within one cell the same day. It rises steadily with fire power
     (table in VALIDATION.md).
   - `k` is one scale that makes totals match. MODIS also sees fires at hours when VIIRS is not
     overhead (Terra passes in the morning), which no VIIRS detection can stand in for.
   - `r` is the seasonal difference that remains. It follows the day of the year smoothly (each day
     pools the 15 days before and after it), because the ratio drifts inside a month: in Ukraine it
     falls steadily from early to late March, and a factor that jumps at month ends misses that.

   All three are fitted on 2012-02 .. 2021-12, when both sensors flew and MODIS orbits were stable.
5. **Sensor gap days.** A day when a VIIRS sensor reports under 0.6 fire cell-days per MODIS one,
   while MODIS has at least 100, is a day the sensor was not really observing (it normally reports
   about two). So is a day when it reports under a tenth of what the other VIIRS sensor does, while
   that one has at least 50: the two carry the same instrument 50 minutes apart, and this second
   sign catches outages on days with too little fire for the first. Such days are left out of the
   fit, and in the record that day is taken from MODIS instead of being read as a quiet day. Most
   outages show up independently in both countries: S-NPP in late July to early August 2022 and in
   July 2024, NOAA-20 on 19-22 July and 30 September 2023. S-NPP's gap of 24-26 March 2012 is
   flagged in Ukraine only: Argentina had too little fire on those days to tell. The full lists are
   in [VALIDATION.md](VALIDATION.md).
6. **NOAA-20 continues the record.** Suomi NPP stopped delivering data on 2 November 2026. NOAA-20
   carries the same instrument in the same orbit and is tied to S-NPP with one factor. Months where
   the two disagree by more than 20% are treated as sensor gaps, left out of that factor and
   reported (the pipeline finds S-NPP's July-August 2022 gap this way).
7. **Terra-only start.** Before Aqua (until July 2002) Terra alone is scaled to Terra + Aqua by
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
  year and month. Sensor gap days are left out of the comparison, since a day the sensor did not
  observe says nothing about the method; the same check with those days counted is reported next
  to it.
- **An independent sensor.** NOAA-20 never took part in fitting `p`, `k`, `r`; it is still checked
  against MODIS.
- **Sensor jump check.** Mean yearly total of 2012-2016 over 2007-2011, raw record against
  harmonized record.
- **Two baselines** in the same table: VIIRS as delivered, and one scaling factor per country.
- **Uncertainty in the app.** The 90% range shown next to a harmonized month comes from the same
  held-out predictions, by size of the value: small areas are noisier and get wider ranges. Months
  measured by the reference sensor carry no harmonization error.

## What was tried

All figures are country x month error on Ukraine from leave-one-year-out, measured on 2026-11-14.

**Adopted** (`research/harmonize_ml/improve.py`, now in the pipeline):

| Step | Error |
|---|---|
| FRP bins x calendar-month factor (the first version) | 8.0% |
| + sensor gap days left out | 7.0% |
| + season factor by day of year, +-15 days | 6.5% |

**Measured, not adopted** (`research/harmonize_ml/`, run with `research/harmonize_ml/run.sh`; same
data with gap days left out, so compare with 6.5%):

| Idea | Error | Note |
|---|---|---|
| Boosted model for the weight: LightGBM, XGBoost or CatBoost | 6.1% | the three libraries agree to 0.02 points |
| Boosted Poisson model on 0.25 degree cell x day, seeing the days and cells around | 6.1-6.2% | best on small areas: 18.8% against 19.6% per 1-degree tile and month |
| Mean of the weight models and the cell-day models | 5.9% | best found |
| Cell-day model with each cell's own history as a feature | worse | 4% low on unseen years: it memorises where the training years burned |
| Averaging S-NPP and NOAA-20 instead of using one (2018-04 to 2021-12, first version of the weights) | 6.2% against 6.7% | 20.3% against 21.6% per tile and month |

The boosted models buy about half a point per month for three more libraries and a trained model
that cannot be explained in one chart, so they stay in `research/` for now. Averaging the two VIIRS
sensors is the next candidate for the pipeline.

**Rejected earlier** (`research/experiments/`, measured against the 8.0% version): neighbouring cells
as features for the weight (8.7%, clusters get over-counted), a model on area totals (9.0%), a
correction by 1-degree tile (no change), no seasonal factor at all (10.5%).

Two identical VIIRS instruments 50 minutes apart (S-NPP and NOAA-20) disagree by 4.6% per month
after the same weighting. That is the noise of observation itself, so the room left for any method
is small.

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
