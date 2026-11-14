import "maplibre-gl/dist/maplibre-gl.css";
import "../globe.css";
import {
  type GeoJSONSource, type LayerSpecification, type LngLatBoundsLike, type MapMouseEvent, type SkySpecification, type StyleSpecification, MapLibreMap,
  Marker, NavigationControl, setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Bbox, DayHotspots, Region } from "../api";
import { type Corner, MAX_CORNERS, areaProblem, cornersBounds, densifyPath, densifyRing, roundCorner } from "../area";
import {
  type HourCounts, MERCATOR_LIMIT, boxRing, hourFilters, hourInstant, longDate, timeLabel, nightPolygon, regionAt, terminatorLine,
  regionsCenter,
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
  onPickRegion: (name: string) => void;
  /** The corners of the area of interest drawn on the globe, or null when the area is a box. */
  area: Corner[] | null;
  /** Called with the corners of a finished drawing, or with null to remove the drawn area. */
  onDrawArea: (corners: Corner[] | null) => void;
  /** Why the calendar could not be computed for the drawn area, if it could not. */
  areaError: string | null;
  /** The date and time panel, floated in the stage's top right corner. */
  panel: ReactNode;
};

// MapLibre finds its worker next to its own module, which the bundler moves; point it at the emitted file.
setWorkerUrl(workerUrl);

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const HOTSPOT = "#ff8a3d";
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
const DAY_SKY: SkySpecification = {
  "sky-color": "#cfe0f3",
  "horizon-color": "#ffffff",
  "fog-color": "#cfe0f3",
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
    terminator: { type: "geojson", data: EMPTY },
    regions: { type: "geojson", data: EMPTY },
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
      // stays, hidden, as the anchor the street map is inserted under; clicks still find a region by its box.
      id: "region-outline",
      type: "line",
      source: "regions",
      layout: { visibility: "none" },
      paint: { "line-color": "rgba(255,255,255,0.6)", "line-width": 1.2 },
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
      id: "hotspot-glow",
      type: "circle",
      source: "hotspots",
      paint: {
        "circle-color": HOTSPOT,
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 1, 4, 5, 9, 9, 22],
        "circle-blur": 1,
        "circle-opacity": 0.35,
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
        "circle-opacity": 0.95,
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
 * means the globe keeps its imagery at every zoom.
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

export function Globe({ regions, date, time, day, counts, focusRegion, dark, onPickRegion, area, onDrawArea, areaError, panel }: Props) {
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
  const regionsRef = useRef(regions);
  const pickRef = useRef(onPickRegion);
  regionsRef.current = regions;
  pickRef.current = onPickRegion;

  // Drawing an area of interest. The map's handlers are attached once, so they read the drawing through
  // a ref; the state mirrors it for what React renders.
  const draw = useRef<{ active: boolean; corners: Corner[]; cursor: Corner | null }>({ active: false, corners: [], cursor: null });
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Corner[]>([]);
  const [drawNote, setDrawNote] = useState<string | null>(null);
  const areaRef = useRef(area);
  areaRef.current = area;

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
    if (corners.length >= 3 && near(corners[0], 12)) return finishDrawing();
    // The second click of a double-click lands on the corner the first one placed.
    if (corners.length > 0 && near(corners[corners.length - 1], 6)) return;
    if (corners.length >= MAX_CORNERS) return setDrawNote(`An area can have at most ${MAX_CORNERS} corners.`);
    const { lng, lat } = event.lngLat.wrap();
    setDrawNote(null);
    setCorners([...corners, roundCorner([lng, lat])]);
  }
  const drawActions = useRef({ addCorner, finishDrawing, stopDrawing, undoCorner });
  drawActions.current = { addCorner, finishDrawing, stopDrawing, undoCorner };

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
    const map = new MapLibreMap({
      container: element,
      style: STYLE,
      center: [center.lon, center.lat],
      zoom: fittingZoom(element),
      maxZoom: 17,
      renderWorldCopies: false,
      // The credits live in the legend, once; MapLibre's own attribution line would repeat them.
      attributionControl: false,
      // The wheel scrolls the page; Cmd (Mac) or Ctrl + wheel zooms the globe. On touch screens one finger
      // scrolls the page and two fingers move the globe. The desktop overlay that MapLibre shows on a plain
      // wheel is hidden in globe.css: the shortcut is written in the legend instead.
      cooperativeGestures: true,
      locale: {
        "CooperativeGesturesHandler.WindowsHelpText": "Scroll to move down the page. Ctrl + scroll zooms the globe.",
        "CooperativeGesturesHandler.MacHelpText": "Scroll to move down the page. \u2318 + scroll zooms the globe.",
        "CooperativeGesturesHandler.MobileHelpText": "Use two fingers to move the globe.",
      },
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-left");
    map.getCanvas().setAttribute(
      "aria-label",
      "Globe of the selected day's hotspots. Drag or use the arrow keys to turn it; "
        + "plus and minus, or Ctrl or Command with the scroll wheel, to zoom.",
    );
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
    map.on("dblclick", (event) => {
      if (!draw.current.active) return;
      event.preventDefault(); // no zoom: a double-click closes the outline
      drawActions.current.finishDrawing();
    });
    map.on("click", (event) => {
      if (draw.current.active) return drawActions.current.addCorner(event);
      const region = regionAt(regionsRef.current, event.lngLat.lng, event.lngLat.lat);
      if (region) {
        pickRef.current(region.name);
        fitRegion(map, region);
      }
    });
    map.on("mousemove", (event) => {
      if (draw.current.active) {
        const { lng, lat } = event.lngLat.wrap();
        draw.current.cursor = [lng, lat];
        map.getCanvas().style.cursor = "crosshair";
        paintArea();
        return;
      }
      const inside = regionAt(regionsRef.current, event.lngLat.lng, event.lngLat.lat) !== null;
      map.getCanvas().style.cursor = inside ? "pointer" : "";
    });
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      setReady(false);
      map.remove();
    };
  }, []);

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
      label.textContent = region.name;
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

  useEffect(() => {
    if (ready) paintArea();
  }, [ready, area]);

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
    // A drawn area keeps the view on itself, even when it moves the region filter to another country.
    if (areaRef.current) return;
    if (!map || !focusRegion || previous === null || previous === focusRegion) return;
    const region = regions.find((r) => r.name === focusRegion);
    if (region) fitRegion(map, region);
  }, [focusRegion, regions]);

  useEffect(() => {
    if (ready) mapRef.current?.setSky(dark ? NIGHT_SKY : DAY_SKY);
  }, [ready, dark]);

  useEffect(() => {
    if (!showTable) mapRef.current?.resize();
  }, [showTable]);

  const unit = day?.unit ?? "";
  return (
    <section className={street ? "stage is-street" : "stage"} aria-label="Globe of hotspots">
      <div className="stage-head">
        <h1>Hotspot Harmony</h1>
        <p>Satellite fire hotspots, day by day</p>
        <div className="stage-actions">
          <a className="stage-next" href="#calendar">
            Burning activity calendar, 2000 to 2025 <span aria-hidden="true">↓</span>
          </a>
          <button type="button" className="stage-toggle" aria-pressed={drawing} onClick={drawing ? stopDrawing : startDrawing}>
            {area && !drawing ? "Redraw the area" : "Draw an area"}
          </button>
          <button type="button" className="stage-toggle" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
            {showTable ? "Show globe" : "Show table"}
          </button>
        </div>
      </div>

      {panelOpen ? (
        <>
          {panel}
          <button type="button" className="stage-fold stage-fold-panel" aria-label="Hide the date panel" title="Hide" onClick={() => setPanelOpen(false)}>
            <FoldIcon />
          </button>
        </>
      ) : (
        <button type="button" className="stage-pill stage-pill-panel" aria-label="Show the date panel" onClick={() => setPanelOpen(true)}>
          <CalendarIcon />
          {date ? `${longDate(date)}, ${timeLabel(time)} UTC` : "Date and time"}
          {counts && <strong>{counts.throughHour.toLocaleString("en-US")}</strong>}
        </button>
      )}

      <div className="stage-map">
        <div ref={container} className={showTable ? "stage-canvas is-hidden" : "stage-canvas"} />
        {showTable && (
          <div className="stage-table">
            {day && counts ? (
              <table>
                <caption>
                  {`Hotspots on ${longDate(day.date)}, in ${unit}`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Region</th>
                    <th scope="col">{`00:00 through ${timeLabel(time)}`}</th>
                    <th scope="col">{`${timeLabel(Math.max(0, time - 59))} to ${timeLabel(time)}`}</th>
                    <th scope="col">Whole day</th>
                  </tr>
                </thead>
                <tbody>
                  {day.regions.map((name, index) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{(counts.regions[index]?.throughHour ?? 0).toLocaleString("en-US")}</td>
                      <td>{(counts.regions[index]?.inHour ?? 0).toLocaleString("en-US")}</td>
                      <td>{(counts.regions[index]?.day ?? 0).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">All</th>
                    <td>{counts.throughHour.toLocaleString("en-US")}</td>
                    <td>{counts.inHour.toLocaleString("en-US")}</td>
                    <td>{counts.day.toLocaleString("en-US")}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p>No hotspots loaded for this day.</p>
            )}
          </div>
        )}
      </div>

      {drawing && (
        <div className="stage-draw">
          <p role="status">
            {drawNote
              ?? (draft.length === 0
                ? "Click the globe to place the corners of your area of interest."
                : draft.length < 3
                  ? `${draft.length} of at least 3 corners placed.`
                  : `${draft.length} corners. Click the first corner, double-click or press Enter to finish.`)}
          </p>
          <div className="stage-draw-actions">
            <button type="button" className="stage-toggle" disabled={draft.length === 0} onClick={undoCorner}>
              Undo corner
            </button>
            <button type="button" className="stage-toggle is-strong" disabled={draft.length < 3} onClick={finishDrawing}>
              Finish
            </button>
            <button type="button" className="stage-toggle" onClick={stopDrawing}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!drawing && area && (
        <div className="stage-draw">
          <p role="status">
            {areaError
              ? `Your area, ${area.length} corners: ${areaError}`
              : `Your area, ${area.length} corners. The calendar below now counts the burning inside it.`}
          </p>
          <div className="stage-draw-actions">
            {!areaError && (
              <a className="stage-toggle is-strong" href="#calendar">
                See its calendar <span aria-hidden="true">↓</span>
              </a>
            )}
            <button type="button" className="stage-toggle" onClick={() => onDrawArea(null)}>
              Remove the area
            </button>
          </div>
        </div>
      )}

      {legendOpen ? (
        <div className="stage-legend">
          <button type="button" className="stage-fold stage-fold-legend" aria-label="Hide the legend" title="Hide" onClick={() => setLegendOpen(false)}>
            <FoldIcon />
          </button>
        <ul>
          <li>
            <i className="legend-dot" aria-hidden="true" />
            Hotspots through the selected time
          </li>
          <li>
            <i className="legend-dot is-ringed" aria-hidden="true" />
            Detected in the hour up to it
          </li>
        </ul>
        <p className="legend-hint">{`${ZOOM_KEY} + scroll zooms the globe; scroll alone moves down the page.`}</p>
        <p>
          Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Imagery: NASA GIBS (Blue Marble). Map:{" "}
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{" "}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>, data{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>.
        </p>
        </div>
      ) : (
        <button type="button" className="stage-pill stage-pill-legend" aria-label="Show the legend and data credits" onClick={() => setLegendOpen(true)}>
          <i className="legend-dot" aria-hidden="true" />
          Legend and credits
        </button>
      )}
    </section>
  );
}
