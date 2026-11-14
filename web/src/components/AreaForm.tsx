import { useId, useState, type FormEvent } from 'react';
import type { ExampleArea } from '../lib/examples';
import {
  MAX_RADIUS_KM,
  bboxToPolygon,
  circleToPolygon,
  geometryBBox,
  type AreaGeometry,
} from '../lib/geometry';
import { encodeGeometry } from '../lib/urlState';
import { Segmented } from './Segmented';

type FormKind = 'bbox' | 'circle';

interface AreaFormProps {
  examples: readonly ExampleArea[];
  geometry: AreaGeometry | null;
  onGeometry: (geometry: AreaGeometry) => void;
}

function parseNumber(text: string): number {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

function NumberField({ label, value, onChange, hint }: NumberFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface SubFormProps {
  initial: [number, number, number, number] | null;
  onGeometry: (geometry: AreaGeometry) => void;
}

function BBoxForm({ initial, onGeometry }: SubFormProps) {
  const [west, setWest] = useState(initial ? trimNumber(initial[0]) : '');
  const [south, setSouth] = useState(initial ? trimNumber(initial[1]) : '');
  const [east, setEast] = useState(initial ? trimNumber(initial[2]) : '');
  const [north, setNorth] = useState(initial ? trimNumber(initial[3]) : '');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = bboxToPolygon([west, south, east, north].map(parseNumber));
    if (result.ok) {
      setError(null);
      onGeometry(result.value);
    } else {
      setError(result.error);
    }
  };

  return (
    <form className="area-form" onSubmit={submit} noValidate>
      <div className="field-grid field-grid--4">
        <NumberField label="West (lon)" value={west} onChange={setWest} hint="29.2" />
        <NumberField label="South (lat)" value={south} onChange={setSouth} hint="51.1" />
        <NumberField label="East (lon)" value={east} onChange={setEast} hint="30.6" />
        <NumberField label="North (lat)" value={north} onChange={setNorth} hint="51.6" />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button button--primary">
        Use this box
      </button>
    </form>
  );
}

function CircleForm({ initial, onGeometry }: SubFormProps) {
  const [lat, setLat] = useState(initial ? trimNumber((initial[1] + initial[3]) / 2) : '');
  const [lon, setLon] = useState(initial ? trimNumber((initial[0] + initial[2]) / 2) : '');
  const [radius, setRadius] = useState('50');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = circleToPolygon(parseNumber(lat), parseNumber(lon), parseNumber(radius));
    if (result.ok) {
      setError(null);
      onGeometry(result.value);
    } else {
      setError(result.error);
    }
  };

  return (
    <form className="area-form" onSubmit={submit} noValidate>
      <div className="field-grid field-grid--3">
        <NumberField label="Centre latitude" value={lat} onChange={setLat} hint="51.39" />
        <NumberField label="Centre longitude" value={lon} onChange={setLon} hint="30.1" />
        <NumberField
          label={`Radius, km (max ${MAX_RADIUS_KM})`}
          value={radius}
          onChange={setRadius}
          hint="50"
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button button--primary">
        Use this circle
      </button>
    </form>
  );
}

/** Example areas plus the keyboard-friendly alternatives to drawing on the map. */
export function AreaForm({ examples, geometry, onGeometry }: AreaFormProps) {
  const [kind, setKind] = useState<FormKind>('bbox');
  const current = geometry ? encodeGeometry(geometry) : '';
  const bbox = geometry ? geometryBBox(geometry) : null;

  return (
    <div className="area-controls">
      {examples.length > 0 ? (
        <div className="examples">
          <h3 className="mini-heading" id="examples-heading">
            Example areas
          </h3>
          <div className="chip-row" role="group" aria-labelledby="examples-heading">
            {examples.map((example) => (
              <button
                key={example.id}
                type="button"
                className="chip"
                aria-pressed={encodeGeometry(example.geometry) === current}
                onClick={() => onGeometry(example.geometry)}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="coords">
        <Segmented
          legend="Or enter coordinates"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'bbox', label: 'Bounding box' },
            { value: 'circle', label: 'Centre + radius' },
          ]}
        />
        {/* The key resets the fields to the current area whenever the area changes. */}
        {kind === 'bbox' ? (
          <BBoxForm key={`bbox-${current}`} initial={bbox} onGeometry={onGeometry} />
        ) : (
          <CircleForm key={`circle-${current}`} initial={bbox} onGeometry={onGeometry} />
        )}
      </div>
    </div>
  );
}
