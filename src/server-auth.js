export async function readServerSession(signal) {
  const response = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
  // Static GitHub Pages retains browser login until the new server is deployed.
  if (response.status === 404 || (response.ok && !response.headers.get('Content-Type')?.includes('application/json'))) return null;
  if (!response.ok) throw new Error('로그인 서버 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.');
  const data = await response.json();
  if (!response.ok || data.enabled !== true) throw new Error('로그인 서버 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.');
  return data;
}

export async function logoutServer() {
  const response = await fetch('/auth/logout', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Weekflow-Request': '1' }, body: '{}',
  });
  if (!response.ok) throw new Error('로그아웃하지 못했습니다. 다시 시도해 주세요.');
}

export async function serverGoogleFetch(path, signal) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal });
    if (response.status !== 503 || response.headers.get('Retry-After') !== '1' || attempt === 3) return response;
    await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, 1000);
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}
