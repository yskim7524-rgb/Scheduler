import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleTasks } from './google.js';

test('Google Tasks reads all lists/pages and retains undated, completed and assigned tasks', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (value, options) => {
    const url = new URL(value);
    seen.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (url.pathname.endsWith('/users/@me/lists')) return Response.json(url.searchParams.has('pageToken') ? { items: [{ id: 'personal', title: '개인' }] } : { items: [{ id: 'work', title: '업무' }], nextPageToken: 'lists-2' });
    assert.equal(url.searchParams.get('showCompleted'), 'true');
    assert.equal(url.searchParams.get('showHidden'), 'true');
    assert.equal(url.searchParams.get('showAssigned'), 'true');
    assert.equal(url.searchParams.has('dueMin'), false, 'undated tasks must not be excluded');
    if (url.pathname.includes('/work/')) return Response.json(url.searchParams.has('pageToken') ? { items: [{ id: 'done', title: '완료한 할 일', status: 'completed' }] } : { items: [{ id: 'proposal', title: '샘플 업무 문서 작성', status: 'needsAction', due: '2026-10-20T00:00:00.000Z' }], nextPageToken: 'tasks-2' });
    return Response.json({ items: [{ id: 'no-date', title: '마감 없는 할 일', status: 'needsAction' }, { id: 'gone', deleted: true }] });
  });
  const data = await fetchGoogleTasks('test-token');
  assert.equal(data.lists.length, 2);
  assert.equal(data.tasks.length, 3);
  assert.equal(data.tasks.find(task => task.title === '샘플 업무 문서 작성').due, '2026-10-20');
  assert.equal(data.tasks.find(task => task.title === '마감 없는 할 일').due, null);
  assert.equal(data.tasks.find(task => task.title === '완료한 할 일').done, true);
  assert.equal(seen.length, 5);
});

test('Google Tasks access errors explain the missing API without affecting local tasks', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await assert.rejects(fetchGoogleTasks('test-token'), error => error.status === 403 && error.message.includes('Google Tasks API'));
});

test('Google Tasks expired tokens are distinguishable from API enablement errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await assert.rejects(fetchGoogleTasks('test-token'), error => error.status === 401 && error.message.includes('만료'));
});
