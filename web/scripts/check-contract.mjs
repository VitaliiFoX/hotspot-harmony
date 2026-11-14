// Checks a running API against the contract the frontend types assume.
// Usage: npm run check:api            (API at http://localhost:8000)
//        VITE_API_URL=https://... npm run check:api
const base = (process.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
const problems = [];
const notes = [];

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** spec: { key: 'number' | 'string|null' | ... }; a trailing "?" on the key marks it optional. */
function check(where, value, spec) {
  if (typeOf(value) !== 'object') {
    problems.push(`${where}: expected an object, got ${typeOf(value)}`);
    return;
  }
  const known = new Set();
  for (const [rawKey, types] of Object.entries(spec)) {
    const optional = rawKey.endsWith('?');
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    known.add(key);
    if (!(key in value)) {
      if (!optional) problems.push(`${where}.${key}: missing`);
      continue;
    }
    const actual = typeOf(value[key]);
    if (!types.split('|').includes(actual)) {
      problems.push(`${where}.${key}: expected ${types}, got ${actual}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!known.has(key))
      notes.push(`${where}.${key}: extra key not in the contract (${typeOf(value[key])})`);
  }
}

async function call(path, init) {
  const response = await fetch(`${base}${path}`, init);
  return { response, body: await response.json().catch(() => null) };
}

const post = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const box = (w, s, e, n) => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});

try {
  const health = await call('/api/health');
  check('health', health.body, { status: 'string' });

  const { body: meta } = await call('/api/meta');
  check('meta', meta, {
    unit: 'string',
    unit_short: 'string',
    attribution: 'string',
    grid: 'object',
    series: 'object',
    countries: 'array',
    record: 'array',
    'report?': 'object',
  });
  check('meta.grid', meta?.grid, { cell_deg: 'number' });
  check('meta.series', meta?.series, { start: 'string', end: 'string' });
  (meta?.countries ?? []).forEach((c, i) =>
    check(`meta.countries[${i}]`, c, {
      name: 'string',
      bbox: 'array',
      start: 'string',
      end: 'string',
      'calibration?': 'string',
    }),
  );
  (meta?.record ?? []).forEach((r, i) =>
    check(`meta.record[${i}]`, r, {
      sensor: 'string',
      label: 'string',
      from: 'string',
      to: 'string|null',
    }),
  );
  if (meta?.attribution !== 'NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m)') {
    problems.push(`meta.attribution: unexpected text "${meta?.attribution}"`);
  }

  const areas = [
    ['Chornobyl', { geometry: box(29.2, 51.1, 30.6, 51.6) }],
    [
      'Ukraine 2010-2013',
      { geometry: box(22.0, 44.0, 40.3, 52.5), start: '2010-01', end: '2013-12' },
    ],
  ];
  for (const [name, body] of areas) {
    const { response, body: cal } = await call('/api/calendar', post(body));
    const where = `calendar(${name})`;
    if (!response.ok) {
      problems.push(`${where}: HTTP ${response.status}`);
      continue;
    }
    check(where, cal, {
      cells_used: 'number',
      countries: 'array',
      months: 'array',
      climatology: 'array',
      anomaly: 'object|null',
      yearly: 'array',
      'top_months?': 'array',
      'unit?': 'string',
    });
    const first = (list) => (Array.isArray(list) && list.length > 0 ? list[0] : undefined);
    if (first(cal.months)) {
      check(`${where}.months[0]`, first(cal.months), {
        year: 'number',
        month: 'number',
        n_harmonized: 'number',
        n_raw: 'number',
        sensor_used: 'string',
        lo: 'number',
        hi: 'number',
      });
    }
    if (first(cal.climatology)) {
      check(`${where}.climatology[0]`, first(cal.climatology), {
        month: 'number',
        median: 'number',
        p25: 'number',
        p75: 'number',
        years: 'number',
      });
    }
    if (cal.anomaly) {
      check(`${where}.anomaly`, cal.anomaly, {
        year: 'number',
        month: 'number',
        value: 'number',
        median: 'number',
        ratio: 'number|null',
        percentile: 'number',
        lo: 'number',
        hi: 'number',
        'years_compared?': 'number',
      });
    }
    if (first(cal.yearly)) {
      check(`${where}.yearly[0]`, first(cal.yearly), {
        year: 'number',
        n_harmonized: 'number',
        n_raw: 'number',
        complete: 'boolean',
      });
    }
    if (first(cal.top_months)) {
      check(`${where}.top_months[0]`, first(cal.top_months), {
        year: 'number',
        month: 'number',
        value: 'number',
        median: 'number',
        ratio: 'number|null',
      });
    }
    // "months contains every month of the range, zeros included"
    const months = cal.months ?? [];
    const index = (m) => m.year * 12 + m.month - 1;
    for (let i = 1; i < months.length; i += 1) {
      if (index(months[i]) !== index(months[i - 1]) + 1) {
        problems.push(`${where}.months: gap or disorder at position ${i}`);
        break;
      }
    }
    if (
      body.start &&
      months[0] &&
      `${months[0].year}-${String(months[0].month).padStart(2, '0')}` !== body.start
    ) {
      problems.push(`${where}.months: does not start at the requested ${body.start}`);
    }
    const badRange = months.find((m) => m.lo > m.n_harmonized || m.hi < m.n_harmonized);
    if (badRange)
      problems.push(
        `${where}.months: lo/hi do not bracket the value in ${badRange.year}-${badRange.month}`,
      );
    console.log(
      `${where}: ${months.length} months, ${cal.cells_used} cells, countries ${JSON.stringify(cal.countries)}`,
    );
  }

  const outside = await call('/api/calendar', post({ geometry: box(0, 0, 1, 1) }));
  if (outside.response.status !== 422 || typeof outside.body?.detail !== 'string') {
    problems.push(
      `calendar(outside): expected HTTP 422 with a string detail, got ${outside.response.status}`,
    );
  }
  const invalid = await call(
    '/api/calendar',
    post({ geometry: { type: 'Point', coordinates: [0, 0] } }),
  );
  if (invalid.response.status !== 400 || typeof invalid.body?.detail !== 'string') {
    problems.push(
      `calendar(invalid geometry): expected HTTP 400 with a string detail, got ${invalid.response.status}`,
    );
  }

  const csv = await fetch(
    `${base}/api/hotspots.csv`,
    post({ geometry: box(29.2, 51.1, 30.6, 51.6), start: '2025-01-01', end: '2025-12-31' }),
  );
  const csvType = csv.headers.get('content-type') ?? '';
  const text = await csv.text();
  if (!csv.ok || !csvType.startsWith('text/csv')) {
    problems.push(`hotspots.csv: HTTP ${csv.status}, content-type "${csvType}"`);
  }
  if (csv.headers.get('x-truncated') === null) {
    notes.push('hotspots.csv: no X-Truncated header (treated as "not truncated")');
  }
  console.log(`hotspots.csv: ${text.split('\n').length - 2} rows, header "${text.split('\n')[0]}"`);
} catch (error) {
  problems.push(
    `Cannot reach the API at ${base}: ${error instanceof Error ? error.message : error}`,
  );
}

for (const note of notes) console.log(`note: ${note}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} contract problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nAPI at ${base} matches the contract.`);
