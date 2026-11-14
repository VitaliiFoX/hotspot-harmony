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

**Harmonized record**:
The single series from 2000 to today in which a value means the same amount of burning whichever sensor observed it.
_Avoid_: merged data, combined series, unified dataset

### Product

**Burning activity calendar**:
A grid of years by months showing how much burning the harmonized record holds for an area of interest.
_Avoid_: heatmap (that is only its drawing), fire calendar
