import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSampleName, isSafeSampleName, listSamples, readSample, saveSample } from '../server/samples.js';

test('saveSample → listSamples → readSample round trip', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'qcx-'));
  try {
    const name = await saveSample(path.join(dir, 'nested'), { endpoint: 'search', params: { platform: 'Zepto', q: 'milk' }, body: { ok: 1 } });
    const listed = await listSamples(path.join(dir, 'nested'));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, name);
    const record = await readSample(path.join(dir, 'nested'), name);
    assert.deepEqual(record.body, { ok: 1 });
    assert.equal(typeof record.savedAt, 'string');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listSamples returns [] for a missing folder; readSample refuses unsafe names', async () => {
  assert.deepEqual(await listSamples(path.join(tmpdir(), 'qcx-does-not-exist-123')), []);
  await assert.rejects(() => readSample(tmpdir(), '../.env'), /unsafe/);
});

test('buildSampleName is filesystem-safe and descriptive', () => {
  const name = buildSampleName('search', { platform: 'BlinkIt', q: 'amul butter 500g' }, new Date('2026-10-27T10:20:30.456Z'));
  assert.equal(name, '2026-10-27T10-20-30-456Z_search_BlinkIt_amul-butter-500g.json');
  assert.equal(isSafeSampleName(name), true);
});

test('buildSampleName handles multi-platform calls without a query', () => {
  const name = buildSampleName('groupeta', { platforms: 'BlinkIt,Zepto' }, new Date('2026-10-27T00:00:00.000Z'));
  assert.equal(name, '2026-10-27T00-00-00-000Z_groupeta_BlinkIt+Zepto.json');
});

test('isSafeSampleName rejects traversal and non-json names', () => {
  for (const bad of ['../.env', '..\\x.json', 'a/b.json', '.env', 'x.txt', '', '..json']) {
    assert.equal(isSafeSampleName(bad), false, bad);
  }
});
