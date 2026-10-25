// Vercel Web Analytics for the online version. The app routes with the URL hash,
// which Vercel ignores, so each hash route is reported as a path of its own
// (#/player/hikaru/games → /player/hikaru/games). The dashboard's Pages list then
// shows which usernames were opened. Custom events (track) need a Pro plan.
import { inject, pageview, track } from '@vercel/analytics';

const ROUTES = { player: '/player/[username]/[tab]', game: '/game/[uuid]', live: '/live' };

function report() {
  const path = '/' + location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const route = ROUTES[parts[0]] || path;
  pageview({ route, path: parts[0] === 'game' ? `/game/${parts[1]}` : path });
}

inject({ disableAutoTrack: true });
report();
addEventListener('hashchange', report);

export { track };
