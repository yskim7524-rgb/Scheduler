import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateKey, dayDifference, eventsForDay, groupDeadlines, normalizeGoogleEvent, taskDeadlineEvents, weekStart } from './domain.js';

test('weeks begin on Monday, including Sundays and year boundaries', () => {
  assert.equal(dateKey(weekStart(new Date(2026, 9, 25, 12))), '2026-10-19');
  assert.equal(dateKey(weekStart(new Date(2027, 0, 1, 12))), '2026-12-28');
  assert.equal(dateKey(addDays(new Date(2026, 11, 28), 7)), '2027-01-04');
});
test('deadline counts use calendar days across daylight saving changes', () => {
  assert.equal(dayDifference('2026-03-09', '2026-03-07'), 2);
  assert.equal(dayDifference('2026-10-20', '2026-10-21'), -1);
  assert.equal(dayDifference('2026-10-21', '2026-10-21'), 0);
});
test('Google all-day events have exclusive end dates', () => {
  const event = normalizeGoogleEvent({ id: 'all', start: { date: '2026-10-20' }, end: { date: '2026-10-22' } });
  assert.equal(eventsForDay([event], '2026-10-20').length, 1);
  assert.equal(eventsForDay([event], '2026-10-21').length, 1);
  assert.equal(eventsForDay([event], '2026-10-22').length, 0);
  assert.equal(event.title, '(제목 없음)');
});
test('overnight events appear on both days without including an exclusive midnight end', () => {
  const event = { start: '2026-10-20T23:00:00', end: '2026-10-21T02:00:00', allDay: false };
  assert.equal(eventsForDay([event], '2026-10-20').length, 1);
  assert.equal(eventsForDay([event], '2026-10-21').length, 1);
  assert.equal(eventsForDay([{ ...event, end: '2026-10-21T00:00:00' }], '2026-10-21').length, 0);
});
test('cancelled Google events are omitted and all-day events sort first', () => {
  assert.equal(normalizeGoogleEvent({ status: 'cancelled' }), null);
  const timed = { id: 'timed', start: '2026-10-21T10:00:00', end: '2026-10-21T11:00:00', allDay: false };
  const allDay = { id: 'all', start: '2026-10-21', end: '2026-10-22', allDay: true };
  assert.deepEqual(eventsForDay([timed, allDay], '2026-10-21').map(e => e.id), ['all', 'timed']);
});

test('deadline groups omit completed tasks and separate overdue, today and future in date order', () => {
  const groups = groupDeadlines([
    { id: 'late-future', due: '2027-01-04', done: false },
    { id: 'old', due: '2026-12-30', done: false },
    { id: 'done', due: '2026-12-29', done: true },
    { id: 'today', due: '2026-12-31', done: false },
    { id: 'near-future', due: '2027-01-01', done: false },
  ], '2026-12-31');
  assert.deepEqual(groups.overdue.map(task => task.id), ['old']);
  assert.deepEqual(groups.today.map(task => task.id), ['today']);
  assert.deepEqual(groups.upcoming.map(task => task.id), ['near-future', 'late-future']);
});

test('Google Tasks deadlines appear on the correct calendar day without shifting timezone or inventing times', () => {
  const events = taskDeadlineEvents([
    { id: 'proposal', title: '감사제안서 작성', due: '2026-10-20', done: false, listTitle: '업무' },
    { id: 'undated', title: '날짜 없는 할 일', due: null, done: false },
    { id: 'done', title: '완료한 할 일', due: '2026-10-20', done: true },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].isGoogleTask, true);
  assert.equal(events[0].start, '2026-10-20');
  assert.equal(events[0].end, '2026-10-21');
  assert.equal(eventsForDay(events, '2026-10-20')[0].title, '감사제안서 작성');
  assert.equal(eventsForDay(events, '2026-10-21').length, 0);
});
