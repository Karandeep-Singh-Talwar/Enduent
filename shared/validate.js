// Request validation shared by the server (authoritative) and the browser (fast feedback).
import { PINCODE_REQUIRED, splitPlatforms } from './endpoints.js';

const PLATFORM_NAME = /^[A-Za-z]{2,30}$/;
const PINCODE = /^\d{6}$/;
const MAX_PLATFORMS = 18;

/** @typedef {{ param: string, message: string }} ValidationError */
/** @typedef {{ ok: true, params: Record<string, unknown> } | { ok: false, errors: ValidationError[] }} ValidationResult */

const fail = (message) => ({ error: message });
const pass = (value) => ({ value });

function parseNumber(raw, min, max, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    return fail(`${label} must be a number between ${min} and ${max}`);
  }
  return pass(value);
}

function parsePlatforms(raw) {
  const names = splitPlatforms(raw);
  if (names.length === 0) return fail('pick at least one platform');
  if (names.length > MAX_PLATFORMS) return fail(`at most ${MAX_PLATFORMS} platforms per call`);
  const bad = names.find((n) => !PLATFORM_NAME.test(n));
  return bad ? fail(`invalid platform name "${bad}"`) : pass(names.join(','));
}

/**
 * Parse one raw string according to its spec.
 * @param {string} raw
 * @param {import('./endpoints.js').ParamSpec} spec
 * @returns {{ value?: unknown, error?: string }}
 */
function parseValue(raw, spec) {
  switch (spec.type) {
    case 'string':
      return raw.length > (spec.maxLength ?? 200) ? fail(`max ${spec.maxLength} characters`) : pass(raw);
    case 'lat': return parseNumber(raw, -90, 90, 'latitude');
    case 'lon': return parseNumber(raw, -180, 180, 'longitude');
    case 'platform': return PLATFORM_NAME.test(raw) ? pass(raw) : fail('invalid platform name');
    case 'platforms': return parsePlatforms(raw);
    case 'pincode': return PINCODE.test(raw) ? pass(raw) : fail('pincode must be 6 digits');
    case 'boolean': return ['true', 'false'].includes(raw) ? pass(raw === 'true') : fail('must be true or false');
    default: return fail(`unknown param type ${spec.type}`);
  }
}

/** Rules that span more than one param. */
function crossFieldErrors(def, params) {
  const chosen = params.platform ? [params.platform] : splitPlatforms(params.platforms);
  const needsPin = chosen.filter((p) => PINCODE_REQUIRED.includes(p));
  if (needsPin.length > 0 && !params.pincode && 'pincode' in def.params) {
    return [{ param: 'pincode', message: `${needsPin.join(', ')} need a pincode` }];
  }
  return [];
}

/**
 * Validate raw query values against an endpoint definition.
 * Unknown params are dropped; empty strings count as "not provided".
 * @param {import('./endpoints.js').EndpointDef} def
 * @param {Record<string, unknown>} raw
 * @returns {ValidationResult}
 */
export function validateParams(def, raw) {
  const params = {};
  const errors = [];
  for (const [name, spec] of Object.entries(def.params)) {
    const value = typeof raw[name] === 'string' ? raw[name].trim() : '';
    if (value === '') {
      if (spec.required) errors.push({ param: name, message: 'is required' });
      continue;
    }
    const parsed = parseValue(value, spec);
    if (parsed.error) errors.push({ param: name, message: parsed.error });
    else params[name] = parsed.value;
  }
  const allErrors = errors.length > 0 ? errors : crossFieldErrors(def, params);
  return allErrors.length > 0 ? { ok: false, errors: allErrors } : { ok: true, params };
}
