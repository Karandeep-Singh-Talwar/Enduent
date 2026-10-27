import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachEta, brandCounts, brandMatrix, brandsMatching, buildBrandQueries, filterByBrands, filterRelevant, isRelevant,
  locationKey, matchesBrand, mergeProductRows, missingEtaPlatforms, parseEtaResults, platformStatus,
} from '../public/dataset.js';

const row = (overrides = {}) => ({
  platform: 'BlinkIt', id: '1', name: 'Salted Butter', brand: 'Amul', price: 60, mrp: 63,
  rank: 1, sponsored: false, available: true, eta: 'NA', store_id: null, ...overrides,
});

test('mergeProductRows dedupes by platform + id, keeping the best-ranked copy', () => {
  const merged = mergeProductRows([
    [row({ id: '1', rank: 5 }), row({ id: '2', rank: 2 })],
    [row({ id: '1', rank: 3 }), row({ platform: 'Swiggy Instamart', id: '9', rank: 1 })],
    [row({ platform: 'Swiggy', id: '9', rank: 4 })],
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r) => r.id === '1').rank, 3);
  assert.equal(merged.find((r) => r.id === '9').rank, 1);
});

test('brandCounts groups brands (missing brand → Unbranded), most products first', () => {
  const counts = brandCounts([row(), row({ brand: 'Milky Mist' }), row({ brand: 'Milky Mist' }), row({ brand: null })]);
  assert.deepEqual(counts, [
    { brand: 'Milky Mist', count: 2 },
    { brand: 'Amul', count: 1 },
    { brand: 'Unbranded', count: 1 },
  ]);
});

test('filterByBrands returns everything when nothing is selected', () => {
  const rows = [row(), row({ brand: 'Nutralite' }), row({ brand: undefined })];
  assert.equal(filterByBrands(rows, new Set()).length, 3);
  assert.deepEqual(filterByBrands(rows, new Set(['Nutralite', 'Unbranded'])).map((r) => r.brand), ['Nutralite', undefined]);
});

test('matchesBrand is case/space-insensitive and covers sub-brands and unbranded names', () => {
  assert.equal(matchesBrand(row({ brand: 'Milky Mist' }), 'milky mist'), true);
  assert.equal(matchesBrand(row({ brand: 'Amul Lite' }), 'Amul'), true);
  assert.equal(matchesBrand(row({ brand: null, name: 'Amul Taaza Milk' }), 'amul'), true);
  assert.equal(matchesBrand(row({ brand: 'Mother Dairy', name: 'Butter like Amul' }), 'amul'), false);
  assert.equal(matchesBrand(row(), ''), false);
});

test('brandMatrix summarises each brand per platform', () => {
  const rows = [
    row({ brand: 'Amul', price: 60, rank: 3, sponsored: true }),
    row({ brand: 'Amul', id: '2', price: 250, rank: 1, available: false }),
    row({ brand: 'Amul', platform: 'Zepto', id: 'z', price: 58, rank: 7 }),
    row({ brand: 'Milky Mist', id: '3', price: 90, rank: 2 }),
  ];
  const matrix = brandMatrix(rows, ['Amul', 'Milky Mist'], ['BlinkIt', 'Zepto']);
  assert.deepEqual(matrix.Amul.BlinkIt, { count: 2, minPrice: 60, maxPrice: 250, bestRank: 1, ads: 1, inStock: 1 });
  assert.deepEqual(matrix.Amul.Zepto, { count: 1, minPrice: 58, maxPrice: 58, bestRank: 7, ads: 0, inStock: 1 });
  assert.equal(matrix['Milky Mist'].Zepto.count, 0);
  assert.equal(matrix['Milky Mist'].Zepto.minPrice, null);
});

test('parseEtaResults maps groupeta and single eta shapes to API platform ids', () => {
  const group = parseEtaResults({ data: { results: [
    { platform: 'Swiggy Instamart', eta: '12 mins', open: true, store_id: 's1' },
    { platform: 'BlinkIt', eta: '8 mins', open: false, store_id: 40589 },
  ] } });
  assert.deepEqual(group.Swiggy, { eta: '12 mins', open: true, store_id: 's1' });
  assert.equal(group.BlinkIt.open, false);
  const single = parseEtaResults({ data: { platform: 'Zepto', eta: '10 mins', open: true, store_id: 'z1' } });
  assert.deepEqual(single, { Zepto: { eta: '10 mins', open: true, store_id: 'z1' } });
});

test('attachEta fills missing ETA/store from the cache but keeps real values', () => {
  const cache = { BlinkIt: { eta: '9 mins', open: true, store_id: 40589 }, Swiggy: { eta: '15 mins', open: false, store_id: 's1' } };
  const [blinkit, swiggy, zepto] = attachEta([
    row(),
    row({ platform: 'Swiggy Instamart', eta: '11 mins', store_id: 's9' }),
    row({ platform: 'Zepto' }),
  ], cache);
  assert.deepEqual([blinkit.eta, blinkit.open, blinkit.store_id], ['9 mins', true, 40589]);
  assert.deepEqual([swiggy.eta, swiggy.open, swiggy.store_id], ['11 mins', false, 's9']);
  assert.deepEqual([zepto.eta, zepto.open], [null, null]);
});

test('missingEtaPlatforms lists only ETA-capable platforms not yet cached', () => {
  const missing = missingEtaPlatforms(['BlinkIt', 'Zepto', 'Amazon', 'Swiggy'], { BlinkIt: {} }, ['BlinkIt', 'Zepto', 'Swiggy']);
  assert.deepEqual(missing, ['Zepto', 'Swiggy']);
});

test('brandsMatching picks the brand chips to preselect for a brand catalog search', () => {
  const counts = [{ brand: 'Amul', count: 3 }, { brand: 'Amul Lite', count: 1 }, { brand: 'Milky Mist', count: 5 }];
  assert.deepEqual(brandsMatching(counts, 'amul'), ['Amul', 'Amul Lite']);
});

test('platformStatus merges counts, per-platform errors and cached ETA', () => {
  const rows = [row(), row({ id: '2' }), row({ platform: 'Swiggy Instamart', id: 's' })];
  const status = platformStatus(['BlinkIt', 'Swiggy', 'DMart'], rows, { DMart: 'pincode required' },
    { BlinkIt: { eta: '9 mins', open: true, store_id: 40589 } });
  assert.deepEqual(status[0], { platform: 'BlinkIt', count: 2, error: null, warning: null, eta: '9 mins', open: true, store_id: 40589 });
  assert.equal(status[1].count, 1);
  assert.equal(status[2].error, 'pincode required');
  assert.equal(status[2].warning, null);
});

test('platformStatus warns when a platform returned no products and no error', () => {
  // Seen live: groupsearch for 4 platforms billed 4 credits but `results` had no Swiggy key at all.
  const [swiggy] = platformStatus(['Swiggy'], [row()], {}, {});
  assert.equal(swiggy.count, 0);
  assert.match(swiggy.warning, /no results/i);
});

// Real tail items from the live Zepto / Blinkit "Amul Butter" response (2026-10-27).
const amulButter = ['Amul Butter'];

test('isRelevant keeps butters of any brand for "Amul Butter"', () => {
  for (const r of [
    row({ brand: 'Amul', name: 'Salted Butter' }),
    row({ brand: 'Milky Mist', name: 'Cooking Butter Unsalted' }),
    row({ brand: 'Pintola', name: 'All Natural Crunchy Almond Butter' }),
    row({ brand: 'FruBon', name: 'White Desi Butter (Ghar ka Swaad)' }),
  ]) assert.equal(isRelevant(r, amulButter), true, r.name);
});

test('isRelevant drops platform filler: dal, bread, dahi, milk, buttermilk', () => {
  for (const r of [
    row({ brand: 'Mangat Ram', name: 'Unpolished Arhar Dal/Toor Dal' }),
    row({ brand: 'Harvest Gold', name: 'White Bread' }),
    row({ brand: 'Amul', name: 'Masti Dahi Pouch' }),
    row({ brand: 'Amul', name: 'Gold Full Cream Milk' }),
    row({ brand: 'Amul', name: 'Masti Spiced Salted Buttermilk' }),
    row({ brand: 'Amul', name: 'Amul Taaza Toned Milk' }),
  ]) assert.equal(isRelevant(r, amulButter), false, r.name);
});

test('isRelevant for a brand-only query keeps that brand and drops others', () => {
  assert.equal(isRelevant(row({ brand: 'Milky Mist', name: 'Paneer' }), ['Milky Mist']), true);
  assert.equal(isRelevant(row({ brand: 'Amul', name: 'Salted Butter' }), ['Milky Mist']), false);
});

test('isRelevant handles plurals, ignores size tokens, and matches any of several queries', () => {
  assert.equal(isRelevant(row({ name: 'Farm Fresh Eggs' }), ['egg']), true);
  assert.equal(isRelevant(row({ name: 'Brown Egg' }), ['eggs']), true);
  assert.equal(isRelevant(row({ brand: 'Amul', name: 'Salted Butter' }), ['amul butter 500g']), true);
  assert.equal(isRelevant(row({ brand: 'Milky Mist', name: 'Paneer' }), ['Milky Mist curd', 'Milky Mist paneer']), true);
  assert.equal(isRelevant(row({ name: 'Anything' }), ['500g']), true);
  assert.equal(isRelevant(row({ name: 'Anything' }), []), true);
});

test('filterRelevant returns kept rows and the hidden count', () => {
  const rows = [row({ name: 'Salted Butter' }), row({ id: '2', brand: 'Bonn', name: 'White Bread' })];
  const { rows: kept, hidden } = filterRelevant(rows, amulButter);
  assert.deepEqual(kept.map((r) => r.name), ['Salted Butter']);
  assert.equal(hidden, 1);
});

test('buildBrandQueries prefixes keywords with the brand, dedupes and caps at 6', () => {
  assert.deepEqual(buildBrandQueries('Milky Mist', 'paneer, curd ,, Paneer'), ['Milky Mist', 'Milky Mist paneer', 'Milky Mist curd']);
  assert.equal(buildBrandQueries('Amul', 'a,b,c,d,e,f,g,h').length, 6);
  assert.deepEqual(buildBrandQueries('  ', 'x'), []);
});

test('locationKey rounds coordinates so tiny GPS jitter reuses the cache', () => {
  assert.equal(locationKey({ lat: 12.91214, lon: 77.64461, pincode: '560102' }), '12.912,77.645|560102');
  assert.equal(locationKey({ lat: 12.91209, lon: 77.64458, pincode: '560102' }), '12.912,77.645|560102');
  assert.equal(locationKey({ lat: 25.1972, lon: 55.2744, pincode: '' }), '25.197,55.274|');
});
