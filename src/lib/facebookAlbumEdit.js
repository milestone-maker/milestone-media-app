// Pure, DOM-free helpers for the editable Facebook album (add / remove / swap)
// and lightbox navigation. Importable by the React editor AND node tests.
// The album is an ordered list of photo URLs; order is preserved everywhere.

/** Append a URL if not already present. Returns a new array (or the same when no-op). */
export function addToAlbum(album, url) {
  const a = Array.isArray(album) ? album : [];
  if (!url || a.includes(url)) return a;
  return [...a, url];
}

/** Remove a URL. Returns a new array without it. */
export function removeFromAlbum(album, url) {
  const a = Array.isArray(album) ? album : [];
  return a.filter((u) => u !== url);
}

/**
 * Replace `oldUrl` with `newUrl`, keeping the slot's position. If `oldUrl` isn't
 * present, append `newUrl`. If `newUrl` already exists elsewhere, it's not
 * duplicated (its other occurrence is dropped, the old slot takes newUrl).
 */
export function swapInAlbum(album, oldUrl, newUrl) {
  const a = Array.isArray(album) ? album : [];
  if (!newUrl || newUrl === oldUrl) return a;
  const i = a.indexOf(oldUrl);
  if (i === -1) return a.includes(newUrl) ? a : [...a, newUrl];
  // Drop any pre-existing occurrence of newUrl (except the slot we're filling),
  // then place newUrl in oldUrl's slot.
  const next = a.map((u) => u).filter((u, idx) => idx === i || u !== newUrl);
  const j = next.indexOf(oldUrl);
  next[j] = newUrl;
  return next;
}

/** Wrapping index step: dir +1 / -1 over a list of length `len`. */
export function stepIndex(current, len, dir) {
  if (!Number.isFinite(len) || len <= 0) return 0;
  return ((current + dir) % len + len) % len;
}
