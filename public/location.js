// Delivery location: device GPS, or a typed pincode / area name. Coordinates are looked up, never typed.
import { geoReverse, geoSearch } from './api.js';
import { el } from './render.js';

const STORAGE_KEY = 'qcx.place';
const PINCODE = /^\d{6}$/;
const $ = (id) => document.getElementById(id);

let current = null;
let notify = () => {};

/** @returns {null | { label: string, lat: number, lon: number, pincode: string | null }} */
export const getLocation = () => current;

function message(text, isError = false) {
  const box = $('loc-message');
  box.textContent = text;
  box.className = `hint${isError ? ' error-text' : ''}`;
}

function persist(place) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(place)); } catch { /* not remembered */ }
}

function restore() {
  try {
    const place = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return place && Number.isFinite(place.lat) && Number.isFinite(place.lon) ? place : null;
  } catch {
    return null;
  }
}

function renderCurrent() {
  const box = $('loc-current');
  if (!current) {
    box.replaceChildren(el('span', { class: 'muted', text: 'No delivery location yet. Use your location or type a pincode / area.' }));
    return;
  }
  const pin = el('input', {
    id: 'loc-pincode', value: current.pincode ?? '', maxlength: 6, inputmode: 'numeric',
    placeholder: 'add pincode', 'aria-label': 'Pincode', class: 'pin-input',
  });
  pin.addEventListener('change', () => {
    const value = pin.value.trim();
    if (value !== '' && !PINCODE.test(value)) return message('Pincode must be 6 digits.', true);
    setPlace({ ...current, pincode: value || null });
  });
  const parts = [
    el('span', { class: 'loc-pin', text: '📍' }),
    el('span', {}, 'Delivering to ', el('strong', { text: current.label })),
    el('label', { class: 'pin-label' }, 'PIN', pin),
    el('span', { class: 'muted coords', text: `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}` }),
    current.pincode ? null : el('span', { class: 'warn-text', text: 'DMart, JioMart and Flipkart Minutes need a pincode' }),
  ];
  box.replaceChildren(...parts.filter(Boolean));
}

function setPlace(place) {
  current = Object.freeze({ label: place.label, lat: place.lat, lon: place.lon, pincode: place.pincode ?? null });
  persist(current);
  $('loc-choices').hidden = true;
  renderCurrent();
  notify(current);
}

function showChoices(places) {
  const list = $('loc-choices');
  list.replaceChildren(...places.map((p) => el('li', {},
    el('button', { type: 'button', onclick: () => { setPlace(p); message(''); } },
      el('strong', { text: p.label }), el('span', { class: 'muted', text: ` · ${p.pincode ? `PIN ${p.pincode} · ` : ''}${p.fullName}` })))));
  list.hidden = false;
  message('Several places match. Pick one:');
}

async function lookup(query) {
  message('Looking up…');
  const res = await geoSearch(query);
  if (!res.ok) return message(res.error ?? 'Lookup failed', true);
  if (res.places.length === 0) return message('No place found. Try a pincode or add the city, e.g. "Indiranagar Bangalore".', true);
  if (res.places.length === 1) {
    setPlace(res.places[0]);
    return message('');
  }
  return showChoices(res.places);
}

function geoErrorText(error) {
  if (error?.code === 1) return 'Location permission denied. Allow it in the browser, or type a pincode.';
  if (error?.code === 3) return 'Getting your location timed out. Try again or type a pincode.';
  return 'Could not get your location. Type a pincode or area instead.';
}

function useDeviceLocation() {
  if (!navigator.geolocation) return message('This browser has no location access. Type a pincode instead.', true);
  message('Getting your location…');
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    const lat = Number(coords.latitude.toFixed(6));
    const lon = Number(coords.longitude.toFixed(6));
    const res = await geoReverse(lat, lon);
    // Keep the exact GPS point; the lookup only supplies a readable name and the pincode.
    setPlace(res.ok ? { ...res.place, lat, lon } : { label: 'My location', lat, lon, pincode: null });
    message(res.ok ? '' : 'Got your position but not the address. Add the pincode if a platform needs it.', !res.ok);
  }, (error) => message(geoErrorText(error), true), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
}

/** @param {(place: object) => void} onChange */
export function initLocation(onChange) {
  notify = onChange;
  current = restore();
  renderCurrent();
  $('loc-gps').addEventListener('click', useDeviceLocation);
  $('loc-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('loc-input').value.trim();
    if (query.length < 2) return message('Type a pincode or area name.', true);
    return lookup(query);
  });
}
