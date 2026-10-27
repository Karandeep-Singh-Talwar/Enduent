// Every successful paid response is saved to samples/ so it can be re-inspected without spending credits.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_NAME = /^[\w.+-]+\.json$/;

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isSafeSampleName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name) && !name.includes('..') && !name.startsWith('.');
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * @param {string} endpoint
 * @param {Record<string, unknown>} params
 * @param {Date} [now]
 * @returns {string}
 */
export function buildSampleName(endpoint, params, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = String(params.platform ?? params.platforms ?? '').split(',').join('+').replace(/[^\w+]/g, '');
  const subject = params.q ?? params.item_id ?? params.job_id;
  const parts = [stamp, endpoint, target, subject === undefined ? '' : slug(subject)].filter(Boolean);
  return `${parts.join('_')}.json`;
}

/**
 * @param {string} dir
 * @param {{ endpoint: string, params: Record<string, unknown> } & Record<string, unknown>} record
 * @returns {Promise<string>} saved file name
 */
export async function saveSample(dir, record) {
  await mkdir(dir, { recursive: true });
  const name = buildSampleName(record.endpoint, record.params);
  await writeFile(path.join(dir, name), JSON.stringify({ savedAt: new Date().toISOString(), ...record }, null, 2));
  return name;
}

/**
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, size: number }>>} newest first
 */
export async function listSamples(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const safe = names.filter(isSafeSampleName).sort().reverse();
  return Promise.all(safe.map(async (name) => ({ name, size: (await stat(path.join(dir, name))).size })));
}

/**
 * @param {string} dir
 * @param {string} name must pass isSafeSampleName
 * @returns {Promise<unknown>}
 */
export async function readSample(dir, name) {
  if (!isSafeSampleName(name)) throw new Error('unsafe sample name');
  return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
}
