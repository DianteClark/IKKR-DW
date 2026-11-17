// Local save in the browser (single-player campaigns).
const KEY = 'ikkr-dw-save-v1';
export function hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function saveGame(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; } }
export function loadGame() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch {} }
