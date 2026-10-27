import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocoder, parsePlace } from '../server/geo.js';

const hsr = {
  lat: '12.9116', lon: '77.6473', display_name: 'HSR Layout, Bengaluru, Karnataka, 560102, India',
  address: { suburb: 'HSR Layout', city: 'Bengaluru', state: 'Karnataka', postcode: '560102', country_code: 'in' },
};

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers ?? {} });
    const next = queue.shift() ?? { status: 200, body: [] };
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  };
  return { impl, calls };
}

const geocoder = (fetchImpl) => createGeocoder({ fetchImpl, minIntervalMs: 0, userAgent: 'test-agent' });

test('parsePlace builds a short label, numeric coords and a 6-digit pincode', () => {
  assert.deepEqual(parsePlace(hsr), {
    label: 'HSR Layout, Bengaluru', fullName: hsr.display_name, lat: 12.9116, lon: 77.6473,
    pincode: '560102', country: 'in',
  });
});

test('parsePlace leaves pincode null outside India-style postcodes (UAE)', () => {
  const dubai = { lat: '25.19', lon: '55.27', display_name: 'Downtown Dubai', address: { suburb: 'Downtown Dubai', city: 'Dubai', country_code: 'ae' } };
  assert.equal(parsePlace(dubai).pincode, null);
  assert.equal(parsePlace(dubai).label, 'Downtown Dubai, Dubai');
});

test('a 6-digit query uses a structured postalcode lookup and keeps the typed pincode', async () => {
  const noPostcode = { ...hsr, address: { ...hsr.address, postcode: undefined } };
  const { impl, calls } = fakeFetch([{ status: 200, body: [noPostcode] }]);
  const places = await geocoder(impl).search('560102');
  assert.match(calls[0].url, /postalcode=560102/);
  assert.match(calls[0].url, /countrycodes=in/);
  assert.equal(calls[0].headers['User-Agent'], 'test-agent');
  assert.equal(places[0].pincode, '560102');
});

test('falls back to free-text search when the postalcode lookup is empty', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: [] }, { status: 200, body: [hsr] }]);
  const places = await geocoder(impl).search('560102');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /q=560102/);
  assert.equal(places.length, 1);
});

test('area names use free-text search across India and UAE', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: [hsr] }]);
  await geocoder(impl).search('HSR Layout Bangalore');
  assert.match(calls[0].url, /q=HSR\+Layout\+Bangalore/);
  assert.match(calls[0].url, /countrycodes=in%2Cae/);
});

test('identical lookups are served from cache', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: [hsr] }]);
  const g = geocoder(impl);
  await g.search('HSR Layout');
  await g.search('  hsr layout ');
  assert.equal(calls.length, 1);
});

test('reverse geocoding returns one place for device coordinates', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: hsr }]);
  const place = await geocoder(impl).reverse(12.9116, 77.6473);
  assert.match(calls[0].url, /reverse\?.*lat=12.9116.*lon=77.6473/);
  assert.equal(place.pincode, '560102');
});

test('non-2xx responses from the geocoder become errors', async () => {
  const { impl } = fakeFetch([{ status: 429, body: {} }]);
  await assert.rejects(() => geocoder(impl).search('Koramangala'), /HTTP 429/);
});
