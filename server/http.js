import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https: http: data:",
    "media-src 'self' https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
});

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/**
 * Serve a file from rootDir, refusing anything that resolves outside it.
 * @param {import('node:http').ServerResponse} res
 * @param {string} rootDir
 * @param {string} relPath URL path relative to rootDir (still URL-encoded)
 */
export async function sendStatic(res, rootDir, relPath) {
  let target;
  try {
    target = path.resolve(rootDir, `.${path.posix.normalize(`/${decodeURIComponent(relPath)}`)}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad path' });
  }
  if (!target.startsWith(rootDir + path.sep)) return sendJson(res, 404, { ok: false, error: 'not found' });

  try {
    const data = await readFile(target);
    const type = CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    sendJson(res, 404, { ok: false, error: 'not found' });
  }
}
