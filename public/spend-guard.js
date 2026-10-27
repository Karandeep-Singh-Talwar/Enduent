// Decides when the explorer should stop and ask "are you sure?" before spending credits.
//
// Known costs (from shared/endpoints.js):
//   item details ................... 1 credit
//   one Search press ............... (queries × platforms) + ETA platforms not cached for this location
//                                    e.g. 4 platforms, first search here = 4 + 4 = 8; later searches = 4
//   brand catalog with 3 keywords .. 4 queries × platforms (+ ETA if not cached)
//   credits / platforms ............ free (never reaches this function)
//
// `remaining` is the last known balance from the X-Credits-Remaining header, or null
// before the first call / when the balance could not be read.

/**
 * @param {number} cost credits this call will consume (always > 0 here)
 * @param {number | null} remaining last known credit balance, null if unknown
 * @returns {boolean} true → show the confirm dialog before calling the API
 */
export function shouldConfirmSpend(cost, remaining) {
  // TODO(you): replace this placeholder policy. It asks every time, which is safe but noisy.
  return cost > 0;
}
