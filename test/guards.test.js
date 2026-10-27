import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHost, rejectReason, safeDecode } from '../server/guards.js';

test('isLocalHost accepts loopback names with or without port', () => {
  for (const host of ['localhost', 'localhost:8787', '127.0.0.1:8787', '[::1]:8787', 'LOCALHOST:8787']) {
    assert.equal(isLocalHost(host), true, host);
  }
});

test('isLocalHost rejects rebinding and lookalike hosts', () => {
  for (const host of ['evil.com', 'evil.com:8787', '127.0.0.1.evil.com', 'localhost.evil.com', '[::2]:8787', '', undefined]) {
    assert.equal(isLocalHost(host), false, String(host));
  }
});

const base = { method: 'GET', host: '127.0.0.1:8787', pathname: '/api/search', explorerHeader: '1' };

test('rejectReason lets a well-formed local data request through', () => {
  assert.equal(rejectReason(base), null);
});

test('rejectReason blocks foreign hosts, non-GET and missing X-Explorer', () => {
  assert.equal(rejectReason({ ...base, host: 'evil.com' }).status, 421);
  assert.equal(rejectReason({ ...base, method: 'POST' }).status, 405);
  assert.equal(rejectReason({ ...base, explorerHeader: undefined }).status, 403);
  assert.equal(rejectReason({ ...base, pathname: '/local/samples', explorerHeader: '0' }).status, 403);
});

test('rejectReason does not require X-Explorer for static files', () => {
  assert.equal(rejectReason({ ...base, pathname: '/app.js', explorerHeader: undefined }), null);
});

test('safeDecode returns null on malformed percent-encoding', () => {
  assert.equal(safeDecode('a%20b.json'), 'a b.json');
  assert.equal(safeDecode('%E0%A4%A'), null);
});
