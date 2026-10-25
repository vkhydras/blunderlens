// GET /api/usernames?key=<STATS_KEY> → JSON summary of every logged lookup:
// per username the number of player opens and batch analyses, first/last seen
// and countries, plus the raw list of lookups (newest first).
import { list } from '@vercel/blob';

export async function GET(request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!process.env.STATS_KEY || key !== process.env.STATS_KEY) return new Response('unauthorized', { status: 401 });

  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'lookups/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const lookups = blobs
    .map((b) => {
      const [, event, username, file] = b.pathname.split('/');
      const country = file.match(/-([A-Z]{2})(?:-[^-]*)?\.json$/)?.[1] || null;
      return { event, username, at: new Date(b.uploadedAt).toISOString(), country };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  const users = {};
  for (const l of lookups) {
    const u = (users[l.username] ||= { username: l.username, player: 0, batch: 0, first: l.at, last: l.at, countries: [] });
    u[l.event]++;
    if (l.at < u.first) u.first = l.at;
    if (l.at > u.last) u.last = l.at;
    if (l.country && !u.countries.includes(l.country)) u.countries.push(l.country);
  }

  const summary = Object.values(users).sort((a, b) => b.player + b.batch - (a.player + a.batch));
  return Response.json({ total: lookups.length, usernames: summary.length, summary, lookups }, { headers: { 'Cache-Control': 'no-store' } });
}
