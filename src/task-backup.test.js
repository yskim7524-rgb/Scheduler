import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskBackup, parseTaskBackup, mergeTaskBackup } from './task-backup.js';

const task = { id: 'task-1', title: '자료 정리', due: '2026-10-21', priority: 'medium', done: false, tag: '업무' };
test('backup roundtrip keeps only local task fields', () => {
  const backup = createTaskBackup([{ ...task, accessToken: 'must-not-export', notes: 'not-part-of-local-task' }]);
  assert.deepEqual(parseTaskBackup(backup), [task]);
  assert.ok(!backup.includes('must-not-export'));
});
test('invalid imports are rejected before mutating existing tasks', () => {
  const encode = tasks => JSON.stringify({ format: 'weekflow.tasks.v1', tasks });
  assert.throws(() => parseTaskBackup('invalid json'));
  assert.throws(() => parseTaskBackup(encode([{ ...task, due: '2026-02-30' }])));
  assert.throws(() => parseTaskBackup(encode([{ ...task, priority: '__proto__' }])));
  assert.throws(() => parseTaskBackup(encode([task, task])));
  assert.throws(() => parseTaskBackup(' '.repeat(1024 * 1024 + 1)));
});
test('merge preserves unrelated tasks and imports updated matching IDs once', () => {
  const other = { ...task, id: 'task-2', title: '기존 항목' };
  const updated = { ...task, done: true };
  assert.deepEqual(mergeTaskBackup([task, other], [updated]), [updated, other]);
});
