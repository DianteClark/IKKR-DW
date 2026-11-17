// Device preferences (not part of any campaign): low effects, haptics.
const KEY = 'ikkr-dw-prefs';
let P = { lowFx: false, haptics: true };
try { P = { ...P, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
export const prefs = P;
export function setPref(k, v) { P[k] = v; try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} }
// short vibration patterns (Android; iPhones ignore web vibration)
export function buzz(kind = 'tap') {
  if (!P.haptics || !navigator.vibrate) return;
  const pat = { tap: 8, hit: 18, heavy: [30, 30, 40], win: [40, 60, 40, 60, 80], lose: [120], alert: [20, 40, 20] }[kind] || 10;
  try { navigator.vibrate(pat); } catch {}
}
