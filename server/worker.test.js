import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.js';

const ORIGIN = 'https://app.example';
const CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly';
const TASKS = 'https://www.googleapis.com/auth/tasks.readonly';

class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(new URL('./migrations/0001_auth.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const db = this.sqlite;
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  }
}

function fixture(t, { expiresIn = 3600, email = 'owner@example.com', invalidRefresh = false, slowRefresh = false } = {}) {
  const DB = new TestD1();
  t.after(() => DB.sqlite.close());
  const env = {
    DB, APP_ORIGIN: ORIGIN,
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-only-client-secret',
    SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ALLOWED_EMAILS: 'owner@example.com',
    ASSETS: { fetch: async () => new Response('<html>test app</html>', { headers: { 'Content-Type': 'text/html' } }) },
  };
  const calls = [];
  let challenge;
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
      if (body.get('grant_type') === 'authorization_code') {
        assert.equal(body.get('redirect_uri'), `${ORIGIN}/auth/google/callback`);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')));
        assert.equal(Buffer.from(digest).toString('base64url'), challenge, 'PKCE verifier must match the browser authorization request');
        return Response.json({ access_token: 'test-access-initial', refresh_token: 'test-refresh-private', scope: `openid email ${CALENDAR} ${TASKS}`, expires_in: expiresIn });
      }
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'test-refresh-private');
      if (slowRefresh) await new Promise(resolve => setTimeout(resolve, 20));
      return invalidRefresh ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'test-access-refreshed', expires_in: 3600, scope: `openid email ${CALENDAR} ${TASKS}` });
    }
    if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: 'test-owner-sub', email, email_verified: true });
    if (url.href === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (url.hostname === 'www.googleapis.com' || url.hostname === 'tasks.googleapis.com') {
      assert.equal(options.headers.Authorization, expiresIn < 60 ? 'Bearer test-access-refreshed' : 'Bearer test-access-initial');
      return Response.json({ items: [{ id: 'private-event', summary: 'Private test event' }] });
    }
    throw new Error(`Unexpected external host: ${url.hostname}`);
  });
  const request = (path, { cookie, origin, ...init } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(init.headers || {}) } }), env);
  async function login() {
    const start = await request('/auth/google/start?tasks=1');
    assert.equal(start.status, 302);
    const authURL = new URL(start.headers.get('Location'));
    challenge = authURL.searchParams.get('code_challenge');
    assert.equal(authURL.hostname, 'accounts.google.com');
    assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authURL.searchParams.get('access_type'), 'offline');
    const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
    const callbackPath = `/auth/google/callback?state=${authURL.searchParams.get('state')}&code=test-code`;
    const result = await request(callbackPath, { cookie: stateCookie });
    const sessionHeader = result.headers.getSetCookie().find(value => value.startsWith('__Host-weekflow_session='));
    return { result, cookie: sessionHeader?.split(';')[0], sessionHeader, stateCookie, callbackPath };
  }
  return { env, calls, request, login };
}

test('persistent login uses secure opaque cookies, encrypted tokens and single-use PKCE state', async t => {
  const { env, calls, request, login } = fixture(t);
  const loggedIn = await login();
  assert.equal(loggedIn.result.headers.get('Location'), `${ORIGIN}/`);
  assert.match(loggedIn.sessionHeader, /HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);
  assert.equal(loggedIn.sessionHeader.includes('Domain='), false);
  const row = env.DB.sqlite.prepare('SELECT * FROM sessions').get();
  for (const value of ['test-access-initial', 'test-refresh-private', 'owner@example.com', loggedIn.cookie.split('=')[1]]) assert.equal(JSON.stringify(row).includes(value), false);
  const count = calls.length;
  // A fresh HTTP request models closing and reopening the page with its cookie.
  for (let open = 0; open < 2; open++) {
    const sessionResponse = await request('/auth/session', { cookie: loggedIn.cookie });
    const data = await sessionResponse.json();
    assert.equal(data.authenticated, true);
    assert.equal(data.hasTasks, true);
    assert.equal(data.accountEmail, 'owner@example.com');
    assert.equal(JSON.stringify(data).includes('test-access'), false);
    assert.equal(JSON.stringify(data).includes('test-refresh'), false);
    assert.match(sessionResponse.headers.get('Cache-Control'), /no-store/);
  }
  assert.equal(calls.length, count, 'restoring the app session requires no new Google consent');
  const replay = await request(loggedIn.callbackPath, { cookie: loggedIn.stateCookie });
  assert.match(replay.headers.get('Location'), /auth_error=expired_oauth_state/);
  assert.equal(calls.length, count, 'replayed callbacks must not exchange a code');
  const csrf = await request(loggedIn.callbackPath);
  assert.match(csrf.headers.get('Location'), /auth_error=invalid_oauth_state/);
  const page = await request('/');
  assert.match(page.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('Content-Security-Policy'), /connect-src 'self'/);
});

test('expired Google access tokens refresh on the server without exposing tokens to the browser', async t => {
  const { calls, request, login } = fixture(t, { expiresIn: 1 });
  const { cookie } = await login();
  const response = await request('/api/google/calendar/events?singleEvents=true&maxResults=100', { cookie });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].id, 'private-event');
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  const exchanges = calls.filter(call => call.url.pathname === '/token');
  assert.equal(exchanges.length, 2, 'one initial exchange and one refresh');
  const tasks = await request('/api/google/tasks/users/@me/lists?maxResults=100', { cookie });
  assert.equal(tasks.status, 200);
  assert.equal(calls.filter(call => call.url.pathname === '/token').length, 2, 'valid refreshed token is reused');
});

test('parallel expired requests share a refresh lease and can safely retry', async t => {
  const { calls, request, login } = fixture(t, { expiresIn: 1, slowRefresh: true });
  const { cookie } = await login();
  const responses = await Promise.all([
    request('/api/google/calendar/events?singleEvents=true', { cookie }),
    request('/api/google/tasks/users/@me/lists', { cookie }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 503]);
  assert.equal(responses.find(response => response.status === 503).headers.get('Retry-After'), '1');
  const retried = await request('/api/google/tasks/users/@me/lists', { cookie });
  assert.equal(retried.status, 200);
  assert.equal(calls.filter(call => call.url.pathname === '/token').length, 2);
});

test('account allowlist rejects other Google accounts without creating a session', async t => {
  const { env, login } = fixture(t, { email: 'someone@example.com' });
  const { result, cookie } = await login();
  assert.match(result.headers.get('Location'), /auth_error=account_not_allowed/);
  assert.equal(cookie, undefined);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('removing an allowed account immediately invalidates its existing session', async t => {
  const { env, request, login } = fixture(t);
  const { cookie } = await login();
  env.ALLOWED_EMAILS = 'another@example.com';
  assert.equal((await (await request('/auth/session', { cookie })).json()).authenticated, false);
  assert.equal((await request('/api/google/calendar/events', { cookie })).status, 401);
});

test('expired sessions and revoked Google grants require a new login instead of silently persisting', async t => {
  const { env, request, login } = fixture(t, { expiresIn: 1, invalidRefresh: true });
  const { cookie } = await login();
  const response = await request('/api/google/calendar/events', { cookie });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal((await (await request('/auth/session', { cookie })).json()).authenticated, false);
});

test('logout rejects CSRF, clears the cookie, revokes the grant and blocks subsequent reads', async t => {
  const { calls, request, login } = fixture(t);
  const { cookie } = await login();
  assert.equal((await request('/auth/logout', { method: 'POST', cookie, origin: 'https://other.example', headers: { 'X-Weekflow-Request': '1' } })).status, 403);
  assert.equal((await (await request('/auth/session', { cookie })).json()).authenticated, true);
  const logout = await request('/auth/logout', { method: 'POST', cookie, origin: ORIGIN, headers: { 'X-Weekflow-Request': '1' } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(calls.filter(call => call.url.pathname === '/revoke').length, 1);
  assert.equal((await request('/api/google/calendar/events', { cookie })).status, 401);
});

test('the backend is a restricted read proxy, not an arbitrary URL proxy or mutation endpoint', async t => {
  const { calls, request, login } = fixture(t);
  const { cookie } = await login();
  const count = calls.length;
  assert.equal((await request('/api/google/calendar/events?url=https://other.example', { cookie })).status, 400);
  assert.equal((await request('/api/google/tasks/other/path', { cookie })).status, 404);
  assert.equal((await request('/api/google/calendar/events', { method: 'POST', cookie })).status, 405);
  assert.equal((await request('/api/google/calendar/events')).status, 401);
  assert.equal(calls.length, count);
});
