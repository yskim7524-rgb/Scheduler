import { chromium } from 'playwright';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';

const origin = 'http://localhost:4198';
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../server/migrations/0001_auth.sql', import.meta.url), 'utf8'));
const env = {
  APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'server-only-test-secret',
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'), ALLOWED_EMAILS: 'owner@example.com',
  DB: { prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) || null; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
    };
  } },
  ASSETS: { async fetch(request) {
    const root = resolve('dist');
    const path = resolve(root, `.${new URL(request.url).pathname}`);
    if (!path.startsWith(`${root}/`) && path !== root) return new Response('Not found', { status: 404 });
    const file = existsSync(path) && statSync(path).isFile() ? path : resolve(root, 'index.html');
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] || 'application/octet-stream';
    return new Response(readFileSync(file), { headers: { 'Content-Type': mime } });
  } },
};
const originalFetch = globalThis.fetch;
let refreshCount = 0;
let authorizations = 0;
const routeResults = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_secret'), env.GOOGLE_CLIENT_SECRET);
    const refreshing = body.get('grant_type') === 'refresh_token';
    if (refreshing) refreshCount++;
    return Response.json({ access_token: refreshing ? 'server-refreshed-test-token' : 'server-initial-test-token', ...(refreshing ? {} : { refresh_token: 'server-private-test-refresh-token' }), scope: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly', expires_in: refreshing ? 3600 : 1 });
  }
  if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: 'test-owner', email: 'owner@example.com', email_verified: true });
  if (url.href === 'https://oauth2.googleapis.com/revoke') return new Response('');
  if (url.hostname === 'www.googleapis.com') {
    assert.equal(options.headers.Authorization, 'Bearer server-refreshed-test-token');
    const start = new Date(new Date(url.searchParams.get('timeMin')).getTime() + 10 * 3600000);
    return Response.json({ items: [{ id: 'server-calendar', summary: '서버 연결 테스트 일정', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3600000).toISOString() } }] });
  }
  if (url.hostname === 'tasks.googleapis.com') {
    assert.equal(options.headers.Authorization, 'Bearer server-refreshed-test-token');
    return Response.json(url.pathname.endsWith('/users/@me/lists') ? { items: [{ id: 'work', title: '테스트 목록' }] } : { items: [{ id: 'task', title: '서버 연결 테스트 할 일', status: 'needsAction' }] });
  }
  throw new Error(`Unexpected server request: ${url.hostname}`);
};
const server = createServer(async (req, res) => {
  try {
    if (new URL(`${origin}${req.url}`).pathname === '/test/google-consent') {
      // Local stand-in for Google's consent origin. Using 127.0.0.1 here and
      // localhost for the app exercises a cross-site top-level cookie return.
      authorizations++;
      const state = new URL(`${origin}${req.url}`).searchParams.get('state');
      res.writeHead(302, { Location: `${origin}/auth/google/callback?code=test-code&state=${state}` });
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`${origin}${req.url}`, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, env);
    if (new URL(request.url).pathname.startsWith('/auth/') || new URL(request.url).pathname.startsWith('/api/')) routeResults.push({ path: new URL(request.url).pathname, status: response.status });
    res.statusCode = response.status;
    for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
    if (response.status === 302 && response.headers.get('Location')?.startsWith('https://accounts.google.com/')) {
      const state = new URL(response.headers.get('Location')).searchParams.get('state');
      res.setHeader('Location', `http://127.0.0.1:4198/test/google-consent?state=${state}`);
    }
    if (response.headers.getSetCookie().length) res.setHeader('Set-Cookie', response.headers.getSetCookie());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.end('Test server failed');
    console.error(error.message);
  }
});
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4198, '0.0.0.0', resolve); });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
  const context = await browser.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let gisScripts = 0;
  await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await context.route('https://accounts.google.com/gsi/client', route => { gisScripts++; return route.abort(); });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/google/')) assert.equal(request.headers().authorization, undefined, 'browser sends only its HttpOnly session cookie, never a Google token');
    });
  });
  let page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('button', { name: '캘린더 연결', exact: true }).click();
  try { await page.locator('.event-card').getByText('서버 연결 테스트 일정', { exact: true }).waitFor(); }
  catch (error) {
    console.error(JSON.stringify({ path: new URL(page.url()).pathname, authError: new URL(page.url()).searchParams.get('auth_error'), routeResults, cookies: (await context.cookies()).map(({ name, httpOnly, secure }) => ({ name, httpOnly, secure })), visible: (await page.locator('body').innerText()).slice(0, 2200) }));
    throw error;
  }
  await page.getByText('서버 연결 테스트 할 일', { exact: true }).waitFor();
  assert.equal(authorizations, 1);
  assert.equal(refreshCount, 1, 'the short Google token was renewed server-side');
  const cookie = (await context.cookies()).find(cookie => cookie.name === '__Host-weekflow_session');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(await page.evaluate(() => document.cookie.includes('weekflow_session')), false);
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => /server-.*test-(?:token|refresh-token)/.test(value))), false);
  await page.reload();
  await page.locator('.event-card').getByText('서버 연결 테스트 일정', { exact: true }).waitFor();
  await page.close();
  page = await context.newPage();
  await page.goto(origin);
  await page.locator('.event-card').getByText('서버 연결 테스트 일정', { exact: true }).waitFor();
  await page.getByText('서버 연결 테스트 할 일', { exact: true }).waitFor();
  assert.equal(authorizations, 1, 'reopening the page must not open Google login');
  assert.equal(refreshCount, 1);
  assert.equal(gisScripts, 0, 'server mode must not load the browser token client');
  await page.getByRole('button', { name: '설정 및 연동', exact: true }).click();
  assert.equal(await page.getByLabel('Google OAuth 클라이언트 ID').count(), 0, 'server secrets/credentials are never requested in the app');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '할 일 백업 다운로드', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^weekflow-tasks-.*\.json$/);
  const beforeImport = await page.evaluate(() => JSON.parse(localStorage.getItem('weekflow.tasks.v1')));
  const imported = { id: 'migrated-local-task', title: '백업에서 가져온 할 일', due: '2026-10-21', priority: 'medium', done: false, tag: '업무' };
  await page.getByLabel('할 일 백업 가져오기').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'weekflow.tasks.v1', tasks: [imported] })) });
  await page.getByRole('status').getByText('1개의 할 일을 가져왔습니다.').waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('weekflow.tasks.v1'))), [...beforeImport, imported], 'import preserves existing local tasks');
  await page.getByRole('button', { name: '연결 해제', exact: true }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('서버 연결 테스트 할 일'));
  await page.keyboard.press('Escape');
  assert.equal((await context.cookies()).some(cookie => cookie.name === '__Host-weekflow_session'), false);
  await page.reload();
  await page.getByRole('button', { name: '캘린더 연결', exact: true }).waitFor();
  assert.equal(await page.locator('.event-card').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: actual worker + SQLite + browser: secure HttpOnly cookie, one Google authorization, server refresh, automatic login after reload/close/reopen, Calendar/Tasks proxy, no Google tokens in browser storage or API headers, no GIS script, CSP-compatible UI, logout clears session. External Google responses were simulated.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  db.close();
  globalThis.fetch = originalFetch;
}
