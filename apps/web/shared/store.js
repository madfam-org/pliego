// @ts-check
// Guarded localStorage: private mode, blocked storage and non-browser hosts never throw.

/** @param {string} key @returns {string | null} */
export function storeGet(key) {
  try {
    return globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value @returns {boolean} */
export function storeSet(key, value) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
