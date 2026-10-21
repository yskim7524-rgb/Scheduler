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

export function requestAccess(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: result => result.error ? reject(new Error('Google Calendar 접근이 허용되지 않았습니다. 다시 연결해 주세요.')) : resolve(result),
      error_callback: () => reject(new Error('로그인 창이 닫혔거나 차단되었습니다. 다시 연결해 주세요.')),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
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
