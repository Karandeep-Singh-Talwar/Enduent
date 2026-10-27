import { ENDPOINTS, estimateCost } from '../shared/endpoints.js';
import { validateParams } from '../shared/validate.js';
import { CONFIG } from './config.js';
import { createGeocoder } from './geo.js';
import { sendJson } from './http.js';
import { log } from './log.js';
import { listSamples, readSample, saveSample, isSafeSampleName } from './samples.js';
import { callUpstream } from './upstream.js';

/** GET /api/health — tells the UI whether a key is configured (never the key itself). */
export function handleHealth(res) {
  sendJson(res, 200, { ok: true, keyConfigured: Boolean(CONFIG.apiKey), keyProblem: CONFIG.keyProblem, baseUrl: CONFIG.baseUrl });
}

/** Strip the key from any text before it reaches logs or the browser. */
const redact = (text) => (CONFIG.apiKey ? String(text).replaceAll(CONFIG.apiKey, '[redacted]') : String(text));

async function trySave(name, params, upstream) {
  try {
    return await saveSample(CONFIG.samplesDir, {
      endpoint: name,
      params,
      upstreamStatus: upstream.status,
      requestId: upstream.requestId,
      creditsRemaining: upstream.creditsRemaining,
      body: upstream.body,
    });
  } catch (error) {
    log.error('could not save sample', { endpoint: name, message: error.message });
    return null;
  }
}

function upstreamFailure(res, name, def, error) {
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  const code = error?.cause?.code ?? error?.name ?? 'unknown';
  log.error('upstream call failed', { endpoint: name, timedOut, code, message: redact(error?.message) });
  const paid = (def.cost.perCall ?? 0) > 0 || Boolean(def.cost.perPlatform);
  const chargeNote = paid ? ' Credits may already be charged: check your balance before retrying.' : '';
  return timedOut
    ? sendJson(res, 504, { ok: false, error: `API did not answer within ${def.timeoutMs / 1000}s.${chargeNote}` })
    : sendJson(res, 502, { ok: false, error: `Could not reach API (${code}).${chargeNote}` });
}

/**
 * GET /api/:name?... — validate, forward to the real API, save a sample, return a uniform envelope.
 * @param {import('node:http').ServerResponse} res
 * @param {string} name registry key from shared/endpoints.js
 * @param {URLSearchParams} query
 */
export async function handleApi(res, name, query) {
  const def = Object.hasOwn(ENDPOINTS, name) ? ENDPOINTS[name] : null;
  if (!def) return sendJson(res, 404, { ok: false, error: `unknown endpoint "${name}"` });
  if (def.needsKey && !CONFIG.apiKey) {
    const problem = CONFIG.keyProblem ?? 'QCAPI_KEY is not set';
    return sendJson(res, 503, { ok: false, error: `${problem}. Fix .env and restart the server.` });
  }

  const validation = validateParams(def, Object.fromEntries(query));
  if (!validation.ok) return sendJson(res, 400, { ok: false, error: 'invalid parameters', details: validation.errors });

  const { params } = validation;
  let upstream;
  try {
    upstream = await callUpstream(def, params, CONFIG);
  } catch (error) {
    return upstreamFailure(res, name, def, error);
  }

  const success = upstream.status >= 200 && upstream.status < 300;
  const savedAs = success && def.saveSample ? await trySave(name, params, upstream) : null;
  log.info('api call', { endpoint: name, status: upstream.status, ms: upstream.durationMs, credits: upstream.creditsRemaining });

  return sendJson(res, 200, {
    ok: success,
    endpoint: name,
    params,
    estimatedCost: estimateCost(def, params),
    upstream: {
      status: upstream.status,
      requestId: upstream.requestId,
      durationMs: upstream.durationMs,
      creditsRemaining: upstream.creditsRemaining,
      creditsExpiry: upstream.creditsExpiry,
    },
    savedAs,
    body: upstream.body,
  });
}

const geocoder = createGeocoder({ userAgent: CONFIG.geoUserAgent });

function parseCoordinate(raw, limit) {
  const value = Number(raw);
  return raw !== null && raw !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** GET /local/geo/search?q= and /local/geo/reverse?lat=&lon= — free location lookups, no API credits. */
export async function handleGeo(res, kind, query) {
  try {
    if (kind === 'search') {
      const q = (query.get('q') ?? '').trim();
      if (q.length < 2 || q.length > 120) return sendJson(res, 400, { ok: false, error: 'Type a pincode or area name.' });
      return sendJson(res, 200, { ok: true, places: await geocoder.search(q) });
    }
    if (kind === 'reverse') {
      const lat = parseCoordinate(query.get('lat'), 90);
      const lon = parseCoordinate(query.get('lon'), 180);
      if (lat === null || lon === null) return sendJson(res, 400, { ok: false, error: 'invalid coordinates' });
      return sendJson(res, 200, { ok: true, place: await geocoder.reverse(lat, lon) });
    }
    return sendJson(res, 404, { ok: false, error: 'unknown location lookup' });
  } catch (error) {
    log.error('location lookup failed', { kind, message: error?.message });
    return sendJson(res, 502, { ok: false, error: 'Location lookup failed. Try again in a moment, or type the pincode.' });
  }
}

/** GET /local/samples and /local/samples/:file — browse saved responses for free. */
export async function handleSamples(res, fileName) {
  if (!fileName) return sendJson(res, 200, { ok: true, samples: await listSamples(CONFIG.samplesDir) });
  if (!isSafeSampleName(fileName)) return sendJson(res, 400, { ok: false, error: 'bad sample name' });
  try {
    return sendJson(res, 200, { ok: true, sample: await readSample(CONFIG.samplesDir, fileName) });
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { ok: false, error: 'sample not found' });
    throw error;
  }
}
