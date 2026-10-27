// Platform checkboxes with quick picks. The selection is remembered between visits.
import { platformLabel, QUICK_COMMERCE_IN, UAE_PLATFORMS } from '/shared/platforms.js';

const STORAGE_KEY = 'qcx.platforms';
const DEFAULT_SELECTION = Object.freeze(['BlinkIt', 'Zepto', 'Swiggy', 'BigBasket']);
const PICKS = Object.freeze({
  qc: (p) => QUICK_COMMERCE_IN.includes(p),
  india: (p) => !UAE_PLATFORMS.includes(p),
  uae: (p) => UAE_PLATFORMS.includes(p),
  none: () => false,
});

const box = () => document.getElementById('platform-checks');
let notify = () => {};

function remembered() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(saved) ? saved : null;
  } catch {
    return null;
  }
}

function remember() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getSelectedPlatforms())); } catch { /* not remembered */ }
}

/** @returns {string[]} API platform ids in display order */
export const getSelectedPlatforms = () => [...box().querySelectorAll('input:checked')].map((i) => i.value);

/**
 * (Re)build the checkboxes, keeping the current or remembered selection.
 * @param {string[]} platforms
 */
export function renderPlatforms(platforms) {
  const existing = getSelectedPlatforms();
  const keep = new Set(existing.length ? existing : (remembered() ?? DEFAULT_SELECTION));
  box().replaceChildren(...platforms.map((p) => {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', value: p, checked: keep.has(p) });
    const label = document.createElement('label');
    label.append(input, platformLabel(p));
    return label;
  }));
}

/** @param {() => void} onChange */
export function initPlatformPicker(onChange) {
  notify = onChange;
  box().addEventListener('change', () => { remember(); notify(); });
  for (const button of document.querySelectorAll('[data-pick]')) {
    button.addEventListener('click', () => {
      const rule = PICKS[button.dataset.pick];
      for (const input of box().querySelectorAll('input')) input.checked = rule(input.value);
      remember();
      notify();
    });
  }
}
