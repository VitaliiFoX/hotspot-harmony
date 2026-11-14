import "maplibre-gl/dist/maplibre-gl.css";
import "../globe.css";
import {
  type GeoJSONSource, type LayerSpecification, type LngLatBoundsLike, type SkySpecification, type StyleSpecification, MapLibreMap, Marker, NavigationControl, setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DayHotspots, Region } from "../api";
import {
  type HourCounts, MERCATOR_LIMIT, boxRing, hourFilters, hourInstant, hourLabel, longDate, nightPolygon, regionAt, terminatorLine,
  regionsCenter,
} from "../globe";

type Props = {
  regions: Region[];
  date: string | null;
  hour: number;
  day: DayHotspots | null;
  counts: HourCounts | null;
  /** The region chosen in the filters; the globe eases to it when it changes. */
  focusRegion: string | null;
  /** Page theme; the sky around the globe follows it. */
  dark: boolean;
  onPickRegion: (name: string) => void;
  /** The date and time panel, floated in the stage's top right corner. */
  panel: ReactNode;
};

// MapLibre finds its worker next to its own module, which the bundler moves; point it at the emitted file.
setWorkerUrl(workerUrl);

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const HOTSPOT = "#ff8a3d";
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
      id: "region-outline",
      type: "line",
      source: "regions",
      paint: { "line-color": "rgba(255,255,255,0.6)", "line-width": 1.2 },
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
  ],
};

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Zoom at which the globe's radius is about a third of the shorter side of the map. */
function fittingZoom(element: HTMLElement): number {
  const side = Math.min(element.clientWidth, element.clientHeight) || 600;
  return Math.max(0.5, Math.log2((0.36 * side * 2 * Math.PI) / 512));
}

function fitRegion(map: MapLibreMap, region: Region): void {
  const wide = window.innerWidth >= 900;
  const [west, south, east, north] = region.bbox;
  const clampedSouth = Math.max(-MERCATOR_LIMIT, south);
  const clampedNorth = Math.min(MERCATOR_LIMIT, north);
  map.fitBounds([[west, clampedSouth], [east, clampedNorth]] as LngLatBoundsLike, {
    padding: { top: 100, bottom: 100, left: wide ? 120 : 40, right: wide ? 440 : 40 },
    duration: reducedMotion() ? 0 : 1600,
    maxZoom: 6,
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

/**
 * The top of the page: a satellite globe of the selected day's hotspots through the selected hour,
 * with the region boxes, the night side, a legend and a table view.
 */
const ZOOM_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "\u2318" : "Ctrl";

export function Globe({ regions, date, hour, day, counts, focusRegion, dark, onPickRegion, panel }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [street, setStreet] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const regionsRef = useRef(regions);
  const pickRef = useRef(onPickRegion);
  regionsRef.current = regions;
  pickRef.current = onPickRegion;

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
      attributionControl: { compact: false },
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
    map.on("zoom", () => setStreet(map.getZoom() >= STREET_ZOOM));
    map.on("load", () => {
      setReady(true);
      addStreetMap(map);
    });
    map.on("click", (event) => {
      const region = regionAt(regionsRef.current, event.lngLat.lng, event.lngLat.lat);
      if (region) {
        pickRef.current(region.name);
        fitRegion(map, region);
      }
    });
    map.on("mousemove", (event) => {
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
    const { through, inHour } = hourFilters(hour);
    map.setFilter("hotspot-glow", through);
    map.setFilter("hotspot", through);
    map.setFilter("hotspot-hour", inHour);
    (map.getSource("night") as GeoJSONSource).setData(
      date ? { type: "Feature", properties: {}, geometry: nightPolygon(hourInstant(date, hour)) } : EMPTY,
    );
    (map.getSource("terminator") as GeoJSONSource).setData(
      date ? { type: "Feature", properties: {}, geometry: terminatorLine(hourInstant(date, hour)) } : EMPTY,
    );
  }, [ready, date, hour]);

  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const previous = lastFocus.current;
    lastFocus.current = focusRegion;
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
          <button type="button" className="stage-toggle" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
            {showTable ? "Show globe" : "Show table"}
          </button>
        </div>
      </div>

      {panel}

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
                    <th scope="col">{`00:00 through ${hourLabel(hour, 59)}`}</th>
                    <th scope="col">{`${hourLabel(hour)} to ${hourLabel(hour, 59)}`}</th>
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

      <div className="stage-legend">
        <ul>
          <li>
            <i className="legend-dot" aria-hidden="true" />
            Hotspots through the selected hour
          </li>
          <li>
            <i className="legend-dot is-ringed" aria-hidden="true" />
            Detected in the selected hour
          </li>
        </ul>
        <p className="legend-hint">{`${ZOOM_KEY} + scroll zooms the globe; scroll alone moves down the page.`}</p>
        <p>Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Imagery: NASA GIBS (Blue Marble). Borders, places and streets: © OpenStreetMap contributors, via OpenFreeMap.</p>
      </div>
    </section>
  );
}
