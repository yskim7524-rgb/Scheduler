const FORMAT = 'weekflow.tasks.v1';
const MAX_BYTES = 1024 * 1024;
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const cleanTask = task => {
  if (!task || typeof task.id !== 'string' || !task.id || task.id.length > 128 || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 160 || typeof task.due !== 'string' || !dateValid(task.due) || !['high', 'medium', 'low'].includes(task.priority) || typeof task.done !== 'boolean' || typeof task.tag !== 'string' || task.tag.length > 32) throw new Error('올바른 할 일 백업 파일이 아닙니다.');
  return { id: task.id, title: task.title, due: task.due, priority: task.priority, done: task.done, tag: task.tag };
};
export function createTaskBackup(tasks) {
  return JSON.stringify({ format: FORMAT, tasks: tasks.map(cleanTask) }, null, 2);
}
export function parseTaskBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('1MB 이하의 백업 파일을 선택해 주세요.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON 형식의 할 일 백업 파일을 선택해 주세요.'); }
  if (data?.format !== FORMAT || !Array.isArray(data.tasks) || data.tasks.length > 1000) throw new Error('올바른 할 일 백업 파일이 아닙니다.');
  const tasks = data.tasks.map(cleanTask);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('중복된 항목이 있는 백업 파일입니다.');
  return tasks;
}
export function mergeTaskBackup(current, imported) {
  const merged = new Map(current.map(task => [task.id, task]));
  for (const task of imported) merged.set(task.id, task);
  return [...merged.values()];
}
