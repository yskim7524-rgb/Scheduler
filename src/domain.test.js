import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateKey, dayDifference, eventsForDay, groupDeadlines, normalizeGoogleEvent, toggleDailyFocus, weekStart } from './domain.js';

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

test('daily focus permits three tasks and requires unpinning to replace a completed selection', () => {
  const day = '2026-10-21';
  const original = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, done: false }));
  let tasks = original;
  for (const id of ['a', 'b', 'c']) tasks = toggleDailyFocus(tasks, id, day);
  assert.equal(tasks.filter(task => task.focusDate === day).length, 3);
  assert.equal(toggleDailyFocus(tasks, 'd', day), tasks);
  tasks = tasks.map(task => task.id === 'a' ? { ...task, done: true } : task);
  assert.equal(toggleDailyFocus(tasks, 'd', day), tasks);
  tasks = toggleDailyFocus(tasks, 'a', day);
  tasks = toggleDailyFocus(tasks, 'd', day);
  assert.deepEqual(tasks.filter(task => task.focusDate === day).map(task => task.id), ['b', 'c', 'd']);
  assert.equal(tasks.find(task => task.id === 'a').done, true);
  assert.equal(original.some(task => task.focusDate), false, 'original saved tasks remain unchanged');
});

test('focus starts fresh each day without deleting yesterday’s tasks or changing completion', () => {
  const tasks = ['a', 'b', 'c'].map(id => ({ id, done: false, focusDate: '2026-10-21' }));
  const next = toggleDailyFocus(tasks, 'a', '2026-10-22');
  assert.equal(next.filter(task => task.focusDate === '2026-10-22').length, 1);
  assert.equal(next.length, 3);
  assert.equal(next.find(task => task.id === 'b').focusDate, '2026-10-21');
  assert.equal(toggleDailyFocus([...next, { id: 'done', done: true }], 'done', '2026-10-22').at(-1).focusDate, undefined);
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
