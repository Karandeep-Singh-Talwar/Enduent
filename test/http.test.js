import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendStatic } from '../server/http.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function fakeResponse() {
  const res = { status: null, headers: null, body: null };
  return {
    res,
    writeHead: (status, headers) => { res.status = status; res.headers = headers; },
    end: (body) => { res.body = body; },
  };
}

async function serve(relPath) {
  const fake = fakeResponse();
  await sendStatic(fake, PUBLIC_DIR, relPath);
  return fake.res;
}

test('serves a real file with its content type and security headers', async () => {
  const res = await serve('index.html');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.headers['Content-Security-Policy'], /script-src 'self'/);
});

test('refuses every traversal / Windows path trick', async () => {
  const payloads = [
    '../.env', '..%2F.env', '%2e%2e/.env', '%2e%2e%2f.env', '..\\.env', '%5c..%5c.env', '..%5c.env',
    'C:/Windows/win.ini', 'C:%5CWindows%5Cwin.ini', '//server/share/x', '\\\\server\\share\\x',
    '../server/config.js', 'index.html%00.js', '', '.', '..',
  ];
  for (const payload of payloads) {
    const res = await serve(payload);
    assert.notEqual(res.status, 200, `served ${payload}`);
  }
});
