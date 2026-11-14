---
status: accepted
---

# Harmonize to MODIS-equivalent fire cell-days, with a weight per VIIRS cell-day

The harmonized record counts fire cell-days (a 1 km cell with a hotspot on one local solar day) in
the amount MODIS Terra + Aqua would have reported. Each VIIRS fire cell-day gets a weight from its
fire power, day or night, and time of year, fitted on the overlap period 2012-02 to 2021-12. We
chose this over one factor per cell because the VIIRS-to-MODIS ratio depends on how strong the
fires are and on the season: on Ukraine, on years the model did not see, it misses by about half
as much per month as a single factor does (`docs/VALIDATION.md`, written by `make validate`).
Decided by the team on 2026-11-14.

## Considered options

- **VIIRS-equivalent hotspot counts, one factor per 0.25 degree cell** (the original plan). Simpler,
  and the record would continue in VIIRS units with no conversion. Rejected: scaling MODIS up
  invents small fires it never saw, and one factor per cell cannot follow the seasonal change of
  the ratio.
- **A gradient-boosted model for the weight, and a model on area totals.** Tried on Ukraine
  (`research/experiments/`): at best half a percentage point better, at worst a point worse, and
  not explainable in one chart.

## Consequences

- The weight comes from a table by fire power or from a boosted regression model, whichever predicts
  held-out years better in that country. So two countries can use different rules, and
  `docs/VALIDATION.md` says which. This keeps the model from being used where it hurts (Argentina).

- The raw record served by the API is counted in fire cell-days too (`n_raw`), so the two series differ only in the correction, not in unit. Settled on 2026-11-14 after this ADR was written.
- The month of a harmonized value is the month of the local solar day, not the UTC month.
- MODIS is the reference until 2021-12 and VIIRS NOAA-20 carries the record from 2022-01, because
  S-NPP ended on 2026-11-02 and has gaps (July-August 2022, July 2024).
- A region with too little overlap borrows the pooled calibration and is not validated.
