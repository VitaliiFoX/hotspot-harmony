import type {
  CalendarRequest,
  CalendarResponse,
  HealthResponse,
  HotspotsCsvRequest,
  HotspotsCsvResult,
  Meta,
} from './types';

const DEFAULT_API_URL = 'http://localhost:8000';

/** Base URL of the API, without a trailing slash. */
export const API_URL: string = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(
  /\/+$/,
  '',
);

/** When true, the app runs on built-in fixtures and never calls the network. */
export const USE_FIXTURES: boolean = import.meta.env.VITE_USE_FIXTURES === '1';

export type ApiErrorKind = 'http' | 'network' | 'invalid';

/**
 * - `http`: the server answered with an error status; `message` is its `detail` text.
 * - `network`: no answer at all (server down, CORS, offline).
 * - `invalid`: the answer was not what the contract promises.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Turn FastAPI's `detail` (a string, or a list of validation issues) into one line of text. */
export function detailText(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim() !== '') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          const { msg, loc } = item as { msg?: unknown; loc?: unknown };
          const where = Array.isArray(loc) ? loc.filter((p) => p !== 'body').join('.') : '';
          if (typeof msg === 'string') return where ? `${where}: ${msg}` : msg;
        }
        return '';
      })
      .filter((text) => text !== '');
    if (parts.length > 0) return parts.join('; ');
  }
  return fallback;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('network', `Cannot reach the API at ${API_URL}.`);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const fallback = `The API answered with HTTP ${response.status}.`;
    throw new ApiError('http', detailText(body, fallback), response.status);
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('invalid', 'The API sent an answer that is not valid JSON.');
  }
}

function postInit(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

async function fixtures() {
  return import('../fixtures');
}

/** GET /api/health */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  if (USE_FIXTURES) return { status: 'ok' };
  return json<HealthResponse>(await request('/api/health', { signal }));
}

/** GET /api/meta */
export async function getMeta(signal?: AbortSignal): Promise<Meta> {
  if (USE_FIXTURES) return (await fixtures()).fixtureMeta();
  const meta = await json<Meta>(await request('/api/meta', { signal }));
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !Array.isArray(meta.countries) ||
    !Array.isArray(meta.record) ||
    typeof meta.series?.start !== 'string' ||
    typeof meta.series?.end !== 'string'
  ) {
    throw new ApiError('invalid', 'The API description (/api/meta) is not in the expected format.');
  }
  return meta;
}

/** POST /api/calendar */
export async function postCalendar(
  body: CalendarRequest,
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  if (USE_FIXTURES) return (await fixtures()).fixtureCalendar(body);
  const data = await json<CalendarResponse>(await request('/api/calendar', postInit(body, signal)));
  if (
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray(data.months) ||
    !Array.isArray(data.climatology) ||
    !Array.isArray(data.yearly)
  ) {
    throw new ApiError('invalid', 'The calendar answer is not in the expected format.');
  }
  return data;
}

function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

/** POST /api/hotspots.csv: raw points as a CSV file. */
export async function postHotspotsCsv(
  body: HotspotsCsvRequest,
  signal?: AbortSignal,
): Promise<HotspotsCsvResult> {
  if (USE_FIXTURES) return (await fixtures()).fixtureHotspotsCsv(body);
  const response = await request('/api/hotspots.csv', postInit(body, signal));
  const fallback = `hotspots_${body.start}_${body.end}.csv`;
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('network', 'The download was interrupted.');
  }
  return {
    blob,
    truncated: response.headers.get('X-Truncated')?.toLowerCase() === 'true',
    filename: filenameFrom(response.headers.get('Content-Disposition'), fallback),
  };
}
