import { ENDPOINTS } from '/shared/endpoints.js';
import { FALLBACK_LISTS, platformLabel, resolvePlatformId } from '/shared/platforms.js';
import { validateParams } from '/shared/validate.js';
import { callEndpoint, getHealth, getSample, listSamples } from './api.js';
import { locationKey } from './dataset.js';
import { clearEta, loadEta, saveEta } from './eta-cache.js';
import { getLocation, initLocation } from './location.js';
import { getSelectedPlatforms, initPlatformPicker, renderPlatforms } from './platform-picker.js';
import { rowKey } from './product-table.js';
import { el, pill } from './render.js';
import { initResults, setItemDetails, showRun } from './results.js';
import { planSearch, runFromSample, runSearch } from './search.js';
import { shouldConfirmSpend } from './spend-guard.js';

const $ = (id) => document.getElementById(id);

let app = { credits: null, etaCapable: [...FALLBACK_LISTS.eta] };
const setApp = (patch) => { app = { ...app, ...patch }; };

let toastTimer = null;
function toast(message, isError = false) {
  const box = $('toast');
  box.textContent = message;
  box.className = `toast${isError ? ' error' : ''}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 7000 : 3500);
}

function setCredits(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return;
  setApp({ credits: n });
  $('credits-value').textContent = n.toLocaleString('en-IN');
}

async function refreshCredits({ announce = false } = {}) {
  const res = await callEndpoint('credits', {});
  if (res.ok) setCredits((res.body?.data ?? res.body)?.summary?.total_available ?? res.upstream?.creditsRemaining);
  if (announce) toast(res.ok ? 'Credit balance updated' : res.error ?? 'Could not read credits', !res.ok);
}

const etaCacheFor = (loc) => (loc ? loadEta(locationKey(loc)) : {});
const searchMode = () => document.querySelector('input[name="mode"]:checked')?.value ?? 'products';
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const searches = (n) => plural(n, 'search', 'searches');

function currentPlan() {
  const form = $('search-form');
  return planSearch({
    mode: searchMode(), text: form.elements.namedItem('q').value, keywords: form.elements.namedItem('keywords').value,
    platforms: getSelectedPlatforms(), location: getLocation(), etaCache: etaCacheFor(getLocation()), etaCapable: app.etaCapable,
  });
}

function costText(plan) {
  if (plan.searchCost === 0) return '';
  const search = `${searches(plan.queries.length)} × ${plural(plan.platforms.length, 'platform')} = ${plan.searchCost}`;
  const eta = plan.etaCost ? ` + ${plan.etaCost} for delivery ETA (first time at this location)` : ' · ETA already cached here';
  return `Costs ${plural(plan.cost, 'credit')}: ${search}${eta}`;
}

function renderPlan({ showErrors = false } = {}) {
  const plan = currentPlan();
  const brand = plan.mode === 'brand';
  $('keywords-row').hidden = !brand;
  $('search-input').placeholder = brand ? 'Competitor brand, e.g. Milky Mist' : 'Search products, e.g. amul butter';
  $('search-btn').textContent = brand ? 'Find brand products' : 'Search';
  $('cost-line').textContent = costText(plan);
  $('cost-line').className = `cost${plan.cost >= 15 ? ' pricey' : ''}`;
  $('search-errors').replaceChildren(...(showErrors ? plan.errors : []).map((e) => el('li', { text: e })));
  return plan;
}

function confirmSpend(text) {
  const dialog = $('confirm-dialog');
  const balance = app.credits === null ? '' : ` You have ${app.credits.toLocaleString('en-IN')} left.`;
  $('confirm-text').textContent = `${text}${balance}`;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

function setBusy(text) {
  const button = $('search-btn');
  button.disabled = Boolean(text);
  if (text) button.textContent = text;
  else renderPlan();
}

async function onSearch(event) {
  event.preventDefault();
  const plan = renderPlan({ showErrors: true });
  if (plan.errors.length > 0) return;
  if (shouldConfirmSpend(plan.cost, app.credits) && !(await confirmSpend(`${costText(plan)}.`))) return;

  setBusy('Searching…');
  const run = await runSearch(plan, (done, total, label) => setBusy(`Searching ${done + 1}/${total}: ${label}…`));
  setBusy(null);

  const loc = getLocation();
  const etaCache = Object.keys(run.eta).length ? saveEta(locationKey(loc), run.eta) : etaCacheFor(loc);
  setCredits(run.creditsRemaining);
  if (run.failures.length) {
    toast(run.failures[0], true);
    if (run.responses.some((r) => !r.response.upstream)) refreshCredits();
  }
  const title = `${plan.mode === 'brand' ? 'Brand catalog' : 'Search'}: “${plan.text}” · ${loc.label}`;
  const meta = [
    pill(searches(plan.queries.length)), pill(plural(run.rows.length, 'product')),
    ...(run.creditsRemaining ? [pill(`${run.creditsRemaining} credits left`)] : []),
    ...(run.failures.length ? [pill(plural(run.failures.length, 'error'), 'bad')] : []),
  ];
  showRun({ title, platforms: plan.platforms, run, etaCache, queries: plan.queries, brandQuery: plan.mode === 'brand' ? plan.text : '', meta });
  renderPlan();
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function onItemDetails(row) {
  const loc = getLocation();
  const platform = resolvePlatformId(row.platform) ?? row.platform;
  const params = { item_id: row.id, platform, lat: String(loc?.lat ?? ''), lon: String(loc?.lon ?? ''), pincode: loc?.pincode ?? '' };
  const check = validateParams(ENDPOINTS.item, params);
  if (!check.ok) return toast(check.errors.map((e) => `${e.param}: ${e.message}`).join('; '), true);
  if (shouldConfirmSpend(1, app.credits) && !(await confirmSpend(`Full item details for “${row.name}” on ${platformLabel(platform)} costs 1 credit.`))) return;
  const key = rowKey(row);
  setItemDetails(key, { loading: true });
  const res = await callEndpoint('item', check.params);
  setCredits(res.upstream?.creditsRemaining);
  setItemDetails(key, res.ok ? { body: res.body } : { error: res.error ?? `API returned HTTP ${res.upstream?.status}` });
}

async function openHistory() {
  const dialog = $('history-dialog');
  const list = $('saved-list');
  list.replaceChildren(el('li', { class: 'muted', text: 'Loading…' }));
  dialog.showModal();
  const res = await listSamples();
  if (!res.ok) return list.replaceChildren(el('li', { class: 'muted', text: res.error }));
  if (res.samples.length === 0) return list.replaceChildren(el('li', { class: 'muted', text: 'Nothing saved yet.' }));
  return list.replaceChildren(...res.samples.map((s) => el('li', {},
    el('button', { type: 'button', onclick: () => openSample(s.name), text: s.name }),
    el('span', { class: 'muted', text: `${(s.size / 1024).toFixed(1)} KB` }))));
}

async function openSample(name) {
  const res = await getSample(name);
  $('history-dialog').close();
  if (!res.ok) return toast(res.error ?? 'Could not open saved response', true);
  const run = runFromSample(res.sample);
  const subject = res.sample.params?.q ? `“${res.sample.params.q}”` : res.sample.endpoint;
  return showRun({
    title: `Saved: ${subject}`, platforms: run.platforms, run, etaCache: run.eta,
    queries: res.sample.params?.q ? [res.sample.params.q] : [], meta: [pill('Saved copy · no credits used', 'ok')],
  });
}

async function loadPlatforms() {
  const res = await callEndpoint('platforms', {});
  const live = res.ok ? (res.body?.data ?? res.body) : null;
  const pick = (key) => (Array.isArray(live?.[key]) && live[key].length > 0 ? live[key] : FALLBACK_LISTS[key]);
  setApp({ etaCapable: pick('eta') });
  renderPlatforms(pick('search'));
  renderPlan();
}

async function checkKey() {
  const health = await getHealth();
  const ready = health.ok && health.keyConfigured;
  const missing = health.keyProblem ?? 'No API key: add it to .env and restart';
  $('key-status').textContent = ready ? 'API key loaded' : (health.ok ? missing : 'Server offline');
  $('key-status').className = `pill ${ready ? 'ok' : 'bad'}`;
  if (ready) refreshCredits();
}

function bindEvents() {
  const form = $('search-form');
  form.addEventListener('submit', onSearch);
  form.addEventListener('input', () => renderPlan());
  form.addEventListener('change', () => renderPlan());
  $('credits-btn').addEventListener('click', () => refreshCredits({ announce: true }));
  $('history-btn').addEventListener('click', openHistory);
  $('eta-refresh').addEventListener('click', () => {
    const loc = getLocation();
    if (!loc) return toast('Set a location first.', true);
    clearEta(locationKey(loc));
    renderPlan();
    return toast('Delivery ETA will be re-fetched on your next search here.');
  });
}

function init() {
  initLocation(() => renderPlan());
  initPlatformPicker(() => renderPlan());
  initResults({ toast, onDetails: onItemDetails });
  renderPlatforms(FALLBACK_LISTS.search);
  bindEvents();
  renderPlan();
  checkKey();
  loadPlatforms();
}

init();
