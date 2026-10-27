// Browser → local server. The X-Explorer header is required by the server (cross-site request guard).

const HEADERS = Object.freeze({ 'X-Explorer': '1', Accept: 'application/json' });

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: HEADERS });
  } catch {
    return { ok: false, error: 'Local server not reachable. Is `npm start` still running?' };
  }
  try {
    return await response.json();
  } catch {
    return { ok: false, error: `Unexpected non-JSON response (HTTP ${response.status})` };
  }
}

const toQuery = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));

/**
 * @param {string} endpoint registry key from shared/endpoints.js
 * @param {Record<string, unknown>} params
 */
export const callEndpoint = (endpoint, params) => getJson(`/api/${encodeURIComponent(endpoint)}?${toQuery(params)}`);
export const getHealth = () => getJson('/api/health');
export const geoSearch = (q) => getJson(`/local/geo/search?${toQuery({ q })}`);
export const geoReverse = (lat, lon) => getJson(`/local/geo/reverse?${toQuery({ lat, lon })}`);
export const listSamples = () => getJson('/local/samples');
export const getSample = (name) => getJson(`/local/samples/${encodeURIComponent(name)}`);
