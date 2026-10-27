// Plans and runs one "Search" press: one groupsearch per query, plus groupeta for platforms
// whose ETA is not cached for this location yet.
import { ENDPOINTS } from '/shared/endpoints.js';
import { resolvePlatformId } from '/shared/platforms.js';
import { validateParams } from '/shared/validate.js';
import { callEndpoint } from './api.js';
import { buildBrandQueries, mergeProductRows, missingEtaPlatforms, parseEtaResults } from './dataset.js';
import { extractRows, platformSummary } from './extract.js';

// Stop the batch on these; retrying the next query would fail the same way (or burn more credits).
const FATAL_STATUSES = new Set([401, 402, 429]);

/**
 * @typedef {{ endpoint: string, params: Record<string, string>, label: string }} PlannedCall
 * @typedef {{ mode: 'products' | 'brand', text: string, queries: string[], platforms: string[], searchCalls: PlannedCall[],
 *             etaCall: PlannedCall | null, searchCost: number, etaCost: number, cost: number, errors: string[] }} SearchPlan
 */

/**
 * @param {{ mode: 'products' | 'brand', text: string, keywords: string, platforms: string[],
 *           location: null | { lat: number, lon: number, pincode: string | null },
 *           etaCache: Record<string, object>, etaCapable: string[] }} input
 * @returns {SearchPlan}
 */
export function planSearch({ mode, text, keywords, platforms, location, etaCache, etaCapable }) {
  const queries = mode === 'brand' ? buildBrandQueries(text, keywords) : [text.trim()].filter(Boolean);
  const base = location ? { lat: String(location.lat), lon: String(location.lon), pincode: location.pincode ?? '' } : {};
  const searchCalls = queries.map((q) => ({ endpoint: 'groupsearch', label: `“${q}”`, params: { ...base, q, platforms: platforms.join(',') } }));
  const etaPlatforms = missingEtaPlatforms(platforms, etaCache, etaCapable);
  const etaCall = etaPlatforms.length > 0
    ? { endpoint: 'groupeta', label: 'delivery ETA', params: { ...base, platforms: etaPlatforms.join(',') } }
    : null;

  const errors = [
    ...(location ? [] : ['Set a delivery location first: use your location or type a pincode / area.']),
    ...(queries.length ? [] : [mode === 'brand' ? 'Type a brand name.' : 'Type what to search for.']),
    ...(platforms.length ? [] : ['Pick at least one platform.']),
  ];
  const callErrors = errors.length ? [] : [...searchCalls, ...(etaCall ? [etaCall] : [])]
    .flatMap((call) => {
      const result = validateParams(ENDPOINTS[call.endpoint], call.params);
      return result.ok ? [] : result.errors.map((e) => `${e.param}: ${e.message}`);
    });

  const searchCost = queries.length * platforms.length;
  return {
    mode, text: text.trim(), queries, platforms, searchCalls, etaCall,
    searchCost, etaCost: etaPlatforms.length, cost: searchCost + etaPlatforms.length,
    errors: [...new Set([...errors, ...callErrors])],
  };
}

function platformErrors(body) {
  return Object.fromEntries(platformSummary(body).filter((s) => s.error)
    .map((s) => [resolvePlatformId(s.platform) ?? s.platform, s.error]));
}

/** Product rows from one response, each keeping its original API record as `raw`. */
function rowsWithRaw(body) {
  const { kind, rows, raws } = extractRows(body);
  return kind === 'products' ? rows.map((row, i) => ({ ...row, raw: raws[i] })) : [];
}

/**
 * Execute a plan. Calls run one after another (friendly to the 100 req/min limit).
 * @param {SearchPlan} plan
 * @param {(done: number, total: number, label: string) => void} onProgress
 */
export async function runSearch(plan, onProgress = () => {}) {
  const calls = [...plan.searchCalls, ...(plan.etaCall ? [plan.etaCall] : [])];
  const responses = [];
  for (const [index, call] of calls.entries()) {
    onProgress(index, calls.length, call.label);
    const response = await callEndpoint(call.endpoint, call.params);
    responses.push({ call, response });
    if (!response.ok && (!response.upstream || FATAL_STATUSES.has(response.upstream.status))) break;
  }

  const searchResponses = responses.filter((r) => r.call.endpoint === 'groupsearch');
  const etaResponse = responses.find((r) => r.call.endpoint === 'groupeta');
  const failures = responses.filter((r) => !r.response.ok)
    .map((r) => `${r.call.label}: ${r.response.error ?? `HTTP ${r.response.upstream?.status}`}`);
  const credits = responses.map((r) => r.response.upstream?.creditsRemaining).filter(Boolean).pop() ?? null;

  return {
    rows: mergeProductRows(searchResponses.filter((r) => r.response.ok).map((r) => rowsWithRaw(r.response.body))),
    platformErrors: Object.assign({}, ...searchResponses.filter((r) => r.response.ok).map((r) => platformErrors(r.response.body))),
    eta: etaResponse?.response.ok ? parseEtaResults(etaResponse.response.body) : {},
    failures,
    skipped: calls.length - responses.length,
    creditsRemaining: credits,
    responses,
  };
}

/** Rebuild a view from one saved response (History). Costs nothing. */
export function runFromSample(sample) {
  const ok = sample.upstreamStatus >= 200 && sample.upstreamStatus < 300;
  const platforms = String(sample.params?.platforms ?? sample.params?.platform ?? '').split(',').filter(Boolean);
  return {
    rows: ok ? rowsWithRaw(sample.body) : [],
    platformErrors: ok ? platformErrors(sample.body) : {},
    eta: ok && ['eta', 'groupeta'].includes(sample.endpoint) ? parseEtaResults(sample.body) : {},
    failures: ok ? [] : [`Saved response had HTTP ${sample.upstreamStatus}`],
    skipped: 0,
    creditsRemaining: null,
    platforms,
    responses: [{ call: { endpoint: sample.endpoint, label: 'saved', params: sample.params }, response: { ok, body: sample.body } }],
  };
}
