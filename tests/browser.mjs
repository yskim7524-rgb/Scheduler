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
  const thisWeek = page.getByRole('region', { name: '이번 주 일정', exact: true });
  const nextWeek = page.getByRole('region', { name: '다음 주 일정', exact: true });
  assert.equal(await thisWeek.locator('.day-column').count(), 7);
  assert.equal(await nextWeek.locator('.day-column').count(), 7);
  assert.equal(await thisWeek.locator('.event-card').count(), 9);
  assert.equal(await nextWeek.locator('.event-card').count(), 3);
  assert.equal(await page.evaluate(() => {
    const panels = document.querySelectorAll('.calendar-panel');
    return panels[0].nextElementSibling === panels[1];
  }), true, 'next week is immediately below this week');
  await nextWeek.getByRole('button', { name: /다음 스프린트 미팅/ }).click();
  await page.getByRole('dialog').getByRole('heading', { name: '다음 스프린트 미팅', exact: true }).waitFor();
  await page.keyboard.press('Escape');
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

  assert.equal(await page.getByRole('region', { name: '오늘 집중할 일', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /오늘 집중/ }).count(), 0);
  await list.getByRole('button', { name: '기획안 최종 제출 완료', exact: true }).click();
  await page.reload();
  await navigate(page, /^해야 할 일/);
  assert.equal((await savedTasks(page)).find(task => task.id === 'a').done, true);
  await list.getByRole('button', { name: '리뷰 피드백 수정', exact: true }).click();
  await page.getByLabel('무엇을 해야 하나요?').fill('리뷰 최종 반영');
  await page.getByRole('button', { name: '변경 사항 저장', exact: true }).click();

  await page.clock.setSystemTime(new Date('2026-10-22T03:00:00Z'));
  await page.clock.runFor(60100);
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
  await page.locator('.calendar-agenda').first().waitFor({ state: 'visible' });
  await page.locator('.calendar-agenda').nth(1).waitFor({ state: 'visible' });
  assert.equal(await nextWeek.locator('.agenda-event').count(), 3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const agendaEvent = page.locator('.agenda-event').first();
  await agendaEvent.click();
  await page.getByRole('dialog').getByRole('heading', { name: '일정 자세히 보기' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '주간 표 보기', exact: true }).click();
  await page.locator('.calendar-scroll').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '일정 목록 보기', exact: true }).click();
  await navigate(page, '다음 주 일정');
  assert.equal(await page.locator('.agenda-event').count(), 3);
  await page.context().close();
  console.log('PASS: legacy data, editing/cancel, postpone, focus controls removed, completion, persistence, midnight rollover, deadline groups, title validation, delete, two adjacent weeks, mobile list/grid and next-week event details.');

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
  assert.equal(await googlePage.getByRole('region', { name: '이번 주 일정', exact: true }).locator('.event-card').count(), 9);
  assert.equal(await googlePage.getByRole('region', { name: '다음 주 일정', exact: true }).locator('.event-card').count(), 3);
  await googlePage.getByText('샘플 일정으로 둘러보고 있어요', { exact: true }).waitFor();
  const tasksPage = await newPage(legacyTasks);
  let tasksFailure = 0;
  await tasksPage.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'tasks-test-token',expires_in:3600,scope:c.scope})}),revoke:(t,cb)=>cb()}}}` }));
  await tasksPage.route('https://www.googleapis.com/calendar/v3/**', route => route.fulfill({ json: { items: [{ id: 'calendar', summary: '기존 캘린더 일정', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }] } }));
  await tasksPage.route('https://tasks.googleapis.com/tasks/v1/**', route => {
    assert.equal(route.request().headers().authorization, 'Bearer tasks-test-token');
    if (tasksFailure) return route.fulfill({ status: tasksFailure, json: {} });
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/users/@me/lists')) return route.fulfill({ json: url.searchParams.has('pageToken') ? { items: [{ id: 'personal', title: '개인' }] } : { items: [{ id: 'work', title: '업무' }], nextPageToken: 'list-page-2' } });
    assert.equal(url.searchParams.get('showHidden'), 'true');
    assert.equal(url.searchParams.get('showAssigned'), 'true');
    if (url.pathname.includes('/work/')) return route.fulfill({ json: url.searchParams.has('pageToken') ? { items: [{ id: 'done', title: '완료된 Google 할 일', status: 'completed' }] } : { items: [{ id: 'proposal', title: '샘플 업무 문서 작성', due: '2026-10-20T00:00:00.000Z', status: 'needsAction' }], nextPageToken: 'task-page-2' } });
    return route.fulfill({ json: { items: [{ id: 'undated', title: '마감일 없는 Google 할 일', status: 'needsAction' }] } });
  });
  await tasksPage.goto(baseURL);
  await tasksPage.getByRole('button', { name: 'Google Tasks 연결', exact: true }).click();
  await tasksPage.getByLabel('Google OAuth 클라이언트 ID').fill('test.apps.googleusercontent.com');
  assert.equal(await tasksPage.getByLabel('Google Tasks 할 일도 함께 연결').isChecked(), true);
  await tasksPage.getByRole('button', { name: 'Google 계정으로 연결', exact: true }).click();
  const googleTasksPanel = tasksPage.getByRole('region', { name: 'Google Tasks 할 일', exact: true });
  await googleTasksPanel.getByText('샘플 업무 문서 작성', { exact: true }).waitFor();
  await tasksPage.locator('.event-card.google-task').getByText('샘플 업무 문서 작성', { exact: true }).waitFor();
  await googleTasksPanel.getByText('마감일 없는 Google 할 일', { exact: true }).waitFor();
  assert.equal(await googleTasksPanel.getByText('완료된 Google 할 일', { exact: true }).count(), 0);
  await googleTasksPanel.getByLabel('Google 완료 항목 보기').check();
  await googleTasksPanel.getByText('완료된 Google 할 일', { exact: true }).waitFor();
  await googleTasksPanel.getByLabel('Google 할 일 목록', { exact: true }).selectOption('personal');
  assert.equal(await googleTasksPanel.getByText('샘플 업무 문서 작성', { exact: true }).count(), 0);
  await googleTasksPanel.getByText('마감일 없음', { exact: true }).waitFor();
  await googleTasksPanel.getByLabel('Google 할 일 목록', { exact: true }).selectOption('all');
  tasksFailure = 403;
  await googleTasksPanel.getByRole('button', { name: '할 일 새로고침', exact: true }).click();
  await googleTasksPanel.getByRole('alert').getByText(/Google Tasks를 불러오지 못했습니다/).waitFor();
  await tasksPage.locator('.event-card').getByText('기존 캘린더 일정', { exact: true }).waitFor();
  assert.equal((await savedTasks(tasksPage)).length, legacyTasks.length);
  tasksFailure = 0;
  await googleTasksPanel.getByRole('button', { name: 'Google 할 일 다시 불러오기', exact: true }).click();
  await googleTasksPanel.getByText('샘플 업무 문서 작성', { exact: true }).waitFor();
  await navigate(tasksPage, /^해야 할 일/);
  await tasksPage.getByRole('region', { name: 'Google Tasks 할 일', exact: true }).getByText('샘플 업무 문서 작성', { exact: true }).waitFor();
  await tasksPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await tasksPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await tasksPage.evaluate(() => Object.values(localStorage).some(value => value.includes('tasks-test-token'))), false);
  console.log('PASS: Google Tasks consent, all list/task pages, 샘플 업무 문서 작성, undated/completed items, list filter, API enablement errors, calendar independence, preserved local tasks and mobile layout.');
  assert.deepEqual(errors, []);
  console.log('PASS: simulated Google OAuth/pagination, last sync, 403 retry, 401 reconnect, expiry, reload, explicit sample mode; no tokens in storage; no JavaScript errors.');
  console.log(remote ? `Public assets validated from ${baseURL} using TLS-verified curl transport. Actual Google account consent was not exercised.` : 'Production preview verified. Actual Google account consent was not exercised.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
