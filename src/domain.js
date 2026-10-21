export function dateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(value, amount) {
  const d = new Date(value);
  d.setDate(d.getDate() + amount);
  return d;
}

export function weekStart(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function dayDifference(a, b) {
  const utc = value => {
    const d = new Date(`${value}T00:00:00`);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((utc(a) - utc(b)) / 86400000);
}

export const PRIORITY = { high: '높음', medium: '보통', low: '낮음' };

export function toggleDailyFocus(tasks, id, day) {
  const task = tasks.find(item => item.id === id);
  if (!task) return tasks;
  if (task.focusDate === day) return tasks.map(item => item.id === id ? { ...item, focusDate: null } : item);
  if (task.done || tasks.filter(item => item.focusDate === day).length >= 3) return tasks;
  return tasks.map(item => item.id === id ? { ...item, focusDate: day } : item);
}

export function groupDeadlines(tasks, day) {
  const groups = { overdue: [], today: [], upcoming: [] };
  for (const task of [...tasks].filter(item => !item.done).sort((a, b) => a.due.localeCompare(b.due))) {
    const diff = dayDifference(task.due, day);
    groups[diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming'].push(task);
  }
  return groups;
}

export function eventsForDay(events, key) {
  const start = new Date(`${key}T00:00:00`);
  const end = addDays(start, 1);
  return events.filter(event => {
    const eventStart = new Date(event.allDay ? `${event.start}T00:00:00` : event.start);
    const eventEnd = new Date(event.allDay ? `${event.end}T00:00:00` : event.end);
    return eventStart < end && eventEnd > start;
  }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start) - new Date(b.start));
}

export function normalizeGoogleEvent(event) {
  if (event.status === 'cancelled' || !event.start || !event.end) return null;
  return {
    id: event.id,
    title: event.summary || '(제목 없음)',
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    allDay: Boolean(event.start.date),
    location: event.location || '',
    description: event.description || '',
    link: event.htmlLink || '',
    category: 'google',
  };
}

export function demoEvents(today = new Date()) {
  const monday = weekStart(today);
  const event = (id, offset, hour, title, category, duration = 1, location = '') => {
    const start = addDays(monday, offset);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + duration * 3600000);
    return { id, title, start: start.toISOString(), end: end.toISOString(), allDay: false, category, location };
  };
  return [
    event('d1', 0, 10, '위클리 팀 미팅', 'work', 1, '회의실 A'),
    event('d2', 0, 14, '이번 주 계획 정리', 'personal'),
    event('d3', 1, 11, '프로젝트 킥오프', 'work', 1.5, '온라인 미팅'),
    event('d4', 2, 10, '디자인 리뷰', 'work', 1, '회의실 B'),
    event('d5', 2, 15, '집중 작업 시간', 'focus', 2),
    event('d6', 3, 14, '프로젝트 중간 점검', 'work'),
    event('d7', 4, 11, '주간 회고', 'personal'),
    event('d8', 4, 16, '다음 주 계획하기', 'focus'),
    event('d9', 5, 11, '가벼운 산책', 'personal'),
    event('d10', 7, 10, '다음 스프린트 미팅', 'work'),
    event('d11', 9, 14, '새 프로젝트 리서치', 'focus', 2),
    event('d12', 11, 15, '팀 공유 세션', 'work'),
  ];
}

export function demoTasks(today = new Date()) {
  return [
    { id: 't1', title: '프로젝트 기획안 마무리', due: dateKey(today), priority: 'high', done: false, tag: '업무' },
    { id: 't2', title: '디자인 피드백 정리하기', due: dateKey(addDays(today, 1)), priority: 'medium', done: false, tag: '업무' },
    { id: 't3', title: '이번 주 읽을 책 고르기', due: dateKey(addDays(today, 2)), priority: 'low', done: false, tag: '개인' },
    { id: 't4', title: '레퍼런스 자료 모으기', due: dateKey(addDays(today, -1)), priority: 'medium', done: true, tag: '업무' },
  ];
}
