// DOM building blocks. All API data goes through textContent / validated URLs, never innerHTML.
import { platformCurrency, platformLabel } from '/shared/platforms.js';

/**
 * Tiny element factory.
 * @param {string} tag
 * @param {Record<string, unknown>} [props] class | text | on<Event> | any attribute
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class') node.className = String(val);
    else if (key === 'text') node.textContent = String(val);
    else if (key === 'value') node.value = String(val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  node.append(...kids.map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

/** @returns {string | null} the URL only if it is http(s) — blocks javascript: and data: links from API data */
export function safeHttpUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export const dash = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** Prefer the currency the API reports; fall back to the platform's country. */
export const currencyOf = (row) => (typeof row.currency === 'string' && row.currency ? row.currency : platformCurrency(row.platform));

export const money = (amount, row) => {
  if (typeof amount !== 'number') return dash(amount);
  const code = currencyOf(row);
  return `${code === 'INR' ? '₹' : `${code} `}${amount.toLocaleString('en-IN')}`;
};

export const yesNo = (v) => (typeof v === 'boolean' ? el('span', { class: v ? 'yes' : 'no', text: v ? 'Yes' : 'No' }) : '—');

export function link(url, text = 'Open ↗') {
  const href = safeHttpUrl(url);
  return href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text }) : dash(url);
}

export const pill = (content, tone) => el('span', { class: `pill${tone ? ` ${tone}` : ''}` }, content);
export const jsonView = (body) => el('pre', { class: 'json', text: JSON.stringify(body, null, 2) ?? 'null' });
export const emptyView = (message) => el('div', { class: 'empty', text: message });

function stripCountLine(s) {
  if (s.error) return el('span', { class: 'error-text', text: s.error });
  if (s.warning) return el('span', { class: 'warn-text', text: `⚠ ${s.warning}` });
  return el('span', { class: 'muted' }, `${s.count} product${s.count === 1 ? '' : 's'}`,
    s.hidden > 0 ? el('span', { class: 'warn-text', text: ` · ${s.hidden} unrelated hidden` }) : null);
}

/** One card per searched platform: products found, ETA, open/closed, dark store, or the platform's error/warning. */
export function platformStrip(statuses) {
  return statuses.map((s) => el('div', { class: `platform-card${s.error ? ' has-error' : ''}${s.warning ? ' has-warning' : ''}` },
    el('strong', { text: platformLabel(s.platform) }),
    stripCountLine(s),
    s.eta ? el('span', {}, `⏱ ${s.eta}`) : null,
    typeof s.open === 'boolean' ? el('span', { class: s.open ? 'yes' : 'no', text: s.open ? '● Open' : '● Closed' }) : null,
    s.store_id !== null && s.store_id !== undefined ? el('span', { class: 'muted' }, 'Store ', el('code', { text: s.store_id })) : null));
}

/**
 * Brand chips with counts. Click toggles the filter; "my brand" is starred.
 * @param {Array<{ brand: string, count: number }>} counts
 * @param {string[]} selected
 * @param {string} myBrand exact brand name (or '')
 * @param {(brand: string) => void} onToggle
 */
export function brandBar(counts, selected, myBrand, onToggle) {
  return counts.map(({ brand, count }) => el('button', {
    type: 'button',
    class: `brand-chip${brand === myBrand ? ' mine' : ''}`,
    'aria-pressed': String(selected.includes(brand)),
    onclick: () => onToggle(brand),
  }, brand === myBrand ? '★ ' : null, brand, el('span', { class: 'count', text: count })));
}

function matrixCell(cell, row) {
  if (cell.count === 0) return el('td', { class: 'muted', text: 'not listed' });
  const price = cell.minPrice === cell.maxPrice ? money(cell.minPrice, row) : `${money(cell.minPrice, row)}–${money(cell.maxPrice, row)}`;
  return el('td', {},
    el('strong', { text: `${cell.count} item${cell.count === 1 ? '' : 's'}` }),
    el('div', { class: 'muted', text: price }),
    el('div', { class: 'muted', text: `best #${dash(cell.bestRank)} · ${cell.inStock}/${cell.count} in stock` }),
    cell.ads > 0 ? el('span', { class: 'chip ad', text: `${cell.ads} ad${cell.ads === 1 ? '' : 's'}` }) : null);
}

/**
 * Side-by-side brand comparison: one row per brand, one column per platform.
 * @param {Record<string, Record<string, object>>} matrix from dataset.brandMatrix
 */
export function brandMatrixTable(matrix, brands, platforms, myBrand) {
  return el('table', { class: 'matrix' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Brand' }), platforms.map((p) => el('th', { text: platformLabel(p) })))),
    el('tbody', {}, brands.map((brand) => el('tr', { class: brand === myBrand ? 'mine' : null },
      el('th', { scope: 'row', text: brand === myBrand ? `★ ${brand}` : brand }),
      platforms.map((p) => matrixCell(matrix[brand][p], { platform: p }))))));
}

/** Field coverage: every field path, its type, how often it is filled, and an example. */
export function fieldsTable(inventory) {
  return el('table', {},
    el('thead', {}, el('tr', {}, ['Field', 'Type', 'Filled', 'Example'].map((t) => el('th', { text: t })))),
    el('tbody', {}, inventory.map((f) => {
      const pct = f.total ? Math.round((f.filled / f.total) * 100) : 0;
      const bar = el('div', { class: 'fill-bar' }, el('span'));
      bar.firstChild.style.width = `${pct}%`;
      return el('tr', {},
        el('td', {}, el('code', { text: f.path })),
        el('td', { class: 'muted', text: f.type }),
        el('td', {}, el('div', { class: 'fill' }, bar, el('span', { class: 'muted', text: `${f.filled}/${f.total}` }))),
        el('td', { class: 'cell-text', title: dash(f.sample), text: dash(f.sample) }));
    })));
}
