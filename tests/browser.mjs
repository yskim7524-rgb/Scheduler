import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const baseURL = process.env.WEEKFLOW_TEST_URL || 'http://127.0.0.1:4197/';
const remote = Boolean(process.env.WEEKFLOW_TEST_URL);
const legacyTasks = [
  { id: 'a', title: '기획안 정리', due: '2026-10-21', priority: 'high', done: false, tag: '업무' },
  { id: 'b', title: '리뷰 피드백', due: '2026-10-20', priority: 'medium', done: false, tag: '업무' },
  { id: 'c', title: '자료 읽기', due: '2026-10-23', priority: 'low', done: false, tag: '개인' },
  { id: 'd', title: '다음 주 준비', due: '2026-10-25', priority: 'medium', done: false, tag: '업무' },
  { id: 'e', title: '이미 완료한 일', due: '2026-10-20', priority: 'low', done: true, tag: '학습' },
  { id: 'z', title: '지난 보고서', due: '2026-10-19', priority: 'high', done: false, tag: '업무' },
];
const errors = [];
let server;
let browser;

async function newPage(seed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  if (seed) await context.addInitScript(tasks => {
    if (!localStorage.getItem('weekflow.tasks.v1')) localStorage.setItem('weekflow.tasks.v1', JSON.stringify(tasks));
  }, seed);
  const page = await context.newPage();
  page.setDefaultTimeout(remote ? 30000 : 10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-21T03:00:00Z') });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  if (remote) {
    // Use the system CA trust store for the cloud proxy instead of bypassing TLS
    // validation when Chromium does not trust the proxy CA. Render exact public bytes.
    const origin = new URL(baseURL).origin;
    await page.route(`${origin}/**`, async route => {
      try {
        const url = route.request().url();
        const body = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '25', url], { maxBuffer: 5 * 1024 * 1024 });
        await route.fulfill({ contentType: /\.js(?:\?|$)/.test(url) ? 'text/javascript' : /\.css(?:\?|$)/.test(url) ? 'text/css' : 'text/html', body });
      } catch { await route.abort(); }
    });
  }
  return page;
}
const savedTasks = page => page.evaluate(() => JSON.parse(localStorage.getItem('weekflow.tasks.v1')));
const navigate = (page, name) => page.getByRole('navigation').getByRole('button', { name }).click();

try {
  if (!remote) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4197', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let serverError = '';
    server.stderr.on('data', chunk => { serverError += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Preview server failed: ${serverError}`);
      try { if ((await fetch(baseURL)).ok) { ready = true; break; } } catch { /* Wait for startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Preview server did not start.');
  }
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox'],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  });
  const page = await newPage(legacyTasks);
  await page.goto(baseURL);
  await page.getByRole('heading', { name: '좋은 한 주를 만들어봐요' }).waitFor();
  assert.equal((await savedTasks(page)).length, legacyTasks.length, 'existing tasks are preserved');
  await navigate(page, /^해야 할 일/);
  const list = page.locator('.full-panel .task-list');
  await list.getByRole('button', { name: '기획안 정리 수정', exact: true }).click();
  await page.getByLabel('무엇을 해야 하나요?').fill('기획안 최종 제출');
  await page.getByLabel('마감일').fill('2026-10-22');
  await page.getByLabel('우선순위', { exact: true }).selectOption('low');
  await page.getByLabel('분류', { exact: true }).selectOption('개인');
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  const edited = (await savedTasks(page)).find(task => task.id === 'a');
  assert.deepEqual(edited, { ...legacyTasks[0], title: '기획안 최종 제출', due: '2026-10-22', priority: 'low', tag: '개인' });
  await list.getByRole('button', { name: '기획안 최종 제출 수정', exact: true }).click();
  await page.getByLabel('무엇을 해야 하나요?').fill('저장하지 않을 내용');
  await page.keyboard.press('Escape');
  assert.equal((await savedTasks(page)).find(task => task.id === 'a').title, '기획안 최종 제출');
  await list.getByRole('button', { name: '리뷰 피드백 내일로 미루기', exact: true }).click();
  assert.equal((await savedTasks(page)).find(task => task.id === 'b').due, '2026-10-22');

  for (const title of ['기획안 최종 제출', '리뷰 피드백', '자료 읽기']) await list.getByRole('button', { name: `${title} 오늘 집중 선택`, exact: true }).click();
  const focus = page.getByRole('region', { name: '오늘 집중할 일', exact: true });
  assert.equal(await focus.locator('.task-row').count(), 3);
  await list.getByRole('button', { name: '다음 주 준비 오늘 집중 선택', exact: true }).click();
  await focus.getByRole('status').getByText(/최대 3개/).waitFor();
  assert.equal((await savedTasks(page)).filter(task => task.focusDate === '2026-10-21').length, 3);
  await focus.getByRole('button', { name: '기획안 최종 제출 완료', exact: true }).click();
  await focus.getByText('1개 완료 · 2개 남음', { exact: true }).waitFor();
  await focus.getByRole('button', { name: '기획안 최종 제출 오늘 집중 해제', exact: true }).click();
  await list.getByRole('button', { name: '다음 주 준비 오늘 집중 선택', exact: true }).click();
  await page.reload();
  assert.equal(await focus.locator('.task-row').count(), 3);
  await focus.getByRole('button', { name: '리뷰 피드백 수정', exact: true }).click();
  await page.getByLabel('무엇을 해야 하나요?').fill('리뷰 최종 반영');
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();
  assert.equal((await savedTasks(page)).find(task => task.id === 'b').focusDate, '2026-10-21');

  await page.clock.setSystemTime(new Date('2026-10-22T03:00:00Z'));
  await page.clock.runFor(60100);
  assert.equal(await focus.locator('.task-row').count(), 0, 'yesterday’s focus is cleared from today');
  assert.equal((await savedTasks(page)).find(task => task.id === 'a').done, true);
  await navigate(page, /^마감 모아보기/);
  await page.getByRole('region', { name: '오늘 마감', exact: true }).getByText('리뷰 최종 반영', { exact: true }).waitFor();
  await page.getByRole('region', { name: '지난 마감', exact: true }).getByText('지난 보고서', { exact: true }).waitFor();
  await page.getByRole('region', { name: '다가오는 마감', exact: true }).getByText('자료 읽기', { exact: true }).waitFor();
  assert.equal(await page.locator('.deadline-groups').getByText('기획안 최종 제출', { exact: true }).count(), 0);

  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('무엇을 해야 하나요?').fill('   ');
  await page.getByRole('dialog').getByRole('button', { name: '할 일 추가', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 1, 'whitespace title is rejected');
  await page.getByLabel('무엇을 해야 하나요?').fill('추가한 새 할 일');
  await page.getByRole('dialog').getByRole('button', { name: '할 일 추가', exact: true }).click();
  assert.equal((await savedTasks(page)).length, legacyTasks.length + 1);
  await navigate(page, /^해야 할 일/);
  await list.getByRole('button', { name: '추가한 새 할 일 삭제', exact: true }).click();
  assert.equal((await savedTasks(page)).length, legacyTasks.length);
  await navigate(page, '대시보드');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.calendar-agenda').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const agendaEvent = page.locator('.agenda-event').first();
  await agendaEvent.click();
  await page.getByRole('dialog').getByRole('heading', { name: '일정 자세히 보기' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '주간 표 보기', exact: true }).click();
  await page.locator('.calendar-scroll').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '일정 목록 보기', exact: true }).click();
  await navigate(page, '다음 주 일정');
  assert.equal(await page.locator('.agenda-event').count(), 3);
  await page.context().close();
  console.log('PASS: legacy data, editing/cancel, postpone, 3-focus limit, completion/unpin, persistence, midnight rollover, deadline groups, title validation, delete, mobile list/grid and event details.');

  const googlePage = await newPage();
  let oauthCalls = 0;
  let failure = 0;
  await googlePage.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>{window.oauthCalls=(window.oauthCalls||0)+1;c.callback({access_token:'test-only-token',expires_in:120})}}),revoke:(t,cb)=>cb()}}}` }));
  await googlePage.route('https://www.googleapis.com/calendar/v3/**', route => {
    assert.equal(route.request().headers().authorization, 'Bearer test-only-token');
    if (failure) return route.fulfill({ status: failure, json: { error: 'simulated failure' } });
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.searchParams.has('pageToken') ? { items: [] } : { nextPageToken: 'next', items: [{ id: 'google1', summary: 'Google 테스트 일정', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }] } });
  });
  await googlePage.goto(baseURL);
  await googlePage.getByRole('button', { name: '캘린더 연결', exact: true }).click();
  assert.equal(await googlePage.locator('.event-card').count(), 0, 'personal mode does not show samples');
  await googlePage.getByLabel('Google OAuth 클라이언트 ID').fill('test.apps.googleusercontent.com');
  await googlePage.getByRole('button', { name: 'Google 계정으로 연결', exact: true }).click();
  await googlePage.locator('.event-card').getByText('Google 테스트 일정', { exact: true }).waitFor();
  await googlePage.getByText(/마지막 정상 갱신/).waitFor();
  assert.equal(await googlePage.locator('.event-card').count(), 1);
  assert.equal(await googlePage.evaluate(() => Object.values(localStorage).some(v => v.includes('test-only-token'))), false);
  oauthCalls = await googlePage.evaluate(() => window.oauthCalls);
  failure = 403;
  await googlePage.getByRole('button', { name: '새로고침', exact: true }).click();
  await googlePage.getByRole('alert').getByText(/403/).waitFor();
  await googlePage.getByText('일정 갱신에 실패했어요', { exact: true }).waitFor();
  failure = 0;
  await googlePage.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await googlePage.locator('.event-card').getByText('Google 테스트 일정', { exact: true }).waitFor();
  assert.equal(await googlePage.evaluate(() => window.oauthCalls), oauthCalls, 'retry does not open OAuth again');
  failure = 401;
  await googlePage.getByRole('button', { name: '새로고침', exact: true }).click();
  await googlePage.getByRole('alert').getByText(/연결이 만료/).waitFor();
  await googlePage.getByText('Google 다시 연결이 필요해요', { exact: true }).waitFor();
  assert.equal(await googlePage.locator('.event-card').count(), 0);
  failure = 0;
  await googlePage.getByRole('region', { name: '캘린더 연결 상태' }).getByRole('button', { name: '다시 연결', exact: true }).click();
  await googlePage.locator('.event-card').getByText('Google 테스트 일정', { exact: true }).waitFor();
  await googlePage.clock.fastForward(121000);
  await googlePage.getByText('Google 다시 연결이 필요해요', { exact: true }).waitFor();
  assert.equal(await googlePage.locator('.event-card').count(), 0, 'expiry never silently returns sample events');
  await googlePage.reload();
  await googlePage.getByText('Google 다시 연결이 필요해요', { exact: true }).waitFor();
  assert.equal(await googlePage.locator('.event-card').count(), 0);
  await googlePage.getByRole('button', { name: '샘플 보기', exact: true }).click();
  assert.equal(await googlePage.locator('.event-card').count(), 9);
  await googlePage.getByText('샘플 일정으로 둘러보고 있어요', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: simulated Google OAuth/pagination, last sync, 403 retry, 401 reconnect, expiry, reload, explicit sample mode; no tokens in storage; no JavaScript errors.');
  console.log(remote ? `Public assets validated from ${baseURL} using TLS-verified curl transport. Actual Google account consent was not exercised.` : 'Production preview verified. Actual Google account consent was not exercised.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
