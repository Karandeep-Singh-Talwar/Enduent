// Thin client for api.quickcommerceapi.com. Adds the key server-side so it never reaches the browser.

/**
 * @typedef {{ status: number, durationMs: number, requestId: string | null,
 *             creditsRemaining: string | null, creditsExpiry: string | null, body: unknown }} UpstreamResult
 */

function parseBody(text) {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return { non_json_body: text.slice(0, 2000) };
  }
}

function buildHeaders(def, params, apiKey) {
  return {
    Accept: 'application/json',
    'User-Agent': 'qc-api-explorer/0.1',
    ...(def.needsKey ? { 'X-API-Key': apiKey } : {}),
    // Docs disagree on query param vs header for pincode, so send both.
    ...(params.pincode ? { 'x-geolocation-pincode': String(params.pincode) } : {}),
  };
}

/**
 * Call one documented endpoint with already-validated params.
 * Throws on network failure or timeout (AbortSignal "TimeoutError").
 * @param {import('../shared/endpoints.js').EndpointDef} def
 * @param {Record<string, unknown>} params
 * @param {{ apiKey: string, baseUrl: string }} options
 * @returns {Promise<UpstreamResult>}
 */
export async function callUpstream(def, params, { apiKey, baseUrl }) {
  const url = new URL(def.path, baseUrl);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

  const started = Date.now();
  const response = await fetch(url, {
    headers: buildHeaders(def, params, apiKey),
    // fetch strips only Authorization on cross-origin redirects; X-API-Key would follow a 302 anywhere.
    redirect: 'error',
    signal: AbortSignal.timeout(def.timeoutMs),
  });
  const text = await response.text();

  return {
    status: response.status,
    durationMs: Date.now() - started,
    requestId: response.headers.get('x-request-id'),
    creditsRemaining: response.headers.get('x-credits-remaining'),
    creditsExpiry: response.headers.get('x-credits-expiry'),
    body: parseBody(text),
  };
}
