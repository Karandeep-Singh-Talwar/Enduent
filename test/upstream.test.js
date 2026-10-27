import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { callUpstream } from '../server/upstream.js';

/** Start a throwaway HTTP server on a random loopback port. */
async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close };
}

const def = (overrides = {}) => ({ path: '/v1/search', needsKey: true, timeoutMs: 2000, ...overrides });

test('sends key + pincode (header and query) and reads credit headers', async () => {
  let seen = null;
  const api = await startServer((req, res) => {
    seen = { url: req.url, key: req.headers['x-api-key'], pin: req.headers['x-geolocation-pincode'] };
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'abc', 'X-Credits-Remaining': '42' });
    res.end(JSON.stringify({ status: 'success', data: { products: [] } }));
  });
  try {
    const result = await callUpstream(def(), { q: 'milk', platform: 'DMart', pincode: '560102' }, { apiKey: 'K123', baseUrl: api.origin });
    assert.equal(result.status, 200);
    assert.equal(result.requestId, 'abc');
    assert.equal(result.creditsRemaining, '42');
    assert.deepEqual(result.body, { status: 'success', data: { products: [] } });
    assert.equal(seen.key, 'K123');
    assert.equal(seen.pin, '560102');
    assert.match(seen.url, /pincode=560102/);
  } finally {
    await api.close();
  }
});

test('never follows a redirect, so the key cannot leak to another origin', async () => {
  let leaked = false;
  const attacker = await startServer((req, res) => { leaked = Boolean(req.headers['x-api-key']); res.end('{}'); });
  const api = await startServer((req, res) => { res.writeHead(302, { Location: `${attacker.origin}/steal` }); res.end(); });
  try {
    await assert.rejects(() => callUpstream(def(), { q: 'x' }, { apiKey: 'SECRET', baseUrl: api.origin }));
    assert.equal(leaked, false);
  } finally {
    await api.close();
    await attacker.close();
  }
});

test('times out with a TimeoutError when the API hangs', async () => {
  const api = await startServer(() => { /* never answers */ });
  try {
    await assert.rejects(
      () => callUpstream(def({ timeoutMs: 150 }), { q: 'x' }, { apiKey: 'K', baseUrl: api.origin }),
      (error) => error.name === 'TimeoutError',
    );
  } finally {
    await api.close();
  }
});

test('free endpoints do not send the key; non-JSON bodies are wrapped', async () => {
  let key = 'unset';
  const api = await startServer((req, res) => { key = req.headers['x-api-key']; res.writeHead(502); res.end('Bad gateway'); });
  try {
    const result = await callUpstream(def({ needsKey: false, path: '/v1/supported-platforms' }), {}, { apiKey: 'K', baseUrl: api.origin });
    assert.equal(key, undefined);
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { non_json_body: 'Bad gateway' });
  } finally {
    await api.close();
  }
});
