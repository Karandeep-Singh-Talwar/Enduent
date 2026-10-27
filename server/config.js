import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(ROOT, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const PLACEHOLDER_KEYS = new Set(['', 'your_api_key_here', 'changeme']);
// Printable ASCII without spaces. Anything else would make fetch throw an error that quotes the key.
const KEY_FORMAT = /^[\x21-\x7e]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function readKey() {
  const raw = (process.env.QCAPI_KEY ?? '').trim();
  if (PLACEHOLDER_KEYS.has(raw)) return { apiKey: '', keyProblem: null };
  if (!KEY_FORMAT.test(raw)) return { apiKey: '', keyProblem: 'QCAPI_KEY in .env contains spaces, quotes or line breaks' };
  return { apiKey: raw, keyProblem: null };
}

function readBaseUrl() {
  const raw = process.env.QCAPI_BASE_URL ?? 'https://api.quickcommerceapi.com';
  const url = new URL(raw);
  // The key travels in a header, so never send it over plain http to a remote host.
  if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) {
    throw new Error(`QCAPI_BASE_URL must use https (got ${url.protocol}//${url.hostname})`);
  }
  return url.origin;
}

export const CONFIG = Object.freeze({
  ...readKey(),
  baseUrl: readBaseUrl(),
  // Nominatim requires an identifying User-Agent.
  geoUserAgent: 'qc-api-explorer/0.2 (local developer tool)',
  // Bind to loopback only: this server holds the key and spends credits.
  host: '127.0.0.1',
  port: Number(process.env.PORT) || 8787,
  publicDir: path.join(ROOT, 'public'),
  sharedDir: path.join(ROOT, 'shared'),
  samplesDir: path.join(ROOT, 'samples'),
});
