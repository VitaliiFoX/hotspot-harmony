import "maplibre-gl/dist/maplibre-gl.css";
import "../globe.css";
import {
  type GeoJSONSource, type LngLatBoundsLike, type SkySpecification, type StyleSpecification, MapLibreMap, Marker, NavigationControl, setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DayHotspots, Region } from "../api";
import {
  type HourCounts, MERCATOR_LIMIT, boxRing, hourFilters, hourInstant, hourLabel, longDate, nightPolygon, regionAt,
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

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sky: NIGHT_SKY,
  sources: {
    imagery: {
      type: "raster",
      tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
      tileSize: 256,
      maxzoom: 8,
      attribution: "Imagery: NASA GIBS (Blue Marble)",
    },
    night: { type: "geojson", data: EMPTY },
    regions: { type: "geojson", data: EMPTY },
    hotspots: { type: "geojson", data: EMPTY },
  },
  layers: [
    { id: "space", type: "background", paint: { "background-color": "#03050b" } },
    { id: "imagery", type: "raster", source: "imagery" },
    { id: "night", type: "fill", source: "night", paint: { "fill-color": "#020615", "fill-opacity": 0.45, "fill-antialias": false } },
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
 * The top of the page: a satellite globe of the selected day's hotspots through the selected hour,
 * with the region boxes, the night side, a legend and a table view.
 */
export function Globe({ regions, date, hour, day, counts, focusRegion, dark, onPickRegion, panel }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
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
      maxZoom: 9,
      renderWorldCopies: false,
      attributionControl: { compact: false },
      // The globe fills the first screen; without this the wheel zooms it and the page never scrolls.
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
    map.on("load", () => setReady(true));
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
    <section className="stage" aria-label="Globe of hotspots">
      <div className="stage-head">
        <h1>Hotspot Harmony</h1>
        <p>Satellite fire hotspots, day by day</p>
        <button type="button" className="stage-toggle" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
          {showTable ? "Show globe" : "Show table"}
        </button>
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
        <p>Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Imagery: NASA GIBS (Blue Marble).</p>
      </div>
    </section>
  );
}
