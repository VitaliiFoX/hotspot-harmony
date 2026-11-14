import { afterEach, describe, expect, it, vi } from 'vitest';
import { bboxToPolygon } from '../lib/geometry';
import { ApiError, detailText, getMeta, postCalendar, postHotspotsCsv } from './client';

const polygon = (() => {
  const result = bboxToPolygon([29.2, 51.1, 30.6, 51.6]);
  if (!result.ok) throw new Error(result.error);
  return result.value;
})();

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detailText', () => {
  it('reads a plain FastAPI detail', () => {
    expect(detailText({ detail: 'Outside every country.' }, 'fallback')).toBe(
      'Outside every country.',
    );
  });

  it('joins a list of validation issues', () => {
    const body = {
      detail: [
        { loc: ['body', 'geometry'], msg: 'Field required' },
        { loc: ['body', 'start'], msg: 'bad month' },
      ],
    };
    expect(detailText(body, 'fallback')).toBe('geometry: Field required; start: bad month');
  });

  it('falls back when there is nothing usable', () => {
    expect(detailText(null, 'fallback')).toBe('fallback');
    expect(detailText({ detail: 42 }, 'fallback')).toBe('fallback');
    expect(detailText({ detail: [] }, 'fallback')).toBe('fallback');
  });
});

describe('API client', () => {
  it('posts the calendar request to the default base URL', async () => {
    const answer = {
      cells_used: 1,
      countries: [],
      months: [],
      climatology: [],
      anomaly: null,
      yearly: [],
    };
    const mock = stubFetch(async () => jsonResponse(answer));
    const data = await postCalendar({ geometry: polygon, start: '2010-01' });
    expect(data).toEqual(answer);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8000/api/calendar');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ geometry: polygon, start: '2010-01' });
  });

  it('turns an unreachable server into a "network" error', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(getMeta()).rejects.toMatchObject({
      kind: 'network',
      message: 'Cannot reach the API at http://localhost:8000.',
    });
  });

  it('keeps the server detail text for 400 and 422', async () => {
    stubFetch(async () =>
      jsonResponse({ detail: 'The area is outside the countries with data.' }, 422),
    );
    const error = await postCalendar({ geometry: polygon }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'http',
      status: 422,
      message: 'The area is outside the countries with data.',
    });
  });

  it('copes with an error answer that is not JSON', async () => {
    stubFetch(async () => new Response('Internal Server Error', { status: 500 }));
    await expect(getMeta()).rejects.toMatchObject({
      kind: 'http',
      status: 500,
      message: 'The API answered with HTTP 500.',
    });
  });

  it('rejects answers that do not follow the contract', async () => {
    stubFetch(async () => jsonResponse({ hello: 'world' }));
    await expect(getMeta()).rejects.toMatchObject({ kind: 'invalid' });
    await expect(postCalendar({ geometry: polygon })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('lets an aborted request surface as an abort, not as an API error', async () => {
    stubFetch(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const error = await getMeta().catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('reads the truncation flag and the file name of the CSV export', async () => {
    stubFetch(
      async () =>
        new Response('lat,lon\n1,2\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'X-Truncated': 'true',
            'Content-Disposition': 'attachment; filename="hotspots_a_b.csv"',
          },
        }),
    );
    const result = await postHotspotsCsv({
      geometry: polygon,
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(result.truncated).toBe(true);
    expect(result.filename).toBe('hotspots_a_b.csv');
    expect(await result.blob.text()).toBe('lat,lon\n1,2\n');
  });

  it('defaults to "not truncated" and a generated file name', async () => {
    stubFetch(async () => new Response('lat,lon\n', { status: 200 }));
    const result = await postHotspotsCsv({
      geometry: polygon,
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(result.truncated).toBe(false);
    expect(result.filename).toBe('hotspots_2025-01-01_2025-12-31.csv');
  });
});

describe('fixtures mode', () => {
  it('answers from fixtures without touching the network when VITE_USE_FIXTURES=1', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    vi.resetModules();
    const mock = stubFetch(async () => {
      throw new Error('the network must not be used');
    });
    try {
      const client = await import('./client');
      expect(client.USE_FIXTURES).toBe(true);
      const meta = await client.getMeta();
      expect(meta.countries.length).toBeGreaterThan(0);
      const data = await client.postCalendar({ geometry: polygon });
      expect(data.months.length).toBeGreaterThan(0);
      const csv = await client.postHotspotsCsv({
        geometry: polygon,
        start: '2025-01-01',
        end: '2025-12-31',
      });
      expect(csv.truncated).toBe(false);
      expect(mock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
