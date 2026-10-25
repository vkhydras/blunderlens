// Records a username lookup from the online version as an empty private blob.
// Everything is in the pathname (lookups/<event>/<username>/<time>-<country>),
// so api/usernames.js can summarise the log from a listing alone.
import { put } from '@vercel/blob';

const EVENTS = new Set(['player', 'batch']);
const USERNAME = /^[A-Za-z0-9_-]{1,50}$/;

export async function POST(request) {
  const { event, username } = await request.json().catch(() => ({}));
  if (!EVENTS.has(event) || !USERNAME.test(username || '')) return new Response('bad request', { status: 400 });
  const country = (request.headers.get('x-vercel-ip-country') || 'XX').replace(/[^A-Z]/g, '').slice(0, 2) || 'XX';
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  await put(`lookups/${event}/${username.toLowerCase()}/${at}-${country}.json`, '{}', {
    access: 'private',
    addRandomSuffix: true,
    contentType: 'application/json',
  });
  return new Response(null, { status: 204 });
}
