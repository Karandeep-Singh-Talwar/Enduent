import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformCurrency, platformLabel, resolvePlatformId } from '../shared/platforms.js';

test('resolvePlatformId maps display names and odd casing back to API ids', () => {
  assert.equal(resolvePlatformId('BlinkIt'), 'BlinkIt');
  assert.equal(resolvePlatformId('blinkit'), 'BlinkIt');
  assert.equal(resolvePlatformId('Swiggy Instamart'), 'Swiggy');
  assert.equal(resolvePlatformId('Flipkart Minutes'), 'Minutes');
  assert.equal(resolvePlatformId('Noon Minutes'), 'NoonMinutes');
  assert.equal(resolvePlatformId('talabat mart'), 'TalabatMart');
  assert.equal(resolvePlatformId('Flipkart'), 'Flipkart');
  assert.equal(resolvePlatformId(''), null);
  assert.equal(resolvePlatformId('Unknown Shop'), null);
});

test('platformCurrency is AED only for UAE platforms', () => {
  assert.equal(platformCurrency('NoonMinutes'), 'AED');
  assert.equal(platformCurrency('talabat mart'), 'AED');
  assert.equal(platformCurrency('Zepto'), 'INR');
});

test('platformLabel falls back to the raw id', () => {
  assert.equal(platformLabel('Swiggy'), 'Swiggy Instamart');
  assert.equal(platformLabel('NewShop'), 'NewShop');
});
