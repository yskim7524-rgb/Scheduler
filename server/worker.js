const SESSION_COOKIE = '__Host-weekflow_session';
const STATE_COOKIE = '__Host-weekflow_oauth';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const STATE_SECONDS = 10 * 60;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';
const encoder = new TextEncoder();

class AuthError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const randomValue = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));

function securityHeaders() {
  return {
    'Cache-Control': 'private, no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Vary': 'Cookie',
  };
}
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function readCookie(request, name) {
  const item = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  const value = item?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function redirect(location, cookies = []) {
  const headers = new Headers({ ...securityHeaders(), Location: location });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 302, headers });
}
function configured(env) {
  return Boolean(env.DB && env.APP_ORIGIN && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY && env.ALLOWED_EMAILS);
}
function appOrigin(env) {
  if (!configured(env)) throw new AuthError(503, 'auth_not_configured');
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new AuthError(503, 'invalid_app_origin');
  return origin.origin;
}
async function encryptionKey(env) {
  let bytes;
  try { bytes = fromBase64(env.SESSION_ENCRYPTION_KEY); } catch { throw new AuthError(503, 'invalid_encryption_key'); }
  if (bytes.length !== 32) throw new AuthError(503, 'invalid_encryption_key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, context, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await encryptionKey(env), encoder.encode(JSON.stringify(value))));
  return `${base64url(iv)}.${base64url(ciphertext)}`;
}
async function unseal(env, context, encrypted) {
  const [iv, ciphertext] = encrypted.split('.');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(context) }, await encryptionKey(env), fromBase64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
async function readSession(request, env) {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value || !env.DB) return null;
  const sessionHash = await hash(value);
  const row = await env.DB.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?').bind(sessionHash, nowSeconds()).first();
  if (!row) return null;
  try {
    const payload = await unseal(env, sessionHash, row.encrypted_payload);
    const allowed = String(env.ALLOWED_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(String(payload.email).toLowerCase())) {
      await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(sessionHash).run();
      return null;
    }
    return { ...row, payload };
  }
  catch {
    await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(sessionHash).run();
    return null;
  }
}
async function googleToken(env, fields) {
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...fields }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new AuthError(503, 'google_temporarily_unavailable'); }
  const data = await response.json();
  if (!response.ok) throw new AuthError(data.error === 'invalid_grant' ? 401 : 503, data.error === 'invalid_grant' ? 'session_expired' : 'google_token_failed');
  if (!data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) throw new AuthError(503, 'invalid_google_token_response');
  return data;
}

async function startLogin(request, env, url) {
  const origin = appOrigin(env);
  const state = randomValue();
  const verifier = randomValue();
  const stateHash = await hash(state);
  const current = await readSession(request, env);
  const includeTasks = url.searchParams.get('tasks') === '1' || current?.payload.scope?.split(' ').includes(TASKS_SCOPE);
  const scopes = ['openid', 'email', CALENDAR_SCOPE, ...(includeTasks ? [TASKS_SCOPE] : [])].join(' ');
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, encrypted_payload, expires_at) VALUES (?, ?, ?)')
    .bind(stateHash, await seal(env, stateHash, { verifier, scopes }), nowSeconds() + STATE_SECONDS).run();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: 'code', scope: scopes, access_type: 'offline', include_granted_scopes: 'true',
    prompt: 'consent', state, code_challenge: await hash(verifier), code_challenge_method: 'S256',
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [cookie(STATE_COOKIE, state, STATE_SECONDS)]);
}

async function callback(request, env, url) {
  const origin = appOrigin(env);
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, STATE_COOKIE)) throw new AuthError(400, 'invalid_oauth_state');
  const stateHash = await hash(state);
  // DELETE RETURNING makes callback replay rejection atomic, including parallel requests.
  const row = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING encrypted_payload')
    .bind(stateHash, nowSeconds()).first();
  if (!row) throw new AuthError(400, 'expired_oauth_state');
  const clearState = cookie(STATE_COOKIE, '', 0);
  if (url.searchParams.has('error')) return redirect(`${origin}/?auth_error=denied`, [clearState]);
  const code = url.searchParams.get('code');
  if (!code) throw new AuthError(400, 'missing_authorization_code');
  const stateData = await unseal(env, stateHash, row.encrypted_payload);
  const data = await googleToken(env, { grant_type: 'authorization_code', code, code_verifier: stateData.verifier, redirect_uri: `${origin}/auth/google/callback` });
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (!userResponse.ok) throw new AuthError(401, 'google_identity_failed');
  const user = await userResponse.json();
  const allowed = env.ALLOWED_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!user.sub || user.email_verified !== true || !allowed.includes(String(user.email).toLowerCase())) throw new AuthError(403, 'account_not_allowed');
  const previous = await readSession(request, env);
  const refreshToken = data.refresh_token || (previous?.payload.sub === user.sub ? previous.payload.refreshToken : null);
  if (!refreshToken) return redirect(`${origin}/?auth_error=offline_access_required`, [clearState]);
  const scope = data.scope || stateData.scopes;
  if (!scope.split(' ').includes(CALENDAR_SCOPE)) return redirect(`${origin}/?auth_error=calendar_permission_required`, [clearState]);
  const sessionValue = randomValue();
  const sessionHash = await hash(sessionValue);
  const payload = { accessToken: data.access_token, refreshToken, accessExpiresAt: nowSeconds() + Number(data.expires_in), scope, sub: user.sub, email: user.email };
  await env.DB.prepare('INSERT INTO sessions (session_hash, encrypted_payload, expires_at) VALUES (?, ?, ?)')
    .bind(sessionHash, await seal(env, sessionHash, payload), nowSeconds() + SESSION_SECONDS).run();
  if (previous) await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(previous.session_hash).run();
  return redirect(`${origin}/`, [clearState, cookie(SESSION_COOKIE, sessionValue, SESSION_SECONDS)]);
}

async function accessToken(session, env, force = false) {
  if (!force && session.payload.accessExpiresAt > nowSeconds() + 60) return session.payload.accessToken;
  const claimed = await env.DB.prepare('UPDATE sessions SET refresh_lock_until = ? WHERE session_hash = ? AND expires_at > ? AND refresh_lock_until < ?')
    .bind(nowSeconds() + 30, session.session_hash, nowSeconds(), nowSeconds()).run();
  if (!claimed.meta?.changes) throw new AuthError(503, 'refresh_in_progress');
  try {
    // Re-read after claiming the lease: another request may have just refreshed.
    const row = await env.DB.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?').bind(session.session_hash, nowSeconds()).first();
    if (!row) throw new AuthError(401, 'session_expired');
    const latest = await unseal(env, session.session_hash, row.encrypted_payload);
    if ((!force || latest.accessToken !== session.payload.accessToken) && latest.accessExpiresAt > nowSeconds() + 60) return latest.accessToken;
    const data = await googleToken(env, { grant_type: 'refresh_token', refresh_token: latest.refreshToken });
    const updated = { ...latest, accessToken: data.access_token, refreshToken: data.refresh_token || latest.refreshToken, accessExpiresAt: nowSeconds() + Number(data.expires_in), scope: data.scope || latest.scope };
    await env.DB.prepare('UPDATE sessions SET encrypted_payload = ? WHERE session_hash = ? AND expires_at > ?')
      .bind(await seal(env, session.session_hash, updated), session.session_hash, nowSeconds()).run();
    return updated.accessToken;
  } catch (error) {
    if (error.status === 401) await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(session.session_hash).run();
    throw error;
  } finally {
    await env.DB.prepare('UPDATE sessions SET refresh_lock_until = 0 WHERE session_hash = ?').bind(session.session_hash).run();
  }
}

async function googleProxy(request, env, url) {
  const session = await readSession(request, env);
  if (!session) throw new AuthError(401, 'session_expired');
  let destination;
  let allowedParams;
  if (url.pathname === '/api/google/calendar/events') {
    destination = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    allowedParams = ['timeMin', 'timeMax', 'singleEvents', 'orderBy', 'maxResults', 'pageToken'];
  } else if (url.pathname.startsWith('/api/google/tasks/')) {
    if (!session.payload.scope.split(' ').includes(TASKS_SCOPE)) throw new AuthError(403, 'tasks_permission_required');
    const path = url.pathname.slice('/api/google/tasks/'.length);
    const match = /^lists\/([^/]+)\/tasks$/.exec(path);
    if (path !== 'users/@me/lists' && !match) throw new AuthError(404, 'not_found');
    destination = new URL(`https://tasks.googleapis.com/tasks/v1/${match ? `lists/${encodeURIComponent(decodeURIComponent(match[1]))}/tasks` : 'users/@me/lists'}`);
    allowedParams = ['maxResults', 'pageToken', 'showCompleted', 'showHidden', 'showAssigned', 'showDeleted'];
  } else throw new AuthError(404, 'not_found');
  for (const [key, value] of url.searchParams) {
    if (!allowedParams.includes(key)) throw new AuthError(400, 'unsupported_query_parameter');
    destination.searchParams.set(key, value);
  }
  const send = value => fetch(destination.toString(), { headers: { Authorization: `Bearer ${value}` }, signal: AbortSignal.timeout(15000) });
  let upstream = await send(await accessToken(session, env));
  if (upstream.status === 401) upstream = await send(await accessToken(session, env, true));
  if (upstream.status === 401) {
    await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(session.session_hash).run();
    throw new AuthError(401, 'session_expired');
  }
  if (!upstream.ok) return json({ error: 'google_api_failed' }, upstream.status);
  return new Response(upstream.body, { status: upstream.status, headers: { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' } });
}

async function logout(request, env) {
  if (request.headers.get('Origin') !== appOrigin(env) || request.headers.get('X-Weekflow-Request') !== '1') throw new AuthError(403, 'invalid_request_origin');
  const session = await readSession(request, env);
  if (session) {
    await env.DB.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(session.session_hash).run();
    try {
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.payload.refreshToken }), signal: AbortSignal.timeout(10000) });
    } catch { /* Local session is already invalidated even if Google is unavailable. */ }
  }
  return json({ authenticated: false }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const authRoute = url.pathname.startsWith('/auth/') || url.pathname.startsWith('/api/');
    if (!authRoute) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return new Response(response.body, { status: response.status, headers });
    }
    try {
      if (url.pathname === '/auth/session' && request.method === 'GET') {
        const session = await readSession(request, env);
        return json({ enabled: true, configured: configured(env), authenticated: Boolean(session), ...(session ? { expiresAt: session.expires_at * 1000, hasTasks: session.payload.scope.split(' ').includes(TASKS_SCOPE), accountEmail: session.payload.email } : {}) });
      }
      if (url.origin !== appOrigin(env)) throw new AuthError(403, 'invalid_request_origin');
      if (url.pathname === '/auth/google/start' && request.method === 'GET') return await startLogin(request, env, url);
      if (url.pathname === '/auth/google/callback' && request.method === 'GET') return await callback(request, env, url);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return await logout(request, env);
      if (url.pathname.startsWith('/api/google/') && request.method === 'GET') return await googleProxy(request, env, url);
      if (request.method !== 'GET') throw new AuthError(405, 'method_not_allowed');
      throw new AuthError(404, 'not_found');
    } catch (error) {
      if (url.pathname === '/auth/google/callback' && env.APP_ORIGIN) {
        return redirect(`${new URL(env.APP_ORIGIN).origin}/?auth_error=${encodeURIComponent(error instanceof AuthError ? error.code : 'login_failed')}`, [cookie(STATE_COOKIE, '', 0)]);
      }
      return json({ error: error instanceof AuthError ? error.code : 'request_failed' }, error instanceof AuthError ? error.status : 502, error.status === 401 ? { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) } : error.code === 'refresh_in_progress' ? { 'Retry-After': '1' } : {});
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(nowSeconds()).run(),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowSeconds()).run(),
    ]));
  },
};
