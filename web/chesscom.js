// Browser stand-in for server/chesscom.js: only what server/insights.js imports.
export function openingName(ecoUrl) {
  const slug = (ecoUrl || '').split('/openings/')[1];
  if (!slug) return '';
  return decodeURIComponent(slug)
    .replace(/-\d+\..*$/, '')
    .replace(/-/g, ' ');
}
