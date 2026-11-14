import type { Feature, FeatureCollection, Polygon } from 'geojson';
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { CountryMeta } from '../api/types';
import { encodeGeometry } from '../lib/urlState';
import {
  COORD_DECIMALS,
  bboxToPolygon,
  geometryBBox,
  isSimplePolygon,
  normalizeGeometry,
  type AreaGeometry,
} from '../lib/geometry';

// MapLibre 6 ships its worker as a separate module; tell it where the bundler put the file.
setWorkerUrl(workerUrl);

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_TIMEOUT_MS = 7000;

/** Key-less fallback basemap: OpenStreetMap raster tiles. */
const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const AREA_COLOR = '#0b5563';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

type Tool = 'pan' | 'draw' | 'edit';

/** Load the vector style; fall back to raster tiles when it cannot be fetched. */
async function resolveStyle(
  signal: AbortSignal,
): Promise<{ style: StyleSpecification; raster: boolean }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  const timer = setTimeout(abort, STYLE_TIMEOUT_MS);
  try {
    const response = await fetch(OPENFREEMAP_STYLE, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const style = (await response.json()) as StyleSpecification;
    if (!style || style.version !== 8 || !Array.isArray(style.layers)) {
      throw new Error('not a style');
    }
    return { style, raster: false };
  } catch {
    return { style: OSM_RASTER_STYLE, raster: true };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function drawnPolygons(draw: TerraDraw) {
  return draw
    .getSnapshot()
    .filter((f) => f.geometry.type === 'Polygon' && f.properties.mode === 'polygon');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface MapPanelProps {
  countries: readonly CountryMeta[];
  geometry: AreaGeometry | null;
  onGeometryChange: (geometry: AreaGeometry | null) => void;
}

/** Map with the data outline and a draw / edit / reset toolbar for the area of interest. */
export function MapPanel({ countries, geometry, onGeometryChange }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  /**
   * Encoded form of the geometry last sent to or received from the parent
   * ('' for "no area"); `undefined` before the first sync.
   */
  const syncedRef = useRef<string | undefined>(undefined);
  /** True while this component changes the draw store itself. */
  const suppressRef = useRef(false);
  /** True when the current area lives in the editor (not in the read-only layer). */
  const editableRef = useRef(false);
  const onChangeRef = useRef(onGeometryChange);

  const [ready, setReady] = useState(false);
  const [raster, setRaster] = useState(false);
  const [tool, setTool] = useState<Tool>('pan');
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    onChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  // Create the map and the drawing layer once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let draw: TerraDraw | null = null;
    const controller = new AbortController();

    const emit = (polygon: Polygon) => {
      const next = normalizeGeometry({ type: 'Polygon', coordinates: polygon.coordinates });
      syncedRef.current = encodeGeometry(next);
      editableRef.current = true;
      setEditable(true);
      onChangeRef.current(next);
    };

    void resolveStyle(controller.signal).then(({ style, raster: isRaster }) => {
      if (cancelled) return;
      map = new MapLibreMap({
        container,
        style,
        center: [31.2, 48.6],
        zoom: 4,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

      // 'style.load' comes as soon as layers can be added; 'load' would also wait for every tile.
      map.once('style.load', () => {
        if (cancelled || !map) return;
        map.addSource('countries', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'countries-outline',
          type: 'line',
          source: 'countries',
          paint: { 'line-color': '#3d4a5c', 'line-width': 1.5, 'line-dasharray': [3, 2] },
        });
        // Read-only layer for shapes the editor cannot hold (holes, several polygons).
        map.addSource('area-static', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'area-static-fill',
          type: 'fill',
          source: 'area-static',
          paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.12 },
        });
        map.addLayer({
          id: 'area-static-line',
          type: 'line',
          source: 'area-static',
          paint: { 'line-color': AREA_COLOR, 'line-width': 2 },
        });

        const instance = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: COORD_DECIMALS }),
          modes: [
            new TerraDrawPolygonMode({
              styles: {
                fillColor: AREA_COLOR,
                fillOpacity: 0.12,
                outlineColor: AREA_COLOR,
                outlineWidth: 2,
                closingPointColor: '#ffffff',
                closingPointOutlineColor: AREA_COLOR,
                closingPointOutlineWidth: 2,
                closingPointWidth: 5,
              },
            }),
            new TerraDrawSelectMode({
              flags: {
                polygon: {
                  feature: {
                    draggable: true,
                    coordinates: { midpoints: true, draggable: true, deletable: true },
                  },
                },
              },
              styles: {
                selectedPolygonColor: AREA_COLOR,
                selectedPolygonFillOpacity: 0.18,
                selectedPolygonOutlineColor: AREA_COLOR,
                selectedPolygonOutlineWidth: 2,
                selectionPointColor: '#ffffff',
                selectionPointOutlineColor: AREA_COLOR,
                selectionPointOutlineWidth: 2,
                selectionPointWidth: 5,
                midPointColor: AREA_COLOR,
                midPointOutlineColor: '#ffffff',
                midPointOutlineWidth: 1,
                midPointWidth: 4,
              },
            }),
          ],
        });
        draw = instance;
        instance.start();

        instance.on('finish', (id, context) => {
          const feature = instance.getSnapshotFeature(id);
          if (!feature || feature.geometry.type !== 'Polygon') return;
          if (context.mode === 'polygon') {
            // A new shape replaces the previous one: one area at a time.
            const others = drawnPolygons(instance)
              .map((f) => f.id)
              .filter((other) => other !== undefined && other !== id);
            if (others.length > 0) {
              suppressRef.current = true;
              try {
                instance.removeFeatures(others as (string | number)[]);
              } finally {
                suppressRef.current = false;
              }
            }
            (map?.getSource('area-static') as GeoJSONSource | undefined)?.setData(EMPTY);
            emit(feature.geometry);
            // Let the mode finish its own work before switching to editing.
            setTimeout(() => {
              if (cancelled || !instance.hasFeature(id)) return;
              instance.setMode('select');
              instance.selectFeature(id);
              setTool('edit');
            }, 0);
          } else {
            emit(feature.geometry);
          }
        });

        instance.on('change', (_ids, type) => {
          if (suppressRef.current || type !== 'delete') return;
          // The shape was deleted in edit mode (Delete key).
          if (syncedRef.current && editableRef.current && drawnPolygons(instance).length === 0) {
            syncedRef.current = '';
            editableRef.current = false;
            setEditable(false);
            setTool('pan');
            setTimeout(() => {
              if (!cancelled) instance.setMode('static');
            }, 0);
            onChangeRef.current(null);
          }
        });

        mapRef.current = map;
        drawRef.current = instance;
        setRaster(isRaster);
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
      try {
        draw?.stop();
      } catch {
        // The map may already be gone; nothing to clean up then.
      }
      map?.remove();
      mapRef.current = null;
      drawRef.current = null;
      syncedRef.current = undefined;
      editableRef.current = false;
    };
  }, []);

  // Outline of the areas that have data.
  useEffect(() => {
    if (!ready) return;
    const source = mapRef.current?.getSource('countries') as GeoJSONSource | undefined;
    if (!source) return;
    const features: Feature[] = [];
    for (const country of countries) {
      const polygon = bboxToPolygon(country.bbox);
      if (polygon.ok) {
        features.push({
          type: 'Feature',
          geometry: polygon.value,
          properties: { name: country.name },
        });
      }
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [ready, countries]);

  // Show an area that came from outside the map (examples, forms, shared link).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    // Skip shapes that came from the map itself (they are already on it).
    const key = geometry ? encodeGeometry(geometry) : '';
    if (key === syncedRef.current) return;
    syncedRef.current = key;

    let inEditor = false;
    suppressRef.current = true;
    try {
      draw.setMode('static');
      draw.clear();
      if (geometry && isSimplePolygon(geometry)) {
        const results = draw.addFeatures([
          { type: 'Feature', geometry, properties: { mode: 'polygon' } },
        ]);
        inEditor = results.length > 0 && results.every((r) => r.valid);
      }
    } finally {
      suppressRef.current = false;
    }

    const staticSource = map.getSource('area-static') as GeoJSONSource | undefined;
    staticSource?.setData(
      geometry && !inEditor ? { type: 'Feature', geometry, properties: {} } : EMPTY,
    );
    editableRef.current = inEditor;
    // The toolbar mirrors the state of the imperative map widget.
    setEditable(inEditor);
    setTool('pan');

    if (geometry) {
      const [w, s, e, n] = geometryBBox(geometry);
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { padding: 36, maxZoom: 10, duration: prefersReducedMotion() ? 0 : 500 },
      );
    }
  }, [ready, geometry]);

  const startDraw = () => {
    const draw = drawRef.current;
    if (!draw) return;
    if (tool === 'draw') {
      draw.setMode('static');
      setTool('pan');
      return;
    }
    draw.setMode('polygon');
    setTool('draw');
  };

  const startEdit = () => {
    const draw = drawRef.current;
    if (!draw) return;
    if (tool === 'edit') {
      draw.setMode('static');
      setTool('pan');
      return;
    }
    const id = drawnPolygons(draw)[0]?.id;
    if (id === undefined) return;
    draw.setMode('select');
    draw.selectFeature(id);
    setTool('edit');
  };

  const reset = () => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (draw) {
      suppressRef.current = true;
      try {
        draw.setMode('static');
        draw.clear();
      } finally {
        suppressRef.current = false;
      }
    }
    (map?.getSource('area-static') as GeoJSONSource | undefined)?.setData(EMPTY);
    syncedRef.current = '';
    editableRef.current = false;
    setEditable(false);
    setTool('pan');
    onGeometryChange(null);
  };

  const hint = !ready
    ? 'Loading the map\u2026'
    : tool === 'draw'
      ? 'Click the map to add corners. Click the first corner again, or press Enter, to finish. Esc cancels.'
      : tool === 'edit'
        ? 'Drag a corner or the whole shape. Drag a small midpoint to add a corner; right-click a corner to remove it.'
        : geometry && !editable && !isSimplePolygon(geometry)
          ? 'This shape has holes or several parts, so it cannot be edited here. Draw a new one or use the form below.'
          : 'Draw your own area, or pick an example below. Dashed outline: where data is available.';

  return (
    <div className="map-panel">
      <div className="map-toolbar" role="toolbar" aria-label="Area drawing tools">
        <button
          type="button"
          className="button"
          aria-pressed={tool === 'draw'}
          onClick={startDraw}
          disabled={!ready}
        >
          {tool === 'draw' ? 'Cancel drawing' : 'Draw polygon'}
        </button>
        <button
          type="button"
          className="button"
          aria-pressed={tool === 'edit'}
          onClick={startEdit}
          disabled={!ready || !editable}
        >
          {tool === 'edit' ? 'Done editing' : 'Edit shape'}
        </button>
        <button
          type="button"
          className="button"
          onClick={reset}
          disabled={!ready || geometry === null}
        >
          Reset
        </button>
      </div>
      {/* MapLibre adds its own classes to this element, so its className must never change. */}
      <div
        ref={containerRef}
        className="map"
        role="group"
        aria-label="Map for choosing the area. Arrow keys pan, plus and minus zoom. Drawing needs a pointer; the forms below do the same with the keyboard."
      />
      <p className="hint" aria-live="polite">
        {hint}
        {raster ? ' Basemap: OpenStreetMap tiles (the default basemap could not be loaded).' : ''}
      </p>
    </div>
  );
}
