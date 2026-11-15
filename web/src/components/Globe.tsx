import "maplibre-gl/dist/maplibre-gl.css";
import "../globe.css";
import {
  type GeoJSONSource, type LayerSpecification, type LngLatBoundsLike, type MapMouseEvent, type SkySpecification, type StyleSpecification, MapLibreMap,
  Marker, NavigationControl, Popup, setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ShareButton } from "./ShareButton";
import { formatCount, monthTitle, numberLocale, t } from "../i18n";
import { formatValue } from "../scale";
import { type Bbox, type DayHotspots, type Region, type SeriesName, fetchCells } from "../api";
import { type Corner, MAX_CORNERS, areaProblem, boxCorners, cornersBounds, densifyPath, densifyRing, roundCorner } from "../area";
import { type Country, type Tap, DOUBLE_TAP_MS, countryAt, resolveTap } from "../countries";
import {
  type BurnCell, type HourCounts, type MapView, MERCATOR_LIMIT, boxRing, busiestCells, cellAreaKm2, cellSentence, cellSquares, cellStops,
  changeLabel, flatFillZoom, hourFilters, hourInstant, latLonLabel, longDate, stopLabel, timeLabel, nightPolygon, terminatorLine,
  regionsCenter, trendSentence,
} from "../globe";

type Props = {
  regions: Region[];
  date: string | null;
  /** Minutes after 00:00 UTC. */
  time: number;
  day: DayHotspots | null;
  counts: HourCounts | null;
  /** The region chosen in the filters; the globe eases to it when it changes. */
  focusRegion: string | null;
  /** Page theme; the sky around the globe follows it. */
  dark: boolean;
  /** The 3D globe, or the same map laid flat (Web Mercator). */
  view: MapView;
  onViewChange: (view: MapView) => void;
  /** The borders a double-click finds a country by; empty until they arrive. */
  countries: Country[];
  /** Lazy loader for `countries.geojson`, called on the first double-click when borders are not loaded yet. */
  onEnsureCountries: () => Promise<Country[]>;
  /** The country picked on the globe, or null. Its border is outlined, and the calendar counts inside it. */
  country: Country | null;
  /** False when no record is loaded for the picked country. */
  countryHasData: boolean;
  /** Called with the name of the country double-clicked on the globe, or with null to let it go. */
  onPickCountry: (name: string | null) => void;
  /** The corners of the area of interest drawn on the globe, or null when the area is a box. */
  area: Corner[] | null;
  /** Called with the corners of a finished drawing, or with null to remove the drawn area. */
  onDrawArea: (corners: Corner[] | null) => void;
  /** Why the calendar could not be computed for the drawn area, if it could not. */
  areaError: string | null;
  /** The period of the filters, "YYYY-MM": "Where it burns" colours the cells over it. */
  period: { start: string; end: string } | null;
  /** A cell to fly to in "Where it burns"; `n` changes with every request, so the same cell can be asked twice. */
  focus?: { lat: number; lon: number; n: number } | null;
  /** The record of the filters: the trend map on the raw record shows the change the 2012 sensor switch fakes. */
  series?: SeriesName;
  /** The method's error for a 1-degree tile and a year (a share): a smaller change reads as no change. */
  trendError?: number;
  /** The date and time panel, floated in the stage's top right corner. */
  panel: ReactNode;
};

// MapLibre finds its worker next to its own module, which the bundler moves; point it at the emitted file.
setWorkerUrl(workerUrl);

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const HOTSPOT = "#ff8a3d";
// "Where it burns": cells of the harmonized record from little to much burning a year, pale yellow to deep red, so the
// mode reads as a different thing from the day's orange hotspots (which it hides). As --cell-0 .. --cell-4 in globe.css.
const CELL_RAMP = ["#ffe08a", "#ffb347", "#ff7a2f", "#e2361f", "#9e0f16"] as const;
// "How it changed": second half of the period against the first, in doublings from -2 (a quarter) to +2 (four
// times); less burning in blue, more in red, a change within the method's error neutral. As --trend-* in globe.css.
const TREND_RAMP = ["#2166ac", "#67a9cf", "#f4f1ea", "#ef8a62", "#b2182b"] as const;
const TREND_NONE = "rgba(150, 150, 150, 0.35)";
// Where hotspots crowd, the heat layer runs from HOTSPOT to this red (as --hotspot-dense in globe.css).
const HOTSPOT_DENSE = "#e0281f";
// Below HEAT_FADE_FROM the heat layer carries the picture; by HEAT_FADE_TO single dots have taken over.
const HEAT_FADE_FROM = 5;
const HEAT_FADE_TO = 8;
// The drawn area of interest: white on a dark casing, so it reads on the imagery and on the street map.
const AREA_INK = "#ffffff";
const AREA_CASING = "rgba(3, 5, 11, 0.75)";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

const ATMOSPHERE: SkySpecification["atmosphere-blend"] = ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0];
const NIGHT_SKY: SkySpecification = {
  "sky-color": "#0b1d3a",
  "horizon-color": "#3d7bd9",
  "fog-color": "#0b1d3a",
  "sky-horizon-blend": 0.6,
  "atmosphere-blend": ATMOSPHERE,
};
const DAY_IMAGERY_LIFT = 0.07;
// A soft blue rim, not white: a white halo around the dark ocean was the harshest edge on the page.
const DAY_SKY: SkySpecification = {
  "sky-color": "#a9c4e5",
  "horizon-color": "#7fb0ea",
  "fog-color": "#a9c4e5",
  "sky-horizon-blend": 0.6,
  "atmosphere-blend": ATMOSPHERE,
};

// OpenFreeMap: OpenStreetMap vector tiles in the OpenMapTiles schema, free and without a key.
const OFM = "https://tiles.openfreemap.org";
const OSM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
/** From this zoom the satellite imagery (about 500 m a pixel) gives way to the OpenStreetMap street map. */
const STREET_ZOOM = 8;
/** Zoomed in past this, the date panel and the legend fold into small buttons to leave the map clear. */
const CARD_ZOOM = 4;
/** The globe turns on its own while it is shown whole: one turn in two minutes, west to east. */
const SPIN_DEG_PER_S = 3;
const SPIN_MAX_ZOOM = 3;
/** After the user moves the globe it holds still this long before it starts turning again. */
const SPIN_RESUME_MS = 30_000;
const LABEL_FONT = ["Noto Sans Regular"];
const NAME = ["coalesce", ["get", "name:en"], ["get", "name"]] as unknown as string;

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sky: NIGHT_SKY,
  glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
  sprite: `${OFM}/sprites/ofm_f384/ofm`,
  sources: {
    osm: { type: "vector", url: `${OFM}/planet`, attribution: OSM_ATTRIBUTION },
    imagery: {
      type: "raster",
      tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
      // GIBS tiles are 256 px. Declaring 128 makes the map fetch one zoom level deeper, so the imagery is
      // drawn at the screen's real resolution on high-density displays instead of stretched twice.
      tileSize: 128,
      maxzoom: 8,
      attribution: "Imagery: NASA GIBS (Blue Marble)",
    },
    night: { type: "geojson", data: EMPTY },
    cells: { type: "geojson", data: EMPTY },
    terminator: { type: "geojson", data: EMPTY },
    regions: { type: "geojson", data: EMPTY },
    country: { type: "geojson", data: EMPTY },
    area: { type: "geojson", data: EMPTY },
    hotspots: { type: "geojson", data: EMPTY },
  },
  layers: [
    { id: "space", type: "background", paint: { "background-color": "#03050b" } },
    { id: "imagery", type: "raster", source: "imagery" },
    { id: "night", type: "fill", source: "night", maxzoom: STREET_ZOOM, paint: { "fill-color": "#020615", "fill-opacity": 0.42, "fill-antialias": false } },
    // A wide blurred line along the terminator turns the hard day/night edge into a twilight band.
    {
      id: "twilight",
      type: "line",
      source: "terminator",
      maxzoom: STREET_ZOOM,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#020615", "line-width": 44, "line-blur": 40, "line-opacity": 0.4 },
    },
    {
      id: "country-border",
      type: "line",
      source: "osm",
      "source-layer": "boundary",
      maxzoom: STREET_ZOOM,
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      layout: { "line-join": "round" },
      paint: {
        "line-color": "rgba(255,255,255,0.75)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.6],
      },
    },
    {
      id: "state-border",
      type: "line",
      source: "osm",
      "source-layer": "boundary",
      minzoom: 4,
      maxzoom: STREET_ZOOM,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": "rgba(255,255,255,0.4)", "line-width": 0.8, "line-dasharray": [3, 2] },
    },
    {
      id: "country-label",
      type: "symbol",
      source: "osm",
      "source-layer": "place",
      minzoom: 2,
      maxzoom: 6,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": NAME,
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 15],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
        "text-max-width": 8,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 },
    },
    {
      id: "city-label",
      type: "symbol",
      source: "osm",
      "source-layer": "place",
      minzoom: 4,
      maxzoom: STREET_ZOOM,
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": NAME,
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 14],
        "text-max-width": 8,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 },
    },
    {
      // The region boxes are no longer drawn: the real country borders show where a region is. The layer
      // stays, hidden, as the anchor the street map is inserted under.
      id: "region-outline",
      type: "line",
      source: "regions",
      layout: { visibility: "none" },
      paint: { "line-color": "rgba(255,255,255,0.6)", "line-width": 1.2 },
    },
    {
      // Where it burns over the chosen period; the colour steps are set from the cells when they arrive.
      id: "cells-fill",
      type: "fill",
      source: "cells",
      layout: { visibility: "none" },
      paint: { "fill-color": CELL_RAMP[2], "fill-opacity": 0.72, "fill-antialias": false },
    },
    {
      // The border of the picked country, in the ink of a drawn area: both are the area the calendar counts.
      id: "country-casing",
      type: "line",
      source: "country",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": AREA_CASING, "line-width": 5 },
    },
    {
      id: "country-outline",
      type: "line",
      source: "country",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": AREA_INK, "line-width": 2.2 },
    },
    {
      id: "area-fill",
      type: "fill",
      source: "area",
      filter: ["==", ["get", "kind"], "area"],
      paint: { "fill-color": AREA_INK, "fill-opacity": 0.16 },
    },
    {
      id: "area-casing",
      type: "line",
      source: "area",
      filter: ["in", ["get", "kind"], ["literal", ["outline", "draft"]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": AREA_CASING, "line-width": 5 },
    },
    {
      id: "area-outline",
      type: "line",
      source: "area",
      filter: ["==", ["get", "kind"], "outline"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": AREA_INK, "line-width": 2.2 },
    },
    {
      id: "area-draft",
      type: "line",
      source: "area",
      filter: ["==", ["get", "kind"], "draft"],
      paint: { "line-color": AREA_INK, "line-width": 2.2, "line-dasharray": [2, 1.5] },
    },
    {
      // Hotspots that crowd together merge into one warm patch that turns red where they are densest, so a busy
      // day reads as where it burned most, not as a carpet of dots. Single dots take over as the map zooms in.
      id: "hotspot-heat",
      type: "heatmap",
      source: "hotspots",
      maxzoom: HEAT_FADE_TO + 1,
      paint: {
        // One hotspot alone peaks at the intensity (about 0.3, plain orange); only overlapping ones add up to red.
        "heatmap-weight": 1,
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.25, HEAT_FADE_FROM, 0.3, HEAT_FADE_TO, 0.35],
        "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 1, 4, HEAT_FADE_FROM, 9, HEAT_FADE_TO, 18],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(255, 138, 61, 0)",
          0.08, "rgba(255, 138, 61, 0.4)",
          0.28, HOTSPOT,
          0.5, "#f2552c",
          0.75, HOTSPOT_DENSE,
          1, "#b8121a",
        ],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], HEAT_FADE_FROM, 0.9, HEAT_FADE_TO, 0],
      },
    },
    {
      id: "hotspot-glow",
      type: "circle",
      source: "hotspots",
      paint: {
        "circle-color": HOTSPOT,
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 1, 4, 5, 9, 9, 22],
        "circle-blur": 1,
        // The heat layer stands in for the glow while the map is zoomed out.
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], HEAT_FADE_FROM, 0, HEAT_FADE_TO, 0.35],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "hotspot",
      type: "circle",
      source: "hotspots",
      paint: {
        "circle-color": HOTSPOT,
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 1, 1.4, 5, 3, 9, 7],
        // Faint while the heat layer carries the picture, so the red of a dense patch is not hidden under dots.
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.1, 4, 0.25, HEAT_FADE_FROM, 0.5, HEAT_FADE_TO, 0.95],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "hotspot-hour",
      type: "circle",
      source: "hotspots",
      paint: {
        "circle-color": HOTSPOT,
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 1, 1.8, 5, 3.5, 9, 8],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 6, 1.6],
        "circle-pitch-alignment": "map",
      },
    },
    {
      // Corners while drawing; the first is larger, because clicking it closes the outline.
      id: "area-corner",
      type: "circle",
      source: "area",
      filter: ["==", ["get", "kind"], "corner"],
      paint: {
        "circle-color": AREA_INK,
        "circle-radius": ["case", ["get", "first"], 7, 4.5],
        "circle-stroke-color": AREA_CASING,
        "circle-stroke-width": 2,
      },
    },
  ],
};

type AreaFeature = {
  type: "Feature";
  properties: { kind: "area" | "outline" | "draft" | "corner"; first?: boolean };
  geometry:
    | { type: "Polygon"; coordinates: Corner[][] }
    | { type: "LineString"; coordinates: Corner[] }
    | { type: "Point"; coordinates: Corner };
};

/** What the map draws of the area of interest: the finished area, or the corners placed so far and the line to the pointer. */
function areaFeatures(area: Corner[] | null, draft: Corner[] | null, cursor: Corner | null): AreaFeature[] {
  if (draft) {
    const path = cursor ? [...draft, cursor] : draft;
    const features: AreaFeature[] = draft.map((corner, index) => ({
      type: "Feature",
      properties: { kind: "corner", first: index === 0 },
      geometry: { type: "Point", coordinates: corner },
    }));
    if (path.length >= 2) {
      features.unshift({ type: "Feature", properties: { kind: "draft" }, geometry: { type: "LineString", coordinates: densifyPath(path) } });
    }
    return features;
  }
  if (!area) return [];
  const ring = densifyRing(area);
  return [
    { type: "Feature", properties: { kind: "area" }, geometry: { type: "Polygon", coordinates: [ring] } },
    { type: "Feature", properties: { kind: "outline" }, geometry: { type: "LineString", coordinates: ring } },
  ];
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The flat map ends where Web Mercator does: it cannot be panned past the edges of the world. The sides stop a hair
 * short of 180 degrees, because MapLibre 6 reads bounds from -180 to 180 as zero wide and throws.
 */
const FLAT_BOUNDS: LngLatBoundsLike = [[-179.999, -MERCATOR_LIMIT], [179.999, MERCATOR_LIMIT]];
/** How long the map takes to settle after the switch between the globe and the flat map, ms. */
const VIEW_EASE_MS = 800;

/** What a screen reader hears on the map itself; turning is a thing of the globe alone. */
function canvasLabel(view: MapView): string {
  return view === "flat"
    ? t(
      "Map of the selected day's hotspots. Drag or use the arrow keys to move it; plus and minus, or Ctrl or Command with the scroll wheel, to zoom. Double-click a country to see its burning calendar below.",
    )
    : t(
      "Globe of the selected day's hotspots. Drag or use the arrow keys to turn it; plus and minus, or Ctrl or Command with the scroll wheel, to zoom. Double-click a country to see its burning calendar below.",
    );
}

/** Zoom at which the flat world covers the whole map element. */
function fillZoom(element: HTMLElement): number {
  return flatFillZoom(element.clientWidth, element.clientHeight);
}

/** Zoom at which the globe's radius is about a third of the shorter side of the map. */
function fittingZoom(element: HTMLElement): number {
  const side = Math.min(element.clientWidth, element.clientHeight) || 600;
  return Math.max(0.5, Math.log2((0.36 * side * 2 * Math.PI) / 512));
}

function fitRegion(map: MapLibreMap, region: Region): void {
  fitBox(map, region.bbox, 6);
}

function fitBox(map: MapLibreMap, [west, south, east, north]: Bbox, maxZoom: number): void {
  const wide = window.innerWidth >= 900;
  const clampedSouth = Math.max(-MERCATOR_LIMIT, south);
  const clampedNorth = Math.min(MERCATOR_LIMIT, north);
  map.fitBounds([[west, clampedSouth], [east, clampedNorth]] as LngLatBoundsLike, {
    padding: { top: 100, bottom: 100, left: wide ? 120 : 40, right: wide ? 440 : 40 },
    duration: reducedMotion() ? 0 : 1600,
    maxZoom,
  });
}

/**
 * Zoomed in to city level the imagery is too coarse, so the OpenStreetMap street map of the OpenFreeMap
 * "Liberty" style takes over from STREET_ZOOM: land, water, roads, buildings and labels. Its layers go
 * under the region boxes and hotspots, renamed so they cannot clash with ours. A failed download only
 * means the map keeps its imagery at every zoom.
 */
async function addStreetMap(map: MapLibreMap): Promise<void> {
  try {
    const response = await fetch(`${OFM}/styles/liberty`);
    if (!response.ok) return;
    const liberty = (await response.json()) as StyleSpecification;
    for (const layer of liberty.layers) {
      if (layer.type === "raster" || layer.type === "hillshade") continue;
      const source = "source" in layer && layer.source === "openmaptiles" ? "osm" : undefined;
      if (layer.type !== "background" && !source) continue;
      map.addLayer(
        {
          ...layer,
          id: `street-${layer.id}`,
          ...(source ? { source } : {}),
          minzoom: Math.max(layer.minzoom ?? 0, STREET_ZOOM),
        } as LayerSpecification,
        "region-outline",
      );
    }
  } catch {
    // offline or blocked: the imagery stays
  }
}

function FoldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The top of the page: a satellite globe of the selected day's hotspots through the selected minute,
 * with the region boxes, the night side, a legend and a table view.
 */
const ZOOM_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "\u2318" : "Ctrl";

export function Globe({
  regions, date, time, day, counts, focusRegion, dark, view, onViewChange, countries, onEnsureCountries, country, countryHasData,
  onPickCountry, area, onDrawArea, areaError, period, focus = null, series = "harmonized", trendError = 0, panel,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [street, setStreet] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  // Crossing CARD_ZOOM folds the cards away (zooming in) or brings them back (zooming out); the buttons
  // open and close them by hand in between. Narrow screens stack the cards under the map, so they stay.
  useEffect(() => {
    const fold = zoomedIn && window.innerWidth >= 900;
    setPanelOpen(!fold);
    setLegendOpen(!fold);
  }, [zoomedIn]);
  const [showTable, setShowTable] = useState(false);
  // "Where it burns": the cells of the harmonized record over the period, instead of the day's hotspots.
  const [showCells, setShowCells] = useState(false);
  const [cells, setCells] = useState<{
    years: number; unit: string; start: string; end: string; stops: number[]; cellDeg: number;
    halves: { early: string; late: string } | null; series: SeriesName; error: number;
    /** The cells that burn most, for the table that stands in for the map. */
    busiest: BurnCell[];
  } | null>(null);
  // What the cells show (how much, or how it changed) and their size: 1-degree tiles by default, the scale the
  // method's error was measured on; 0.25-degree cells on request, finer than that.
  const [cellView, setCellView] = useState<"amount" | "change">("amount");
  // "How much" opens on the grid's own cells; "How it changed" on 1-degree tiles, the scale its error threshold was
  // measured on. Either can be switched by hand afterwards.
  const [tileDeg, setTileDeg] = useState<1 | 0.25>(0.25);
  const showCellView = (view: "amount" | "change") => {
    setCellView(view);
    setTileDeg(view === "change" ? 1 : 0.25);
  };
  const cellViewRef = useRef(cellView);
  cellViewRef.current = cellView;
  const [cellsError, setCellsError] = useState<string | null>(null);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  // The view the map was last put in; it starts as the view the map is made in.
  const shownView = useRef(view);
  const regionsRef = useRef(regions);
  // Picking a country: the map's handlers are attached once, so they read the borders and the callback through refs.
  const countriesRef = useRef(countries);
  const ensureCountriesRef = useRef(onEnsureCountries);
  const pickRef = useRef(onPickCountry);
  const countryRef = useRef(country);
  regionsRef.current = regions;
  countriesRef.current = countries;
  ensureCountriesRef.current = onEnsureCountries;
  pickRef.current = onPickCountry;
  countryRef.current = country;
  // The last click or tap, to tell when the next one makes a double: a mouse and a finger are read the same way.
  const lastTap = useRef<Tap | null>(null);
  // The country the map last flew to, so that one picked here is not flown to twice.
  const flownTo = useRef<string | null>(null);

  // Drawing an area of interest. The map's handlers are attached once, so they read the drawing through
  // a ref; the state mirrors it for what React renders.
  const draw = useRef<{ active: boolean; corners: Corner[]; cursor: Corner | null }>({ active: false, corners: [], cursor: null });
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Corner[]>([]);
  const [drawNote, setDrawNote] = useState<string | null>(null);
  const areaRef = useRef(area);
  areaRef.current = area;
  // When a click on the first corner closed the outline: the rest of a double-click there is not a pick.
  const closedAt = useRef(-Infinity);
  // The line to the pointer is redrawn once a frame, however many mouse events arrive in between.
  const paintFrame = useRef(0);

  function paintArea() {
    const source = mapRef.current?.getSource("area") as GeoJSONSource | undefined;
    const { active, corners, cursor } = draw.current;
    source?.setData({ type: "FeatureCollection", features: areaFeatures(areaRef.current, active ? corners : null, cursor) });
  }
  function setCorners(corners: Corner[]) {
    draw.current.corners = corners;
    setDraft(corners);
    paintArea();
  }
  function startDrawing() {
    draw.current = { active: true, corners: [], cursor: null };
    setDrawing(true);
    setDraft([]);
    setDrawNote(null);
    setShowTable(false);
    paintArea();
  }
  function stopDrawing() {
    draw.current = { active: false, corners: [], cursor: null };
    setDrawing(false);
    setDraft([]);
    setDrawNote(null);
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    paintArea();
  }
  function undoCorner() {
    setDrawNote(null);
    setCorners(draw.current.corners.slice(0, -1));
  }
  function finishDrawing() {
    const corners = draw.current.corners;
    const problem = areaProblem(corners);
    if (problem) {
      setDrawNote(problem);
      return;
    }
    areaRef.current = corners; // shown at once, before the page answers with the same corners
    stopDrawing();
    onDrawArea(corners);
  }
  function addCorner(event: MapMouseEvent) {
    const map = mapRef.current;
    if (!map) return;
    const corners = draw.current.corners;
    const near = (corner: Corner, pixels: number) => {
      const point = map.project(corner);
      return Math.hypot(point.x - event.point.x, point.y - event.point.y) < pixels;
    };
    if (corners.length >= 3 && near(corners[0], 12)) {
      closedAt.current = performance.now();
      return finishDrawing();
    }
    // The second click of a double-click lands on the corner the first one placed.
    if (corners.length > 0 && near(corners[corners.length - 1], 6)) return;
    if (corners.length >= MAX_CORNERS) return setDrawNote(t("An area can have at most {max} corners.", { max: MAX_CORNERS }));
    const { lng, lat } = event.lngLat.wrap();
    setDrawNote(null);
    setCorners([...corners, roundCorner([lng, lat])]);
  }
  function pickCell(corners: Corner[]) {
    areaRef.current = corners; // shown at once, before the page answers with the same corners
    paintArea();
    onDrawArea(corners);
  }
  const drawActions = useRef({ addCorner, finishDrawing, stopDrawing, undoCorner, pickCell });
  drawActions.current = { addCorner, finishDrawing, stopDrawing, undoCorner, pickCell };

  // While drawing: Enter finishes, Backspace takes the last corner back, Escape gives up.
  useEffect(() => {
    if (!drawing) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") return drawActions.current.stopDrawing();
      if ((event.target as HTMLElement | null)?.closest?.("input, select, textarea, button, a")) return;
      if (event.key === "Enter") drawActions.current.finishDrawing();
      if (event.key === "Backspace") drawActions.current.undoCorner();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const center = regionsCenter(regionsRef.current);
    const flat = shownView.current === "flat";
    const map = new MapLibreMap({
      container: element,
      style: flat ? { ...STYLE, projection: { type: "mercator" } } : STYLE,
      center: [center.lon, center.lat],
      zoom: flat ? fillZoom(element) : fittingZoom(element),
      maxZoom: 17,
      renderWorldCopies: false,
      // The credits live in the legend, once; MapLibre's own attribution line would repeat them.
      attributionControl: false,
      // The wheel scrolls the page; Cmd (Mac) or Ctrl + wheel zooms the map. On touch screens one finger
      // scrolls the page and two fingers move the map. The desktop overlay that MapLibre shows on a plain
      // wheel is hidden in globe.css: the shortcut is written in the legend instead.
      cooperativeGestures: true,
      locale: {
        "CooperativeGesturesHandler.WindowsHelpText": t("Scroll to move down the page. {key} + scroll zooms the map.", { key: "Ctrl" }),
        "CooperativeGesturesHandler.MacHelpText": t("Scroll to move down the page. {key} + scroll zooms the map.", { key: "\u2318" }),
        "CooperativeGesturesHandler.MobileHelpText": t("Use two fingers to move the map."),
      },
    });
    // A double-click or a double tap picks a country, so it must not zoom as well: the buttons and the wheel do.
    map.doubleClickZoom.disable();
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-left");
    map.getCanvas().setAttribute("aria-label", canvasLabel(shownView.current));
    // Development only: lets a headless browser drive the map (see "Look at the globe" in CLAUDE.md).
    if (import.meta.env.DEV) (window as unknown as { __hhMap?: MapLibreMap }).__hhMap = map;
    // The glass cards are see-through: over the light street map they need a solid face to stay readable.
    map.on("zoom", () => {
      setStreet(map.getZoom() >= STREET_ZOOM);
      setZoomedIn(map.getZoom() >= CARD_ZOOM);
    });
    map.on("load", () => {
      setReady(true);
      addStreetMap(map);
    });
    const justClosed = () => performance.now() - closedAt.current < DOUBLE_TAP_MS;
    map.on("dblclick", (event) => {
      if (!draw.current.active && !justClosed()) return;
      event.preventDefault(); // no zoom: a double-click closes the outline
      if (draw.current.active) drawActions.current.finishDrawing();
    });
    map.on("click", async (event) => {
      if (draw.current.active) return drawActions.current.addCorner(event);
      if (justClosed()) return;
      const info = cellsRef.current;
      const cellFeature = info ? map.queryRenderedFeatures(event.point, { layers: ["cells-fill"] })[0] : undefined;
      const decision = resolveTap(lastTap.current, {
        time: performance.now(),
        x: event.point.x,
        y: event.point.y,
        hasCell: Boolean(info && cellFeature),
        hasArea: Boolean(areaRef.current),
      });
      lastTap.current = decision.nextTap;
      // In "Where it burns" a single click on a cell makes it the area; a double tap takes priority and picks the country.
      if (decision.kind === "pick-cell" && info && cellFeature) {
        // The square from the cell's own centre: tile geometry is quantized, the centre is exact.
        const { lat, lon } = cellFeature.properties as BurnCell;
        const half = info.cellDeg / 2;
        return drawActions.current.pickCell(boxCorners([lon - half, lat - half, lon + half, lat + half]));
      }
      if (decision.kind !== "pick-country") return;
      const { lng, lat } = event.lngLat.wrap();
      const areaBefore = areaRef.current;
      const list = countriesRef.current.length > 0 ? countriesRef.current : await ensureCountriesRef.current();
      if (!mapRef.current || draw.current.active || areaRef.current !== areaBefore) return;
      const found = countryAt(list, lng, lat);
      if (!found) return;
      areaRef.current = null;
      paintArea();
      flownTo.current = found.name;
      pickRef.current(found.name);
      fitBox(map, found.view, 6);
    });
    map.on("mousemove", (event) => {
      if (draw.current.active) {
        const { lng, lat } = event.lngLat.wrap();
        draw.current.cursor = [lng, lat];
        map.getCanvas().style.cursor = "crosshair";
        paintFrame.current ||= requestAnimationFrame(() => {
          paintFrame.current = 0;
          paintArea();
        });
        return;
      }
      map.getCanvas().style.cursor = "";
    });
    // A cell under the pointer says how often, how much and when it burns.
    const popup = new Popup({ closeButton: false, closeOnClick: false, className: "cell-popup", maxWidth: "260px" });
    map.on("mousemove", "cells-fill", (event) => {
      const info = cellsRef.current;
      const feature = event.features?.[0];
      if (!info || !feature || draw.current.active) return;
      const cell = feature.properties as BurnCell;
      const text =
        cellViewRef.current === "change" && info.halves
          ? trendSentence(cell, info.halves, info.error)
          : cellSentence(cell, info.years, info.unit, info.cellDeg);
      popup.setLngLat(event.lngLat).setText(`${text} ${t("Click to make it your area.")}`).addTo(map);
    });
    map.on("mouseleave", "cells-fill", () => popup.remove());
    mapRef.current = map;
    return () => {
      cancelAnimationFrame(paintFrame.current);
      paintFrame.current = 0;
      mapRef.current = null;
      setReady(false);
      map.remove();
    };
  }, []);

  // The globe turns slowly on its own. It holds still while the user drags, zooms or types on it (and for
  // SPIN_RESUME_MS after), while a flight to a region runs, while an outline is being drawn, when zoomed in,
  // when the tab is hidden, on the flat map, and always for users who ask for reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || reducedMotion()) return;
    const element = map.getContainer();
    let touchedAt = -Infinity;
    const touch = () => {
      touchedAt = performance.now();
    };
    const events = ["pointerdown", "wheel", "keydown", "touchstart"] as const;
    events.forEach((name) => element.addEventListener(name, touch, { passive: true }));
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000; // no leap after a pause or a slow frame
      last = now;
      const still =
        document.hidden ||
        shownView.current === "flat" ||
        map.isMoving() ||
        draw.current.active ||
        map.getZoom() > SPIN_MAX_ZOOM ||
        now - touchedAt < SPIN_RESUME_MS;
      if (!still) {
        const center = map.getCenter();
        map.jumpTo({ center: [center.lng - SPIN_DEG_PER_S * dt, center.lat] });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((name) => element.removeEventListener(name, touch));
    };
  }, [ready]);

  // The map is made before the regions arrive; centre it on them once they do.
  const centred = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || centred.current || regions.length === 0) return;
    centred.current = true;
    const center = regionsCenter(regions);
    map.jumpTo({ center: [center.lon, center.lat] });
  }, [regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("regions") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: regions.map((region) => ({
        type: "Feature",
        properties: { name: region.name },
        geometry: { type: "LineString", coordinates: boxRing(region.bbox) },
      })),
    });
    const markers = regions.map((region) => {
      const label = document.createElement("div");
      label.className = "globe-region-label";
      label.textContent = t(region.name);
      return new Marker({ element: label, anchor: "bottom-left", opacityWhenCovered: "0" })
        .setLngLat([region.bbox[0], region.bbox[3]])
        .addTo(map);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [ready, regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("hotspots") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (day?.hotspots ?? []).map(([lon, lat, minute]) => ({
        type: "Feature",
        properties: { minute },
        geometry: { type: "Point", coordinates: [lon, lat] },
      })),
    });
  }, [ready, day]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const { through, inHour } = hourFilters(time);
    map.setFilter("hotspot-heat", through);
    map.setFilter("hotspot-glow", through);
    map.setFilter("hotspot", through);
    map.setFilter("hotspot-hour", inHour);
    (map.getSource("night") as GeoJSONSource).setData(
      date ? { type: "Feature", properties: {}, geometry: nightPolygon(hourInstant(date, time)) } : EMPTY,
    );
    (map.getSource("terminator") as GeoJSONSource).setData(
      date ? { type: "Feature", properties: {}, geometry: terminatorLine(hourInstant(date, time)) } : EMPTY,
    );
  }, [ready, date, time]);

  // Where it burns: fetch the cells of the period, colour them, and hide the day's hotspots while they show.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const hotspotLayers = ["hotspot-heat", "hotspot-glow", "hotspot", "hotspot-hour"];
    for (const id of hotspotLayers) map.setLayoutProperty(id, "visibility", showCells ? "none" : "visible");
    map.setLayoutProperty("cells-fill", "visibility", showCells ? "visible" : "none");
    if (!showCells || !period) return;
    const controller = new AbortController();
    setCellsError(null);
    // The raw record has no method error to fall inside: any change counts there.
    const error = series === "harmonized" ? trendError : 0;
    fetchCells(period.start, period.end, controller.signal, { deg: tileDeg, series })
      .then((answer) => {
        const squares = cellSquares(answer.cells, answer.cell_deg, error);
        const stops = cellStops(squares.features.map((f) => f.properties.density));
        (map.getSource("cells") as GeoJSONSource).setData(squares);
        map.setPaintProperty(
          "cells-fill",
          "fill-color",
          cellView === "change"
            ? [
                "case", ["==", ["get", "change"], null], TREND_NONE,
                ["interpolate", ["linear"], ["get", "change"],
                  -2, TREND_RAMP[0], -1, TREND_RAMP[1], 0, TREND_RAMP[2], 1, TREND_RAMP[3], 2, TREND_RAMP[4]],
              ]
            : // Coloured per 100 km2: a cell shrinks with the cosine of the latitude.
              [
                "interpolate", ["linear"], ["get", "density"],
                0, CELL_RAMP[0], stops[0], CELL_RAMP[1], stops[1], CELL_RAMP[2], stops[2], CELL_RAMP[3], stops[3], CELL_RAMP[4],
              ],
        );
        setCells({
          years: answer.years, unit: answer.unit, start: answer.start, end: answer.end, stops, cellDeg: answer.cell_deg,
          halves: answer.halves, series: answer.series, error, busiest: busiestCells(answer.cells),
        });
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setCellsError(reason.message);
      });
    return () => controller.abort();
  }, [ready, showCells, period?.start, period?.end, tileDeg, cellView, series, trendError]);

  /** Leave the table for the globe and fly to a cell, its neighbours around it. */
  function flyToCell(cell: { lat: number; lon: number }) {
    setShowTable(false);
    mapRef.current?.flyTo({ center: [cell.lon, cell.lat], zoom: 7, duration: reducedMotion() ? 0 : 1600 });
  }

  /** The table stands in for the map: what is drawn over the globe goes, and a drawing in progress is given up. */
  function toggleTable() {
    if (!showTable && drawing) stopDrawing();
    setShowTable(!showTable);
  }

  // "Show on the map" from the list of busiest cells: switch to where it burns and fly there.
  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !ready || !map) return;
    setShowTable(false);
    setShowCells(true);
    // Zoom 7: the cell and its neighbours, so it reads against the cells around it.
    map.flyTo({ center: [focus.lon, focus.lat], zoom: 7, duration: reducedMotion() ? 0 : 1600 });
  }, [focus?.n, ready]);

  useEffect(() => {
    if (ready) paintArea();
  }, [ready, area]);

  // The border of the picked country.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("country") as GeoJSONSource).setData(
      country ? { type: "Feature", properties: {}, geometry: country.geometry } : EMPTY,
    );
    // A country that arrives with the page (from a link) is flown to; one picked here is already on its way.
    if (country && flownTo.current !== country.name) fitBox(map, country.view, 6);
    flownTo.current = country?.name ?? null;
  }, [ready, country]);

  // An area that arrives with the page (from a link) is flown to once; one drawn here is already in view.
  const areaSeen = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || areaSeen.current || regions.length === 0) return;
    areaSeen.current = true;
    if (area) fitBox(map, cornersBounds(area), 8);
  }, [ready, area, regions]);

  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const previous = lastFocus.current;
    lastFocus.current = focusRegion;
    // A drawn area keeps the view on itself, even when it moves the region filter to another country; so does a
    // picked country, which is flown to by its own border.
    if (areaRef.current || countryRef.current) return;
    if (!map || !focusRegion || previous === null || previous === focusRegion) return;
    const region = regions.find((r) => r.name === focusRegion);
    if (region) fitRegion(map, region);
  }, [focusRegion, regions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setSky(dark ? NIGHT_SKY : DAY_SKY);
    // On the light page the near-black ocean is lifted a little, so the disc is not a hole in the sky.
    map.setPaintProperty("imagery", "raster-brightness-min", dark ? 0 : DAY_IMAGERY_LIFT);
  }, [ready, dark]);

  // The globe or the flat map: one map, whose projection is switched. The flat map is north up, never smaller than
  // the stage and never panned past the edges of the world, so the sky behind it does not show.
  useEffect(() => {
    const map = mapRef.current;
    const element = container.current;
    if (!ready || !map || !element) return;
    const previous = shownView.current;
    shownView.current = view;
    const duration = reducedMotion() ? 0 : VIEW_EASE_MS;
    map.getCanvas().setAttribute("aria-label", canvasLabel(view));
    if (view === "flat") {
      map.setProjection({ type: "mercator" });
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
      map.keyboard.disableRotation();
      map.easeTo({ bearing: 0, pitch: 0, duration });
      // The stage changes size with the window, and so does the zoom at which the world fills it.
      const fill = () => map.setMinZoom(fillZoom(element));
      fill();
      map.setMaxBounds(FLAT_BOUNDS);
      map.on("resize", fill);
      // MapLibre keeps the tiles the globe needed until the map next moves, which leaves the far edges of the flat
      // world without imagery; a resize makes it ask for the tiles of the new projection.
      const settle = window.setTimeout(() => map.resize(), 50);
      return () => {
        window.clearTimeout(settle);
        map.off("resize", fill);
      };
    }
    if (previous === "globe") return; // the map was made as a globe: nothing to undo
    // Back from the whole flat world: the whole globe, not a globe larger than the stage.
    const wholeWorld = map.getZoom() <= fillZoom(element) + 0.01;
    map.setMaxBounds(null);
    map.setMinZoom(null);
    map.setProjection({ type: "globe" });
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.touchPitch.enable();
    map.keyboard.enableRotation();
    if (wholeWorld) map.easeTo({ zoom: fittingZoom(element), duration });
  }, [ready, view]);

  useEffect(() => {
    if (!showTable) mapRef.current?.resize();
  }, [showTable]);

  const unit = t(day?.unit ?? "");
  // The caption names the unit only when it is not simply hotspots, which the caption already says.
  const dayCaption = day
    ? day.unit === "hotspots"
      ? t("Hotspots on {date}", { date: longDate(day.date) })
      : t("Hotspots on {date}, in {unit}", { date: longDate(day.date), unit })
    : "";
  const record = cells?.series === "raw" ? t("raw record") : t("harmonized record");
  return (
    <section
      className={["stage", street && "is-street", showTable && "is-table", showTable && !panelOpen && "is-table-wide"].filter(Boolean).join(" ")}
      aria-label={view === "flat" ? t("Map of hotspots") : t("Globe of hotspots")}
    >
      <div className="stage-head">
        <h1>Hotspot Harmony</h1>
        <p>{t("Satellite fire hotspots, day by day")}</p>
        <div className="stage-actions">
          <a className="stage-next" href="#calendar">
            {t("Burning activity calendar, 2000 to 2025")} <span aria-hidden="true">↓</span>
          </a>
          <div className="stage-view" role="group" aria-label={t("Map view")}>
            <button type="button" aria-pressed={view === "globe"} onClick={() => onViewChange("globe")}>
              {t("Globe")}
            </button>
            <button type="button" aria-pressed={view === "flat"} onClick={() => onViewChange("flat")}>
              {t("Flat map")}
            </button>
          </div>
          <button type="button" className="stage-toggle" aria-pressed={showCells} onClick={() => setShowCells(!showCells)}>
            {showCells ? t("Back to the day") : t("Where it burns")}
          </button>
          <button type="button" className="stage-toggle" aria-pressed={drawing} onClick={drawing ? stopDrawing : startDrawing}>
            {area && !drawing ? t("Redraw the area") : t("Draw an area")}
          </button>
          <button type="button" className="stage-toggle" aria-pressed={showTable} onClick={toggleTable}>
            {showTable ? (view === "flat" ? t("Show map") : t("Show globe")) : t("Show table")}
          </button>
          <ShareButton className="stage-toggle stage-share" />
        </div>
      </div>

      {panelOpen ? (
        <>
          {panel}
          <button type="button" className="stage-fold stage-fold-panel" aria-label={t("Hide the date panel")} title={t("Hide")} onClick={() => setPanelOpen(false)}>
            <FoldIcon />
          </button>
        </>
      ) : (
        <button type="button" className="stage-pill stage-pill-panel" aria-label={t("Show the date panel")} onClick={() => setPanelOpen(true)}>
          <CalendarIcon />
          {date ? `${longDate(date)}, ${timeLabel(time)} UTC` : t("Date and time")}
          {counts && <strong>{formatCount(counts.throughHour)}</strong>}
        </button>
      )}

      <div className="stage-map">
        <div ref={container} className={showTable ? "stage-canvas is-hidden" : "stage-canvas"} />
        {showTable && showCells && (
          <div className="stage-table">
            {cells ? (
              <table>
                <caption>
                  {t("Where it burns most, {start} to {end}, {record}: {unit} a year, {deg}° cells", {
                    start: cells.start, end: cells.end, record, unit: t(cells.unit), deg: cells.cellDeg.toLocaleString(numberLocale()),
                  })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Cell centre")}</th>
                    <th scope="col">{t("A year")}</th>
                    <th scope="col">{t("Per 100 km²")}</th>
                    <th scope="col">{t("Years burning")}</th>
                    <th scope="col">{t("Most in")}</th>
                    {cells.halves && (
                      <th scope="col">
                        {t("{late} against {early}", {
                          late: cells.halves.late.replace("-", "–"), early: cells.halves.early.replace("-", "–"),
                        })}
                      </th>
                    )}
                    <th scope="col">
                      <span className="dt-hidden">{t("Map")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cells.busiest.map((cell) => (
                    <tr key={`${cell.lat},${cell.lon}`}>
                      <th scope="row">{latLonLabel(cell.lat, cell.lon)}</th>
                      <td>{formatValue(cell.per_year)}</td>
                      <td>{stopLabel((cell.per_year / cellAreaKm2(cell.lat, cells.cellDeg)) * 100)}</td>
                      <td>{t("{n} of {years}", { n: cell.years_burning, years: cells.years })}</td>
                      <td>{monthTitle(cell.peak_month)}</td>
                      {cells.halves && <td>{changeLabel(cell.trend, cells.error)}</td>}
                      <td>
                        <button type="button" className="stage-toggle stage-table-action" onClick={() => flyToCell(cell)}>
                          {t("Show on the map")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>{cellsError ? t("Cannot load the cells: {error}", { error: cellsError }) : t("Loading where it burns...")}</p>
            )}
          </div>
        )}
        {showTable && !showCells && (
          <div className="stage-table">
            {day && counts ? (
              <table>
                <caption>{dayCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("Region")}</th>
                    <th scope="col">{t("00:00 through {time}", { time: timeLabel(time) })}</th>
                    <th scope="col">{t("{from} to {to}", { from: timeLabel(Math.max(0, time - 59)), to: timeLabel(time) })}</th>
                    <th scope="col">{t("Whole day")}</th>
                  </tr>
                </thead>
                <tbody>
                  {day.regions.map((name, index) => (
                    <tr key={name}>
                      <th scope="row">{t(name)}</th>
                      <td>{formatCount(counts.regions[index]?.throughHour ?? 0)}</td>
                      <td>{formatCount(counts.regions[index]?.inHour ?? 0)}</td>
                      <td>{formatCount(counts.regions[index]?.day ?? 0)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">{t("All")}</th>
                    <td>{formatCount(counts.throughHour)}</td>
                    <td>{formatCount(counts.inHour)}</td>
                    <td>{formatCount(counts.day)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p>{t("No hotspots loaded for this day.")}</p>
            )}
          </div>
        )}
      </div>

      {showCells && !drawing && !showTable && (
        <div className={area || country ? "stage-draw stage-cells is-raised" : "stage-draw stage-cells"} role="group" aria-label={t("What the cells show")}>
          <div className="segmented">
            <button type="button" aria-pressed={cellView === "amount"} onClick={() => showCellView("amount")}>
              {t("How much")}
            </button>
            <button type="button" aria-pressed={cellView === "change"} onClick={() => showCellView("change")}>
              {t("How it changed")}
            </button>
          </div>
          <div className="segmented">
            <button type="button" aria-pressed={tileDeg === 1} onClick={() => setTileDeg(1)}>
              {t("1° tiles")}
            </button>
            <button type="button" aria-pressed={tileDeg === 0.25} onClick={() => setTileDeg(0.25)}>
              {t("0.25° cells")}
            </button>
          </div>
        </div>
      )}
      {drawing && (
        <div className="stage-draw">
          <p role="status">
            {drawNote
              ?? (draft.length === 0
                ? t("Click the map to place the corners of your area of interest.")
                : draft.length < 3
                  ? t("{n} of at least 3 corners placed.", { n: draft.length })
                  : t("{n} corners. Click the first corner, double-click or press Enter to finish.", { n: draft.length }))}
          </p>
          <div className="stage-draw-actions">
            <button type="button" className="stage-toggle" disabled={draft.length === 0} onClick={undoCorner}>
              {t("Undo corner")}
            </button>
            <button type="button" className="stage-toggle is-strong" disabled={draft.length < 3} onClick={finishDrawing}>
              {t("Finish")}
            </button>
            <button type="button" className="stage-toggle" onClick={stopDrawing}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {!drawing && !showTable && area && (
        <div className="stage-draw">
          <p role="status">
            {areaError
              ? t("Your area, {n} corners: {error}", { n: area.length, error: areaError })
              : t("Your area, {n} corners. The calendar below now counts the burning inside it.", { n: area.length })}
          </p>
          <div className="stage-draw-actions">
            {!areaError && (
              <a className="stage-toggle is-strong" href="#calendar">
                {t("See its calendar")} <span aria-hidden="true">↓</span>
              </a>
            )}
            <button type="button" className="stage-toggle" onClick={() => onDrawArea(null)}>
              {t("Remove the area")}
            </button>
          </div>
        </div>
      )}

      {!drawing && !showTable && !area && country && (
        <div className="stage-draw">
          <p role="status">
            {!countryHasData
              ? t("{country}: no record is loaded for this country yet.", { country: t(country.name) })
              : areaError
                ? `${t(country.name)}: ${areaError}`
                : t("{country}. The calendar below now counts the burning inside its border.", { country: t(country.name) })}
          </p>
          <div className="stage-draw-actions">
            {!areaError && (
              <a className="stage-toggle is-strong" href="#calendar">
                {countryHasData ? t("See its calendar") : t("See what is missing")} <span aria-hidden="true">↓</span>
              </a>
            )}
            <button type="button" className="stage-toggle" onClick={() => onPickCountry(null)}>
              {t("Let the country go")}
            </button>
          </div>
        </div>
      )}

      {showTable ? null : legendOpen ? (
        <div className="stage-legend">
          <button type="button" className="stage-fold stage-fold-legend" aria-label={t("Hide the legend")} title={t("Hide")} onClick={() => setLegendOpen(false)}>
            <FoldIcon />
          </button>
        {showCells ? (
          <div className="legend-cells">
            <p className="legend-title">
              {!cells
                ? cellsError
                  ? t("Cannot load the cells: {error}", { error: cellsError })
                  : t("Loading where it burns...")
                : cellView === "change"
                  ? cells.halves
                    ? t("How burning changed, {late} against {early}, {record}", {
                        late: cells.halves.late.replace("-", "–"), early: cells.halves.early.replace("-", "–"), record,
                      })
                    : t("The period has fewer than two full years: choose a longer one to see a change")
                  : t("Where it burns, {start} to {end}: {unit} a year per 100 km², {record}", {
                      start: cells.start, end: cells.end, unit: t(cells.unit), record,
                    })}
            </p>
            {cells && cellView === "amount" && (
              <>
                <i className="legend-ramp" aria-hidden="true" />
                <div className="legend-ramp-ticks" aria-hidden="true">
                  <span>0</span>
                  <span>{stopLabel(cells.stops[0])}</span>
                  <span>{stopLabel(cells.stops[2])}</span>
                  <span>{`${stopLabel(cells.stops[3])}+`}</span>
                </div>
              </>
            )}
            {cells && cellView === "change" && cells.halves && (
              <>
                <i className="legend-ramp is-trend" aria-hidden="true" />
                <div className="legend-ramp-ticks" aria-hidden="true">
                  <span>¼×</span>
                  <span>½×</span>
                  <span>{cells.error ? `±${Math.round(cells.error * 100)}%` : "1×"}</span>
                  <span>2×</span>
                  <span>4×</span>
                </div>
                <p className="legend-hint">
                  {cells.series === "raw"
                    ? t("The raw record switches from MODIS to VIIRS in 2012, so much of this rise is the sensor, not the fire: switch the record to harmonized to see the change that is real.")
                    : [
                        t("A change within the method's error for a 1-degree tile and a year (±{error}%) is shown as none.", {
                          error: Math.round(cells.error * 100),
                        }),
                        cells.cellDeg < 1
                          ? t("That error was measured on 1-degree tiles; on 0.25-degree cells it is larger, so a small change here can still be noise.")
                          : "",
                        t("Grey: no burning in the first half. From 2022 the record also holds the fires of the war in the east and south."),
                      ].filter(Boolean).join(" ")}
                </p>
              </>
            )}
            {cells && (
              <p className="legend-hint">
                {cells.cellDeg >= 1
                  ? t("Point at a tile for its figures; click it to make it your area. 1-degree tiles are the scale the method's error was measured on.")
                  : t("Point at a cell for its figures; click it to make it your area. 0.25-degree cells are finer than the 1-degree tiles the method's error was measured on.")}
              </p>
            )}
          </div>
        ) : (
          <ul>
            <li>
              <i className="legend-dot" aria-hidden="true" />
              {t("Hotspots through the selected time")}
            </li>
            <li>
              <i className="legend-dot is-ringed" aria-hidden="true" />
              {t("Detected in the hour up to it")}
            </li>
            <li>
              <i className="legend-heat" aria-hidden="true" />
              {t("Where hotspots crowd, orange turns red")}
            </li>
          </ul>
        )}
        <p className="legend-hint">{t("Double-click a country to see its burning calendar below.")}</p>
        <p className="legend-hint">{t("{key} + scroll zooms the map; scroll alone moves down the page.", { key: ZOOM_KEY })}</p>
        <p>
          {t("Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Imagery: NASA GIBS (Blue Marble). Map:")}{" "}
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{" "}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>, {t("data")}{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t("© OpenStreetMap contributors")}</a>.{" "}
          {t("Borders a country is picked by:")}{" "}
          <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>.
        </p>
        </div>
      ) : (
        <button type="button" className="stage-pill stage-pill-legend" aria-label={t("Show the legend and data credits")} onClick={() => setLegendOpen(true)}>
          <i className="legend-dot" aria-hidden="true" />
          {t("Legend and credits")}
        </button>
      )}
    </section>
  );
}
