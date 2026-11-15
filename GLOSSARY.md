# Hotspot Harmony

One comparable record of satellite active-fire detections across two sensor generations, and a
calendar of burning activity built on that record.

## Language

### Detections

**Hotspot**:
One active-fire detection: a single sensor pixel flagged as burning at one overpass. A large fire produces many hotspots.
_Avoid_: fire, fire point, alert

**Sensor**:
One instrument series treated as a single stream of hotspots: `modis` (Terra and Aqua together), `viirs_snpp`, `viirs_noaa20`.
_Avoid_: satellite (one sensor can fly on several), source

**Confidence class**:
The common three-step scale (low, nominal, high) that both sensors' own confidence values map onto.
_Avoid_: confidence level, quality

**Hotspot type**:
FIRMS's own guess at what a hotspot is: a vegetation fire, a volcano, another static heat source, or an offshore source.
_Avoid_: category, class

**Standard processing (SP)**:
The science-quality version of a hotspot, published months after the overpass.
_Avoid_: archive data, final data

**Near real-time (NRT)**:
The fast version of a hotspot, published within hours and later replaced by standard processing.
_Avoid_: live data, recent data

**Country archive**:
The yearly per-country CSV files of standard-processing hotspots that FIRMS publishes without a key.
_Avoid_: country API, yearly summary

### Places

**Region**:
A country the pipeline has data for, as listed in `config/regions.yaml`.
_Avoid_: pilot, territory

**Area of interest**:
The polygon a user draws to ask about burning activity. It can be any shape inside a region.
_Avoid_: zone, selection, AOI

**Cell**:
One square of the regular latitude-longitude grid that hotspots are counted in.
_Avoid_: pixel (that is the sensor's footprint), tile, bin

**Cell-month**:
The hotspots of one sensor in one cell during one UTC calendar month. A missing cell-month means zero.
_Avoid_: bucket, grid month

### Harmonization

**Overlap period**:
The span of time during which two sensors both observed, used to learn how their hotspots relate.
_Avoid_: calibration window, common years

**Sensor jump**:
The artificial step in a hotspot series at the date its source switches from one sensor to another.
_Avoid_: seam (in this repo a seam is a place where tests attach), break, discontinuity

**Raw record**:
The record stitched from MODIS before February 2012 and VIIRS S-NPP from then on, with no correction. It contains the sensor jump.
_Avoid_: naive series, uncorrected data

**Harmonized record**:
The single series from 2000 to today in which a value means the same amount of burning whichever sensor observed it.
_Avoid_: merged data, combined series, unified dataset

**Fire cell-day**:
One 1 km cell with at least one hotspot of one sensor on one local solar day. The harmonized record counts these, in the amount MODIS Terra + Aqua would have reported.
_Avoid_: active cell, footprint, fire-day

**Sensor gap day**:
A day when a VIIRS sensor was not really observing: it reports almost nothing while MODIS, or the other VIIRS sensor, reports plenty. It is not a quiet day and is never counted as one.
_Avoid_: outage day, missing day, zero day

**Detection weight**:
The share of a MODIS fire cell-day that one VIIRS fire cell-day stands for, set by its fire power, day or night, and time of year; where the boosted model is used, also by the number and confidence of its detections and the pixel size.
_Avoid_: calibration factor, k (that is only one part of it)

**Context model**:
The estimate of the MODIS fire cell-days of one cell on one day from the VIIRS activity in that cell, in the cells around it and on the days before and after. It can account for fires VIIRS did not see at its own overpass.
_Avoid_: grid model, neighbourhood model, ML model (the boosted weight is one too)

**Method**:
How the VIIRS era of the harmonized record is computed in one country: detection weights, the context model, or the mean of the two. Chosen per country on held-out years.
_Avoid_: algorithm, mode, strategy

**Held-out error**:
How far the harmonized VIIRS of one overlap year misses what MODIS reported, when that year was left out of fitting the method: the sum of the misses over the sum of what MODIS reported (WAPE), per country or 1-degree tile, per year or month. The web app calls it "error on years the method did not see".
_Avoid_: accuracy, validation score, R²

**Baseline**:
A simpler correction the method has to beat on the same check: one scaling factor for the whole country (fitted on all years, the scored one included) or VIIRS as delivered.
_Avoid_: benchmark, naive model

### Product

**Burning activity calendar**:
A grid of years by months showing how much burning the harmonized record holds for an area of interest.
_Avoid_: heatmap (that is only its drawing), fire calendar
