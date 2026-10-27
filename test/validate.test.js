import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParams } from '../shared/validate.js';
import { ENDPOINTS, estimateCost } from '../shared/endpoints.js';

const LOC = { lat: '12.9021', lon: '77.6639' };

test('search reports every missing required param', () => {
  const result = validateParams(ENDPOINTS.search, {});
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.param).sort(), ['lat', 'lon', 'platform', 'q']);
});

test('search accepts valid params and coerces coordinates to numbers', () => {
  const result = validateParams(ENDPOINTS.search, { ...LOC, q: ' atta ', platform: 'BlinkIt' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.params, { q: 'atta', lat: 12.9021, lon: 77.6639, platform: 'BlinkIt' });
});

test('rejects out-of-range latitude and non-numeric longitude', () => {
  const result = validateParams(ENDPOINTS.search, { q: 'x', platform: 'Zepto', lat: '95', lon: 'abc' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => e.param).sort(), ['lat', 'lon']);
});

test('drops params not declared for the endpoint', () => {
  const result = validateParams(ENDPOINTS.eta, { ...LOC, platform: 'Zepto', api_key: 'leak', evil: '1' });
  assert.equal(result.ok, true);
  assert.equal('api_key' in result.params, false);
  assert.equal('evil' in result.params, false);
});

test('treats empty strings as absent', () => {
  const result = validateParams(ENDPOINTS.eta, { ...LOC, platform: 'Zepto', pincode: '' });
  assert.equal(result.ok, true);
  assert.equal('pincode' in result.params, false);
});

test('pincode must be exactly 6 digits', () => {
  const result = validateParams(ENDPOINTS.eta, { ...LOC, platform: 'Zepto', pincode: '5601' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].param, 'pincode');
});

test('DMart, JioMart and Minutes require a pincode', () => {
  for (const platform of ['DMart', 'JioMart', 'Minutes']) {
    const result = validateParams(ENDPOINTS.search, { ...LOC, q: 'milk', platform });
    assert.equal(result.ok, false, platform);
    assert.equal(result.errors[0].param, 'pincode');
  }
  const ok = validateParams(ENDPOINTS.search, { ...LOC, q: 'milk', platform: 'DMart', pincode: '560102' });
  assert.equal(ok.ok, true);
});

test('groupsearch trims and dedupes the platforms list', () => {
  const result = validateParams(ENDPOINTS.groupsearch, { ...LOC, q: 'atta', platforms: 'BlinkIt, Zepto,,BlinkIt' });
  assert.equal(result.ok, true);
  assert.equal(result.params.platforms, 'BlinkIt,Zepto');
});

test('groupsearch caps the number of platforms per call', () => {
  const many = Array.from({ length: 19 }, (_, i) => `Shop${String.fromCharCode(65 + i)}`).join(',');
  const result = validateParams(ENDPOINTS.groupsearch, { ...LOC, q: 'atta', platforms: many });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].param, 'platforms');
});

test('groupsearch including Minutes requires a pincode', () => {
  const result = validateParams(ENDPOINTS.groupsearch, { ...LOC, q: 'atta', platforms: 'BlinkIt,Minutes' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].param, 'pincode');
});

test('rejects platform names with unexpected characters', () => {
  const result = validateParams(ENDPOINTS.search, { ...LOC, q: 'x', platform: 'Blink It;drop' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].param, 'platform');
});

test('screenshot endpoints are not exposed at all', () => {
  assert.equal('screenshot' in ENDPOINTS, false);
  assert.equal('screenshotStatus' in ENDPOINTS, false);
});

test('groupsearch parses the optional group flag as a boolean', () => {
  const result = validateParams(ENDPOINTS.groupsearch, { ...LOC, q: 'atta', platforms: 'BlinkIt', group: 'true' });
  assert.equal(result.ok, true);
  assert.equal(result.params.group, true);
  assert.equal(validateParams(ENDPOINTS.groupsearch, { ...LOC, q: 'a', platforms: 'BlinkIt', group: 'yes' }).ok, false);
});

test('estimateCost follows the documented credit table', () => {
  assert.equal(estimateCost(ENDPOINTS.search, { platform: 'BlinkIt' }), 1);
  assert.equal(estimateCost(ENDPOINTS.groupsearch, { platforms: 'BlinkIt,Zepto,Swiggy' }), 3);
  assert.equal(estimateCost(ENDPOINTS.groupeta, { platforms: '' }), 0);
  assert.equal(estimateCost(ENDPOINTS.credits, {}), 0);
  assert.equal(estimateCost(ENDPOINTS.platforms, {}), 0);
});
