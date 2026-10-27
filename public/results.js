// Single results view: platform strip → brand chips → side-by-side brands → product table → coverage / raw.
import { resolvePlatformId } from '/shared/platforms.js';
import {
  attachEta, brandCounts, brandMatrix, brandsMatching, filterByBrands, filterRelevant, platformStatus,
} from './dataset.js';
import { fieldInventory, PRODUCT_COLUMNS, toCsv } from './extract.js';
import { productTable } from './product-table.js';
import { brandBar, brandMatrixTable, el, emptyView, fieldsTable, jsonView, platformStrip } from './render.js';

const $ = (id) => document.getElementById(id);
const MY_BRAND_KEY = 'qcx.myBrand';
const RELEVANT_KEY = 'qcx.relevantOnly';

let handlers = { onDetails: () => {}, toast: () => {} };
let view = null;

const setView = (patch) => { view = { ...view, ...patch }; };

function readMyBrand() {
  try { return localStorage.getItem(MY_BRAND_KEY) ?? ''; } catch { return ''; }
}

/** The exact brand name in these results that the user's "My brand" text refers to. */
function resolveMyBrand(counts, typed) {
  if (!typed.trim()) return '';
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = counts.find((c) => squash(c.brand) === squash(typed));
  return exact?.brand ?? brandsMatching(counts, typed)[0] ?? '';
}

function sortRows(rows, { key, dir }) {
  if (!key) return rows;
  const missing = (v) => (v === null || v === undefined || v === '' ? 1 : 0);
  return [...rows].sort((a, b) => {
    const nulls = missing(a[key]) - missing(b[key]);
    if (nulls !== 0) return nulls;
    const cmp = typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]));
    return cmp * dir;
  });
}

function textFilter(rows, text) {
  const needle = text.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => ['name', 'brand', 'platform', 'id', 'quantity'].some((k) => String(r[k] ?? '').toLowerCase().includes(needle)));
}

function readRelevantOnly() {
  try { return localStorage.getItem(RELEVANT_KEY) !== 'false'; } catch { return true; }
}

/** Rows after the "Relevant only" toggle: everything below (brands, matrix, table, CSV) builds on these. */
const baseRows = () => (view.relevantOnly ? filterRelevant(view.rows, view.queries) : { rows: view.rows, hidden: 0 });

const visibleRows = () => sortRows(textFilter(filterByBrands(baseRows().rows, new Set(view.selected)), view.filter), view.sort);

function renderStrip() {
  const kept = baseRows().rows;
  const statuses = platformStatus(view.platforms, view.rows, view.run.platformErrors, view.etaCache).map((s) => ({
    ...s,
    hidden: s.count - kept.filter((r) => (resolvePlatformId(r.platform) ?? r.platform) === s.platform).length,
  }));
  $('platform-strip').replaceChildren(...platformStrip(statuses));
}

function renderBrands() {
  const counts = brandCounts(baseRows().rows);
  const myBrand = resolveMyBrand(counts, $('my-brand').value);
  const toggle = (brand) => {
    const selected = view.selected.includes(brand) ? view.selected.filter((b) => b !== brand) : [...view.selected, brand];
    setView({ selected });
    renderBrands();
    renderTable();
  };
  $('brand-bar').replaceChildren(...brandBar(counts, view.selected, myBrand, toggle));

  const compared = [...new Set([myBrand, ...view.selected].filter(Boolean))];
  const { platforms } = view;
  $('brand-matrix').replaceChildren(compared.length >= 2
    ? el('div', {}, el('h3', { text: 'Side by side' }), el('div', { class: 'view' },
      brandMatrixTable(brandMatrix(baseRows().rows, compared, platforms), compared, platforms, myBrand)))
    : el('p', { class: 'muted', text: 'Tip: pick 2+ brands (or set My brand and pick a competitor) to compare them side by side.' }));
}

function renderTable() {
  const rows = visibleRows();
  const { hidden } = baseRows();
  $('row-count').textContent = `${rows.length} of ${view.rows.length} products`;
  $('hidden-count').textContent = hidden > 0 ? `${hidden} unrelated hidden` : '';
  const onSort = (key) => {
    setView({ sort: { key, dir: view.sort.key === key ? -view.sort.dir : 1 } });
    renderTable();
  };
  const onToggle = (key) => {
    setView({ expanded: view.expanded.includes(key) ? view.expanded.filter((k) => k !== key) : [...view.expanded, key] });
    renderTable();
  };
  $('result-view').replaceChildren(view.rows.length === 0
    ? emptyView('No products found. See platform notes above, or the raw responses below.')
    : productTable(rows, { sort: view.sort, onSort, expanded: view.expanded, onToggle, details: view.details, onDetails: handlers.onDetails }));
}

function renderExtras() {
  const raws = view.rows.map((r) => r.raw).filter(Boolean);
  $('field-coverage').replaceChildren(raws.length ? el('div', { class: 'view' }, fieldsTable(fieldInventory(raws))) : emptyView('No product records.'));
  $('raw-json').replaceChildren(...view.run.responses.map(({ call, response }) => el('details', {},
    el('summary', { text: `${call.endpoint} ${call.label}${response.ok ? '' : ' (failed)'}` }),
    jsonView(response.body ?? { error: response.error }))));
}

/**
 * Show a finished search (or a saved response).
 * @param {{ title: string, platforms: string[], run: object, etaCache: object, brandQuery?: string, meta?: Node[] }} input
 */
export function showRun({ title, platforms, run, etaCache, queries = [], brandQuery = '', meta = [] }) {
  const rows = attachEta(run.rows, etaCache);
  view = {
    platforms, run, rows, etaCache, queries, relevantOnly: $('relevant-only').checked,
    sort: { key: null, dir: 1 }, filter: '', expanded: [], details: {}, selected: [],
  };
  setView({ selected: brandQuery ? brandsMatching(brandCounts(baseRows().rows), brandQuery) : [] });
  $('table-filter').value = '';
  $('result-title').textContent = title;
  $('result-meta').replaceChildren(...meta);
  renderStrip();
  $('run-failures').replaceChildren(...run.failures.map((f) => el('li', { text: f })),
    ...(run.skipped ? [el('li', { text: `${run.skipped} call(s) skipped after that error.` })] : []));
  $('results').hidden = false;
  renderBrands();
  renderTable();
  renderExtras();
}

/** Store loading / result / error for one row's full item lookup. */
export function setItemDetails(key, state) {
  if (!view) return;
  setView({ details: { ...view.details, [key]: state } });
  renderTable();
}

function downloadCsv() {
  if (!view) return;
  const blob = new Blob([`﻿${toCsv(visibleRows(), [...PRODUCT_COLUMNS])}`], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `qc-products-${Date.now()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** @param {typeof handlers} callbacks */
export function initResults(callbacks) {
  handlers = { ...handlers, ...callbacks };
  $('my-brand').value = readMyBrand();
  $('relevant-only').checked = readRelevantOnly();
  $('relevant-only').addEventListener('change', (e) => {
    try { localStorage.setItem(RELEVANT_KEY, String(e.target.checked)); } catch { /* not remembered */ }
    if (!view) return;
    setView({ relevantOnly: e.target.checked });
    // Drop brand selections that no longer have any rows, so the table can't end up silently empty.
    const present = new Set(brandCounts(baseRows().rows).map((c) => c.brand));
    setView({ selected: view.selected.filter((b) => present.has(b)) });
    renderStrip();
    renderBrands();
    renderTable();
  });
  $('my-brand').addEventListener('input', () => {
    try { localStorage.setItem(MY_BRAND_KEY, $('my-brand').value); } catch { /* not remembered */ }
    if (view) renderBrands();
  });
  $('brand-clear').addEventListener('click', () => {
    if (!view) return;
    setView({ selected: [] });
    renderBrands();
    renderTable();
  });
  $('table-filter').addEventListener('input', (e) => {
    if (!view) return;
    setView({ filter: e.target.value });
    renderTable();
  });
  $('export-csv').addEventListener('click', downloadCsv);
}
