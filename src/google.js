import { normalizeGoogleEvent } from './domain.js';

let scriptPromise;
export function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google 로그인 모듈을 불러오지 못했습니다.'));
      script.onerror = () => reject(new Error('Google에 연결하지 못했습니다. 네트워크를 확인해 주세요.'));
      document.head.appendChild(script);
    }).catch(error => { scriptPromise = undefined; throw error; });
  }
  return scriptPromise;
}

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';

export function requestAccess(clientId, includeTasks = false) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: ['https://www.googleapis.com/auth/calendar.readonly', ...(includeTasks ? [TASKS_SCOPE] : [])].join(' '),
      include_granted_scopes: true,
      callback: result => result.error ? reject(new Error('Google Calendar 접근이 허용되지 않았습니다. 다시 연결해 주세요.')) : resolve(result),
      error_callback: () => reject(new Error('로그인 창이 닫혔거나 차단되었습니다. 다시 연결해 주세요.')),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

export async function fetchGoogleTasks(token, signal) {
  async function pages(path, params = {}) {
    const items = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ maxResults: '100', ...params });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await fetch(`https://tasks.googleapis.com/tasks/v1/${path}?${query}`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
      });
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'Google 연결이 만료되었습니다. 다시 연결해 주세요.' : response.status === 403 ? 'Google Tasks를 불러오지 못했습니다. Google Cloud에서 Google Tasks API를 활성화하고, 할 일 읽기 권한을 허용해 주세요.' : `Google Tasks 조회 실패 (${response.status}). 다시 불러와 주세요.`);
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }
  const lists = await pages('users/@me/lists');
  const tasks = [];
  // Bound concurrency while still reading every list and every response page.
  for (let offset = 0; offset < lists.length; offset += 4) {
    const batches = await Promise.all(lists.slice(offset, offset + 4).map(async list => {
      const items = await pages(`lists/${encodeURIComponent(list.id)}/tasks`, { showCompleted: 'true', showHidden: 'true', showAssigned: 'true', showDeleted: 'false' });
      return items.filter(task => !task.deleted).map(task => ({
        id: `${list.id}:${task.id}`, title: task.title || '(제목 없음)',
        listId: list.id, listTitle: list.title || '(목록 이름 없음)',
        done: task.status === 'completed',
        due: task.due && /^\d{4}-\d{2}-\d{2}T/.test(task.due) ? task.due.slice(0, 10) : null,
        notes: task.notes || '', parent: Boolean(task.parent),
      }));
    }));
    tasks.push(...batches.flat());
  }
  return { lists, tasks };
}

export async function fetchCalendarEvents(token, from, until, signal) {
  const events = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: until.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal,
    });
    if (response.status === 401) {
      const error = new Error('Google 연결이 만료되었습니다. 다시 연결해 주세요.');
      error.status = 401;
      throw error;
    }
    if (!response.ok) throw new Error(`일정을 불러오지 못했습니다 (${response.status}). Calendar API 사용 설정과 접근 권한을 확인해 주세요.`);
    const data = await response.json();
    events.push(...(data.items || []).map(normalizeGoogleEvent).filter(Boolean));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}
