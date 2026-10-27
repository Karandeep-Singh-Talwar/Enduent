// The single product table: every useful field as a column, plus an expandable row with ALL raw fields
// and an on-demand full item lookup.
import { platformLabel } from '/shared/platforms.js';
import { flattenRecord } from './extract.js';
import { currencyOf, dash, el, emptyView, link, money, safeHttpUrl, yesNo } from './render.js';

/** Stable key for a product row (also used for expanded state and item details). */
export const rowKey = (row) => `${row.platform}|${row.id}`;

function thumb(url) {
  const src = safeHttpUrl(url);
  return src ? el('img', { class: 'thumb', src, alt: '', loading: 'lazy' }) : el('div', { class: 'thumb' });
}

const sponsoredCell = (value) => {
  if (value === true) return el('span', { class: 'chip ad', text: 'Sponsored' });
  return value === false ? el('span', { class: 'muted', text: 'No' }) : '—';
};

const COLUMNS = Object.freeze([
  { key: 'rank', label: '#', num: true, sort: true, cell: (r) => dash(r.rank) },
  { key: 'image', label: '', cell: (r) => thumb(r.image) },
  {
    key: 'name', label: 'Product', sort: true,
    cell: (r) => el('div', { class: 'prod' }, el('strong', { text: r.name }),
      el('span', { class: 'muted', text: [r.brand, r.quantity].filter(Boolean).join(' · ') })),
  },
  { key: 'platform', label: 'Platform', sort: true, cell: (r) => el('span', { class: 'chip', text: platformLabel(r.platform) }) },
  { key: 'currency', label: 'Cur.', sort: true, cell: (r) => el('span', { class: 'muted', text: currencyOf(r) }) },
  { key: 'price', label: 'Price', num: true, sort: true, cell: (r) => el('strong', { text: money(r.price, r) }) },
  { key: 'mrp', label: 'MRP', num: true, sort: true, cell: (r) => money(r.mrp, r) },
  { key: 'discount_pct', label: 'Off', num: true, sort: true, cell: (r) => (r.discount_pct ? `${r.discount_pct}%` : '—') },
  { key: 'available', label: 'In stock', sort: true, cell: (r) => yesNo(r.available) },
  { key: 'inventory', label: 'Inv.', num: true, sort: true, cell: (r) => dash(r.inventory) },
  { key: 'rating', label: 'Rating', num: true, sort: true, cell: (r) => (r.rating ? `★ ${r.rating}${r.rating_count ? ` (${r.rating_count})` : ''}` : '—') },
  { key: 'eta', label: 'ETA', sort: true, cell: (r) => dash(r.eta) },
  { key: 'open', label: 'Open', sort: true, cell: (r) => yesNo(r.open) },
  { key: 'store_id', label: 'Dark store', sort: true, cell: (r) => (r.store_id === null || r.store_id === undefined ? '—' : el('code', { text: r.store_id })) },
  { key: 'sponsored', label: 'Ad', sort: true, cell: (r) => sponsoredCell(r.sponsored) },
  { key: 'id', label: 'Item ID', cell: (r) => el('code', { text: r.id }) },
  { key: 'deeplink', label: 'Link', cell: (r) => link(r.deeplink) },
]);

function headerRow(sort, onSort) {
  return el('tr', {}, [...COLUMNS, { key: 'more', label: '' }].map((c) => el('th', {
    class: [c.num ? 'num' : '', c.sort ? 'sortable' : ''].join(' ').trim() || null,
    onclick: c.sort ? () => onSort(c.key) : null,
    text: `${c.label}${sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}`,
  })));
}

function valueCell(value) {
  if (typeof value === 'string' && safeHttpUrl(value)) return link(value, value.length > 60 ? `${value.slice(0, 57)}…` : value);
  return dash(value);
}

function kvGrid(record) {
  return el('dl', { class: 'kv' }, flattenRecord(record).flatMap(([path, value]) => [
    el('dt', {}, el('code', { text: path })), el('dd', {}, valueCell(value)),
  ]));
}

function itemDetailsBlock(row, details, onDetails) {
  const state = details[rowKey(row)];
  if (!state) {
    return el('button', { type: 'button', class: 'primary', onclick: () => onDetails(row), text: 'Load full item details (1 credit)' });
  }
  if (state.loading) return el('p', { class: 'muted', text: 'Loading item details…' });
  if (state.error) return el('p', { class: 'error-text', text: state.error });
  const items = state.body?.data?.items ?? [];
  if (items.length === 0) return emptyView('No item details returned.');
  return el('div', {}, items.map((item, i) => el('div', { class: 'item-block' },
    items.length > 1 ? el('h4', { text: `Variant ${i + 1}: ${dash(item.name)} ${dash(item.quantity)}` }) : null,
    kvGrid(item))));
}

function detailRow(row, details, onDetails) {
  return el('tr', { class: 'detail' }, el('td', { colspan: COLUMNS.length + 1 },
    el('div', { class: 'detail-grid' },
      el('section', {}, el('h4', { text: 'Everything in the search result' }), kvGrid(row.raw ?? row)),
      el('section', {}, el('h4', { text: 'Full item details (/v1/item)' }), itemDetailsBlock(row, details, onDetails)))));
}

/**
 * @param {object[]} rows
 * @param {{ sort: { key: string|null, dir: number }, onSort: (key: string) => void, expanded: string[],
 *           onToggle: (key: string) => void, details: Record<string, object>, onDetails: (row: object) => void }} opts
 */
export function productTable(rows, { sort, onSort, expanded, onToggle, details, onDetails }) {
  const body = rows.flatMap((row) => {
    const key = rowKey(row);
    const open = expanded.includes(key);
    const main = el('tr', { class: open ? 'expanded' : null },
      COLUMNS.map((c) => el('td', { class: c.num ? 'num' : null }, c.cell(row))),
      el('td', {}, el('button', {
        type: 'button', class: 'expand-btn', 'aria-expanded': String(open), title: 'Show every field',
        onclick: () => onToggle(key), text: open ? 'Hide' : 'All fields',
      })));
    return open ? [main, detailRow(row, details, onDetails)] : [main];
  });
  return el('table', {}, el('thead', {}, headerRow(sort, onSort)), el('tbody', {}, body));
}
