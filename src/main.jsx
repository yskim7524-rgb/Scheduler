import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Circle, Clock3, ExternalLink, Flag, LayoutDashboard, Link2, ListTodo, LoaderCircle, MapPin, MoreHorizontal, Plus, RefreshCw, Settings2, Sparkles, Trash2, Unplug, X } from 'lucide-react';
import { addDays, dateKey, dayDifference, demoEvents, demoTasks, eventsForDay, weekStart } from './domain.js';
import { fetchCalendarEvents, loadGoogleIdentity, requestAccess } from './google.js';
import './styles.css';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const PRIORITY = { high: '높음', medium: '보통', low: '낮음' };
const formatTime = value => new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const shortDate = date => `${date.getMonth() + 1}월 ${date.getDate()}일`;
const storageKey = 'weekflow.tasks.v1';
function readTasks() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(value) && value.every(t => typeof t.id === 'string' && typeof t.title === 'string' && typeof t.done === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(t.due) && t.priority in PRIORITY && typeof t.tag === 'string')) return value;
  } catch { /* Storage may be unavailable. */ }
  return demoTasks();
}
function storedClientId() {
  try { return localStorage.getItem('weekflow.google-client-id') || import.meta.env.VITE_GOOGLE_CLIENT_ID || ''; }
  catch { return import.meta.env.VITE_GOOGLE_CLIENT_ID || ''; }
}
function GoogleMark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.7Z"/><path fill="#34A853" d="M12 22c2.7 0 5-1 6.7-2.5l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.4-2.7Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.7C7.2 7.8 9.4 6 12 6Z"/></svg>;
}

function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={20}/></button></div>
    {children}
  </dialog>;
}

function App() {
  const [today, setToday] = useState(() => new Date());
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState('dashboard');
  const [tasks, setTasks] = useState(readTasks);
  const [taskFilter, setTaskFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [clientId, setClientId] = useState(storedClientId);
  const [token, setToken] = useState(null);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const todayKey = dateKey(today);
  const start = addDays(weekStart(today), offset * 7);
  const end = addDays(start, 6);
  const nextStart = addDays(start, 7);
  const events = token ? googleEvents : demoEvents(today);
  const weekEvents = events.filter(event => Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i))).some(key => eventsForDay([event], key).length));
  const nextEvents = events.filter(event => Array.from({ length: 7 }, (_, i) => dateKey(addDays(nextStart, i))).some(key => eventsForDay([event], key).length));
  const openTasks = tasks.filter(t => !t.done);
  const completed = tasks.length - openTasks.length;
  const deadlines = [...openTasks].sort((a, b) => a.due.localeCompare(b.due));
  const urgent = openTasks.filter(t => dayDifference(t.due, todayKey) <= 3).length;
  const visibleTasks = tasks.filter(t => taskFilter === 'all' ? true : taskFilter === 'done' ? t.done : !t.done);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(tasks)); setStorageError(''); }
    catch { setStorageError('브라우저 저장 공간을 사용할 수 없어 변경 사항이 새로고침 후 유지되지 않을 수 있습니다.'); }
  }, [tasks]);
  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (modal === 'settings' || clientId) loadGoogleIdentity().catch(() => {});
  }, [modal, clientId]);
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => { setToken(null); setGoogleEvents([]); setError('Google 연결이 만료되었습니다. 다시 연결해 주세요.'); }, Math.max(0, token.expires - Date.now()));
    return () => clearTimeout(timer);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setGoogleEvents([]);
    fetchCalendarEvents(token.value, start, addDays(start, 14), controller.signal)
      .then(result => { setGoogleEvents(result); setLastSync(new Date()); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, offset, todayKey, refresh]);

  async function connect() {
    if (!clientId.trim()) { setModal('settings'); return; }
    setConnecting(true);
    setError('');
    try {
      await loadGoogleIdentity();
      const result = await requestAccess(clientId.trim());
      setToken({ value: result.access_token, expires: Date.now() + Number(result.expires_in || 3600) * 1000 });
      setModal(null);
    } catch (e) { setError(e.message); }
    finally { setConnecting(false); }
  }
  function disconnect() {
    if (token) window.google?.accounts?.oauth2.revoke(token.value, () => {});
    setToken(null); setGoogleEvents([]); setLastSync(null); setError(''); setLoading(false);
  }
  function addTask(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title')).trim();
    if (!title) return;
    setTasks(previous => [...previous, { id: crypto.randomUUID(), title, due: String(data.get('due')), priority: String(data.get('priority')), tag: String(data.get('tag')), done: false }]);
    setModal(null);
  }
  function openView(nextView) { setView(nextView); if (nextView === 'next') setOffset(1); else if (nextView === 'dashboard') setOffset(0); }
  const toggleTask = id => setTasks(previous => previous.map(task => task.id === id ? { ...task, done: !task.done } : task));
  const relativeDeadline = due => {
    const diff = dayDifference(due, todayKey);
    return diff < 0 ? `${-diff}일 지남` : diff === 0 ? 'D-DAY' : `D-${diff}`;
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); openView('dashboard'); }}><span className="brand-icon"><CalendarDays size={22}/></span>weekflow<span className="brand-dot">.</span></a>
      <div className="workspace-label">MY WORKSPACE</div>
      <nav aria-label="주 메뉴">
        <button className={view === 'dashboard' ? 'nav-link active' : 'nav-link'} onClick={() => openView('dashboard')}><LayoutDashboard size={19}/>대시보드<span className="nav-dot"/></button>
        <button className={view === 'next' ? 'nav-link active' : 'nav-link'} onClick={() => openView('next')}><CalendarDays size={19}/>다음 주 일정</button>
        <button className={view === 'tasks' ? 'nav-link active' : 'nav-link'} onClick={() => openView('tasks')}><ListTodo size={19}/>해야 할 일<span className="nav-count">{openTasks.length}</span></button>
        <button className={view === 'deadlines' ? 'nav-link active' : 'nav-link'} onClick={() => openView('deadlines')}><Flag size={19}/>마감 모아보기{urgent > 0 && <span className="nav-count urgent">{urgent}</span>}</button>
      </nav>
      <div className="sidebar-separator"/>
      <div className="workspace-label">CONNECTED APPS</div>
      <button className="calendar-sidebar" onClick={() => setModal('settings')}><GoogleMark/><span>Google Calendar<small><i className={token ? 'status-dot connected' : 'status-dot'}/>{token ? '연결됨 · 기본 캘린더' : '아직 연결되지 않았어요'}</small></span><ChevronRight size={15}/></button>
      <div className="sidebar-bottom"><div className="little-note"><Sparkles size={19}/><strong>조금 더 가벼운 한 주</strong><p>복잡한 일정은 정리하고,<br/>중요한 일에 집중하세요.</p><span>MAKE ROOM FOR WHAT MATTERS</span></div><button className="nav-link" onClick={() => setModal('settings')}><Settings2 size={18}/>설정 및 연동</button><div className="profile"><span className="avatar">나</span><div><strong>나의 워크스페이스</strong><small>나만의 속도로, 차근차근</small></div><MoreHorizontal size={18}/></div></div>
    </aside>

    <main>
      <header className="topbar"><div className="breadcrumb">워크스페이스 <ChevronRight size={13}/><span>{{ dashboard: '주간 대시보드', next: '다음 주 일정', tasks: '해야 할 일', deadlines: '마감 모아보기' }[view]}</span></div><span className="top-date"><span className="live-dot"/>{today.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span></header>
      <div className="main-content">
        <div className="page-heading"><div><div className="eyebrow">YOUR WEEK, AT A GLANCE</div><h1>{view === 'tasks' ? '작은 실천이 모이는 곳' : view === 'deadlines' ? '놓치지 않도록, 마감 모아보기' : view === 'next' ? '한발 먼저 준비하는 다음 주' : '좋은 한 주를 만들어봐요'}<span className="heading-spark">✳</span></h1><p>{view === 'dashboard' ? '일정은 한눈에, 해야 할 일은 차근차근. 이번 주의 흐름을 확인하세요.' : '중요한 일을 놓치지 않고, 나만의 속도로 계획해 보세요.'}</p></div><button className="primary-button" onClick={() => setModal('task')}><Plus size={17}/>할 일 추가</button></div>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={connect} disabled={connecting}>다시 연결</button><button aria-label="오류 닫기" onClick={() => setError('')}><X size={16}/></button></div>}
        {storageError && <div className="error-banner" role="alert">{storageError}</div>}
        <section className="connection-banner"><span className="google-tile"><GoogleMark/></span><div><strong>{token ? 'Google Calendar와 연결되어 있어요' : '모든 일정을 한곳에서 만나보세요'}</strong><p>{token ? `기본 캘린더의 일정을 읽기 전용으로 표시합니다.${lastSync ? ` 마지막 동기화 ${formatTime(lastSync)}` : ''}` : 'Google Calendar를 연결하면 내 일정이 자동으로 나타나요. 현재는 샘플 일정입니다.'}</p></div><button className="light-button" onClick={token ? () => setRefresh(n => n + 1) : connect} disabled={loading || connecting}>{loading || connecting ? <LoaderCircle className="spin" size={16}/> : token ? <RefreshCw size={15}/> : <Link2 size={15}/>} {token ? '새로고침' : '캘린더 연결'}<ArrowUpRight size={15}/></button></section>

        <section className="stats-grid" aria-label="주간 요약">
          {[{ label: offset === 0 ? '이번 주 일정' : '선택한 주 일정', value: weekEvents.length, unit: '개', icon: CalendarDays, tone: 'mint', note: token ? 'Google 기본 캘린더' : '샘플 캘린더', sub: '한 주의 약속을 확인하세요' }, { label: '남은 할 일', value: openTasks.length, unit: '개', icon: ListTodo, tone: 'blue', note: `전체 ${tasks.length}개 중`, sub: '하나씩 가볍게 지워봐요' }, { label: '다가오는 마감', value: urgent, unit: '개', icon: Flag, tone: 'peach', note: '3일 이내 · 지연 포함', sub: '조금만 더 힘내볼까요?' }, { label: '완료한 할 일', value: completed, unit: '개', icon: CheckCheck, tone: 'purple', note: '잘하고 있어요!', sub: '작은 성취가 쌓이고 있어요' }].map(({ label, value, unit, icon: Icon, tone, note, sub }) => <article className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={18}/></span></div><div className="stat-value">{value}<span>{unit}</span><small>{note}</small></div><p>{sub}</p></article>)}
        </section>

        {(view === 'dashboard' || view === 'next') && <>
          <section className="panel calendar-panel"><div className="panel-heading"><div className="section-title"><CalendarDays size={19}/><h2>{offset === 0 ? '이번 주 일정' : offset === 1 ? '다음 주 일정' : '주간 일정'}</h2><span className="count-badge">{weekEvents.length}</span></div><div className="week-controls"><span>{start.getFullYear()}. {start.getMonth() + 1}. {start.getDate()} – {end.getMonth() + 1}. {end.getDate()}</span><button className="today-button" onClick={() => setOffset(0)}>이번 주</button><button className="icon-button" aria-label="이전 주" onClick={() => setOffset(n => n - 1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="다음 주" onClick={() => setOffset(n => n + 1)}><ChevronRight size={18}/></button></div></div>
            <div className="calendar-scroll"><div className="week-grid">{DAYS.map((day, i) => {
              const date = addDays(start, i); const key = dateKey(date); const dayEvents = eventsForDay(events, key); const isToday = key === todayKey;
              return <div className={`day-column ${isToday ? 'is-today' : ''} ${i > 4 ? 'weekend' : ''}`} key={day}><div className="day-heading"><span>{day}{isToday && <small>TODAY</small>}</span><strong className={isToday ? 'today-number' : ''}>{date.getDate()}</strong></div><div className="day-events">{loading ? <span className="loading-day">불러오는 중…</span> : dayEvents.length ? dayEvents.map(event => <button className={`event-card ${event.category}`} key={event.id} onClick={() => { setSelectedEvent(event); setModal('event'); }}><span className="event-time">{event.allDay ? '종일' : formatTime(event.start)}</span><strong>{event.title}</strong>{event.location && <span className="event-location"><MapPin size={10}/>{event.location}</span>}</button>) : <span className="empty-day">여유로운 하루</span>}</div></div>;
            })}</div></div><div className="calendar-footer"><span><i className="legend-dot mint-dot"/>{token ? 'Google 일정' : '업무 일정'}{!token && <><i className="legend-dot purple-dot"/>개인 일정<i className="legend-dot blue-dot"/>집중 시간</>}</span><small>{token ? '시간은 기기의 현지 시간 기준으로 표시됩니다' : '샘플 데이터 · Google 연결 시 실제 일정으로 전환'}</small></div>
          </section>
          <div className="lower-grid">
            <section className="panel task-panel"><div className="panel-heading"><div className="section-title"><ListTodo size={19}/><h2>해야 할 일</h2><span className="count-badge">{openTasks.length}</span></div><button className="text-button" onClick={() => openView('tasks')}>전체 보기<ChevronRight size={15}/></button></div><div className="task-tabs">{[['all', '전체'], ['open', '진행 중'], ['done', '완료']].map(([key, label]) => <button key={key} className={taskFilter === key ? 'selected' : ''} onClick={() => setTaskFilter(key)}>{label}</button>)}</div><div className="task-list">{visibleTasks.slice(0, 4).map(task => <TaskRow key={task.id} task={task} onToggle={toggleTask} todayKey={todayKey}/>)}{!visibleTasks.length && <div className="empty-state"><CheckCheck size={26}/><p>표시할 할 일이 없어요.</p></div>}</div><button className="add-task-line" onClick={() => setModal('task')}><Plus size={16}/>새로운 할 일 추가하기</button></section>
            <section className="panel deadline-panel"><div className="panel-heading"><div className="section-title"><Flag size={18}/><h2>다가오는 마감</h2></div><span className="muted-small">놓치지 말아요</span></div><div className="deadline-list">{deadlines.slice(0, 3).map(task => <div className="deadline-row" key={task.id}><div className={`deadline-date ${dayDifference(task.due, todayKey) <= 0 ? 'due-now' : ''}`}><small>{new Date(`${task.due}T00:00:00`).getMonth() + 1}월</small><strong>{Number(task.due.slice(-2))}</strong></div><div><strong>{task.title}</strong><small>{task.tag} <span>·</span> {PRIORITY[task.priority]} 우선순위</small></div><span className={`dday ${dayDifference(task.due, todayKey) <= 0 ? 'red' : ''}`}>{relativeDeadline(task.due)}</span></div>)}{!deadlines.length && <div className="empty-state"><Sparkles size={26}/><p>남은 마감이 없어요. 잘했어요!</p></div>}</div><button className="deadline-more" onClick={() => openView('deadlines')}>모든 마감 보기<ArrowUpRight size={14}/></button></section>
          </div>
          <section className="next-week-strip"><span className="next-week-icon"><CalendarDays size={20}/></span><div><strong>다음 주, 미리 살펴볼까요?</strong><p>{shortDate(nextStart)} – {shortDate(addDays(nextStart, 6))} <span>·</span> {nextEvents.length}개의 일정이 기다리고 있어요</p></div><div className="next-previews">{nextEvents.slice(0, 2).map(event => <button key={event.id} onClick={() => { setSelectedEvent(event); setModal('event'); }}><span className="legend-dot mint-dot"/>{event.title}</button>)}</div><button className="icon-button next-arrow" aria-label="선택한 주의 다음 주 보기" onClick={() => setOffset(n => n + 1)}><ChevronRight size={20}/></button></section>
        </>}

        {view === 'tasks' && <section className="panel full-panel"><div className="panel-heading"><div className="section-title"><ListTodo size={19}/><h2>나의 할 일</h2></div><label className="completed-toggle"><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)}/>완료한 항목 보기</label></div><div className="task-list">{tasks.filter(task => showCompleted || !task.done).map(task => <TaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={id => setTasks(previous => previous.filter(t => t.id !== id))} todayKey={todayKey}/>)}{!tasks.some(task => showCompleted || !task.done) && <div className="empty-state"><CheckCheck size={32}/><p>할 일을 모두 마쳤어요. 새로운 계획을 추가해 보세요.</p></div>}</div><button className="add-task-line" onClick={() => setModal('task')}><Plus size={17}/>새로운 할 일 추가하기</button></section>}
        {view === 'deadlines' && <section className="panel full-panel"><div className="panel-heading"><div className="section-title"><Flag size={19}/><h2>마감일 순서로 보기</h2><span className="count-badge">{deadlines.length}</span></div><span className="muted-small">완료하지 않은 할 일</span></div>{deadlines.map(task => <div className="deadline-full-row" key={task.id}><button className="check-button" aria-label={`${task.title} 완료`} onClick={() => toggleTask(task.id)}><Circle size={21}/></button><div><strong>{task.title}</strong><small>{task.due} · {task.tag}</small></div><span className={`priority ${task.priority}`}><Flag size={11}/>{PRIORITY[task.priority]}</span><span className={`dday ${dayDifference(task.due, todayKey) <= 0 ? 'red' : ''}`}>{relativeDeadline(task.due)}</span></div>)}{!deadlines.length && <div className="empty-state"><Sparkles size={32}/><p>남은 마감이 없어요.</p></div>}</section>}
        <footer className="page-footer"><span>차근차근, 나만의 속도로.</span><span>weekflow <span>✳</span> a little clarity for your week</span></footer>
      </div>
    </main>

    {modal === 'task' && <Modal title="새로운 할 일" onClose={() => setModal(null)}><form className="task-form" onSubmit={addTask}><label>무엇을 해야 하나요?<input autoFocus name="title" placeholder="예: 다음 주 프로젝트 기획안 작성" required maxLength={160}/></label><label>마감일<input type="date" name="due" defaultValue={todayKey} required/></label><div className="form-grid"><label>우선순위<select name="priority" defaultValue="medium"><option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option></select></label><label>분류<select name="tag"><option>업무</option><option>개인</option><option>학습</option></select></label></div><p className="form-note">할 일은 이 브라우저에 저장됩니다. Google Tasks와는 동기화되지 않습니다.</p><button className="primary-button" type="submit"><Plus size={16}/>할 일 추가</button></form></Modal>}
    {modal === 'settings' && <Modal title="Google Calendar 연결" onClose={() => setModal(null)}><div className="settings-body"><div className="settings-intro"><GoogleMark/><p>기본 캘린더의 이번 주와 다음 주 일정을 불러옵니다. 캘린더를 수정하지 않는 읽기 전용 연결입니다.</p></div><label>Google OAuth 클라이언트 ID<input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off"/></label><p className="form-note">Google Cloud Console에서 Calendar API를 활성화하고 웹 애플리케이션 OAuth 클라이언트를 만드세요. 승인된 JavaScript 원본에 현재 앱의 주소를 등록하고, 테스트 모드에서는 내 Google 계정을 테스트 사용자로 추가하세요.</p><a className="docs-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console 열기<ExternalLink size={13}/></a><div className="privacy-note"><Link2 size={16}/><p>클라이언트 ID는 공개 식별자입니다. 비밀번호나 클라이언트 보안 비밀번호를 입력하지 마세요. 접근 토큰은 메모리에만 유지되며 새로고침 후 다시 연결해야 합니다.</p></div>{error && <p className="inline-error" role="alert">{error}</p>}<div className="settings-actions">{token && <button className="light-button" onClick={disconnect}><Unplug size={15}/>연결 해제</button>}<button className="primary-button" disabled={connecting || !clientId.trim()} onClick={() => { try { localStorage.setItem('weekflow.google-client-id', clientId.trim()); } catch { setStorageError('클라이언트 ID를 저장하지 못했습니다.'); } connect(); }}>{connecting ? <LoaderCircle className="spin" size={16}/> : <GoogleMark/>}{connecting ? '연결 중…' : 'Google 계정으로 연결'}</button></div></div></Modal>}
    {modal === 'event' && selectedEvent && <Modal title="일정 자세히 보기" onClose={() => setModal(null)}><div className="event-detail"><span className="detail-category">{token ? 'Google Calendar' : '샘플 일정'}</span><h3>{selectedEvent.title}</h3><p><CalendarDays size={17}/>{selectedEvent.allDay ? `${selectedEvent.start} ~ ${dateKey(addDays(new Date(`${selectedEvent.end}T00:00:00`), -1))} · 종일` : `${new Date(selectedEvent.start).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })} – ${new Date(selectedEvent.end).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}</p>{selectedEvent.location && <p><MapPin size={17}/>{selectedEvent.location}</p>}{selectedEvent.description && <div className="event-description">{selectedEvent.description}</div>}{selectedEvent.link?.startsWith('https://') && <a className="primary-button" href={selectedEvent.link} target="_blank" rel="noreferrer">Google Calendar에서 보기<ExternalLink size={15}/></a>}</div></Modal>}
  </div>;
}

function TaskRow({ task, onToggle, onDelete, todayKey }) {
  const difference = dayDifference(task.due, todayKey);
  return <div className={`task-row ${task.done ? 'completed' : ''}`}><button className="check-button" aria-label={`${task.title} ${task.done ? '완료 취소' : '완료'}`} aria-pressed={task.done} onClick={() => onToggle(task.id)}>{task.done ? <span className="checked"><Check size={13}/></span> : <Circle size={20}/>}</button><div className="task-info"><strong>{task.title}</strong><small><span>{task.tag}</span><span>·</span><Clock3 size={11}/><span className={!task.done && difference <= 0 ? 'due-text' : ''}>{difference === 0 ? '오늘까지' : difference === 1 ? '내일까지' : `${Number(task.due.slice(5, 7))}/${Number(task.due.slice(-2))}까지`}{!task.done && difference < 0 ? ' · 지연' : ''}</span></small></div><span className={`priority ${task.priority}`}><Flag size={10}/>{PRIORITY[task.priority]}</span>{onDelete && <button className="icon-button delete-task" aria-label={`${task.title} 삭제`} onClick={() => onDelete(task.id)}><Trash2 size={15}/></button>}</div>;
}

createRoot(document.getElementById('root')).render(<App/>);
