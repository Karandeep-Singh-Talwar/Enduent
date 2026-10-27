import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRows, fieldInventory, toCsv, platformSummary, PRODUCT_COLUMNS } from '../public/extract.js';

const product = (overrides = {}) => ({
  id: '362674',
  name: 'Aashirvaad Atta',
  brand: 'Aashirvaad',
  available: true,
  images: ['https://cdn.example/a.jpg'],
  mrp: 500,
  offer_price: 400,
  quantity: '5 kg',
  deeplink: 'https://blinkit.com/prn/x/prid/362674',
  rating: 4.4,
  rating_count: 1200,
  inventory: 12,
  platform: { name: 'BlinkIt', sla: '10 mins', open: true },
  ...overrides,
});

test('extracts normalized product rows from a single search', () => {
  const body = { status: 'success', data: { query: 'atta', products: [product()] } };
  const { kind, rows } = extractRows(body);
  assert.equal(kind, 'products');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'BlinkIt');
  assert.equal(rows[0].price, 400);
  assert.equal(rows[0].discount_pct, 20);
  assert.equal(rows[0].eta, '10 mins');
  assert.equal(rows[0].image, 'https://cdn.example/a.jpg');
});

// Shape observed in a live Blinkit /v1/search response (2026-10-27), beyond the documented fields.
const blinkitLive = (overrides = {}) => product({
  rank: 3, is_ad: false, store_id: 40589, currency: 'INR', rating: 4.599999904632568, ...overrides,
});

test('normalizes undocumented live fields: rank, sponsored, store_id, currency', () => {
  const { rows } = extractRows({ data: { products: [blinkitLive(), blinkitLive({ rank: 4, is_ad: true })] } });
  assert.equal(rows[0].rank, 3);
  assert.equal(rows[0].sponsored, false);
  assert.equal(rows[0].store_id, 40589);
  assert.equal(rows[0].currency, 'INR');
  assert.equal(rows[1].sponsored, true);
});

test('falls back to platform.storeId (group=true shape) and leaves missing fields null', () => {
  const raw = product({ platform: { name: 'Zepto', storeId: 'zs-9' } });
  const [row] = extractRows({ data: { products: [raw] } }).rows;
  assert.equal(row.store_id, 'zs-9');
  assert.equal(row.sponsored, null);
  assert.equal(row.currency, null);
});

test('uses list position as rank when the API omits it (groupsearch arrays per platform)', () => {
  // Live /v1/groupsearch: results.{Platform} is a bare array and products carry no rank / is_ad.
  const noRank = (id) => product({ id, rank: undefined, platform: undefined });
  const body = { data: { results: { Zepto: [noRank('z1'), noRank('z2'), noRank('z3')], BlinkIt: [noRank('b1')] } } };
  const byId = Object.fromEntries(extractRows(body).rows.map((r) => [r.id, r]));
  assert.deepEqual([byId.z1.rank, byId.z2.rank, byId.z3.rank, byId.b1.rank], [1, 2, 3, 1]);
  assert.equal(byId.z3.platform, 'Zepto');
});

test('keeps the API rank when present instead of list position', () => {
  const body = { data: { products: [product({ id: 'a', rank: 7 }), product({ id: 'b', rank: 2 })] } };
  assert.deepEqual(extractRows(body).rows.map((r) => r.rank), [7, 2]);
});

test('a standalone product object has no list position, so rank stays null', () => {
  const body = { data: { item_id: '7', name: 'Milk', price: 30 } };
  assert.equal(extractRows(body).rows[0].rank, null);
});

test('rounds ratings to one decimal and drops non-numeric ratings', () => {
  const ratings = [4.599999904632568, 4.699999809265137, 4.800000190734863, '4.45', null, 'n/a'];
  const { rows } = extractRows({ data: { products: ratings.map((rating) => blinkitLive({ rating })) } });
  assert.deepEqual(rows.map((r) => r.rating), [4.6, 4.7, 4.8, 4.5, null, null]);
});

test('product columns and CSV export include the new fields', () => {
  for (const col of ['rank', 'sponsored', 'store_id', 'currency']) assert.ok(PRODUCT_COLUMNS.includes(col), col);
  const { rows, columns } = extractRows({ data: { products: [blinkitLive()] } });
  const [header, line] = toCsv(rows, columns).split('\r\n');
  const cells = Object.fromEntries(header.split(',').map((h, i) => [h, line.split(',')[i]]));
  assert.equal(cells.rank, '3');
  assert.equal(cells.sponsored, 'false');
  assert.equal(cells.store_id, '40589');
  assert.equal(cells.currency, 'INR');
  assert.equal(cells.rating, '4.6');
});

test('uses the results key as platform when a product lacks platform info', () => {
  const body = {
    data: {
      results: {
        Zepto: { products: [product({ platform: undefined, id: 'z1' })] },
        BlinkIt: { products: [product()] },
      },
    },
  };
  const { rows } = extractRows(body);
  assert.deepEqual(rows.map((r) => r.platform).sort(), ['BlinkIt', 'Zepto']);
});

test('reads item-detail shape (price + gallery)', () => {
  const body = { data: { items: [{ item_id: '9', name: 'Milk', price: 30, mrp: 32, gallery: ['https://g/1.jpg'] }] } };
  const { kind, rows } = extractRows(body);
  assert.equal(kind, 'products');
  assert.equal(rows[0].id, '9');
  assert.equal(rows[0].price, 30);
  assert.equal(rows[0].image, 'https://g/1.jpg');
});

test('recognises a single product object that is not wrapped in an array', () => {
  const body = { data: { item_id: '7', name: 'Milk', price: 30, variants: [{ name: '1L', price: 60 }] } };
  const { kind, rows } = extractRows(body);
  assert.equal(kind, 'products');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Milk');
});

test('does not treat a price-only object without an id (screenshot api_price) as a product', () => {
  const body = { data: { job_id: 'j1', status: 'done', api_price: { name: 'Milk', price: 30, mrp: 32 } } };
  assert.equal(extractRows(body).kind, 'generic');
});

test('falls back to generic rows for non-product arrays', () => {
  const body = { data: { results: [{ platform: 'BlinkIt', eta: '8 mins', open: true }, { platform: 'Zepto', eta: '12 mins', open: false }] } };
  const { kind, rows, columns } = extractRows(body);
  assert.equal(kind, 'generic');
  assert.equal(rows.length, 2);
  assert.deepEqual(columns, ['platform', 'eta', 'open']);
});

test('falls back to a single row for a plain object payload', () => {
  const body = { data: { platform: 'BlinkIt', eta: '9 mins', store_ids: [1, 2], open: true } };
  const { kind, rows } = extractRows(body);
  assert.equal(kind, 'generic');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].store_ids, '1, 2');
});

test('fieldInventory reports fill rate, type and sample per path', () => {
  const raws = [product(), product({ rating: null, brand: '' })];
  const fields = fieldInventory(raws);
  const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
  assert.equal(byPath.rating.filled, 1);
  assert.equal(byPath.rating.total, 2);
  assert.equal(byPath.brand.filled, 1);
  assert.equal(byPath['platform.sla'].type, 'string');
  assert.equal(byPath['images[]'].type, 'string');
});

test('toCsv escapes quotes/commas and neutralises formula injection', () => {
  const csv = toCsv([{ a: 'x, "y"', b: '=SUM(A1)', c: -5 }], ['a', 'b', 'c']);
  const [header, line] = csv.split('\r\n');
  assert.equal(header, 'a,b,c');
  assert.equal(line, '"x, ""y""",\'=SUM(A1),-5');
});

test('platformSummary counts products and surfaces per-platform errors', () => {
  const body = {
    data: {
      results: {
        BlinkIt: { products: [product(), product()] },
        DMart: { error: 'pincode required' },
      },
    },
  };
  const summary = platformSummary(body);
  assert.deepEqual(summary, [
    { platform: 'BlinkIt', count: 2, error: null },
    { platform: 'DMart', count: 0, error: 'pincode required' },
  ]);
});
