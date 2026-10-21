import React, { useState } from 'react';
import { Check, Circle, ExternalLink, Link2, ListTodo, LoaderCircle, RefreshCw } from 'lucide-react';
import { dayDifference } from './domain.js';

export default function GoogleTasksPanel({ token, lists, tasks, loading, error, lastSync, todayKey, connecting, onConnect, onRefresh }) {
  const [selectedList, setSelectedList] = useState('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const validList = lists.some(list => list.id === selectedList) ? selectedList : 'all';
  const selected = tasks.filter(task => validList === 'all' || task.listId === validList);
  const visible = selected.filter(task => showCompleted || !task.done);
  return <section className="panel google-tasks-panel" aria-label="Google Tasks 할 일">
    <div className="panel-heading"><div className="section-title"><ListTodo size={19}/><h2>Google Tasks</h2>{token?.hasTasks && <span className="count-badge">{tasks.filter(task => !task.done).length}</span>}<span className="source-badge">Google · 읽기 전용</span></div><div className="google-tasks-actions">{token?.hasTasks ? <button className="text-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/>할 일 새로고침</button> : <button className="light-button" onClick={onConnect} disabled={connecting}>{connecting ? <LoaderCircle size={15} className="spin"/> : <Link2 size={15}/>}Google Tasks 연결</button>}<a className="text-button google-tasks-link" href="https://tasks.google.com/" target="_blank" rel="noreferrer">Google에서 관리<ExternalLink size={13}/></a></div></div>
    {!token?.hasTasks ? <div className="google-tasks-intro"><p>Google 캘린더의 ‘할 일’은 Google Tasks에 저장돼요. 별도로 연결하면 <strong>모든 목록과 마감일 없는 항목</strong>도 여기서 확인할 수 있어요.</p><p>아래의 브라우저 할 일과 별개이며, Google 항목의 수정·완료 처리는 ‘Google에서 관리’에서 할 수 있어요.</p>{error && <p className="inline-error" role="alert">{error}</p>}</div> : <>
      <div className="google-tasks-filters"><label>목록<select aria-label="Google 할 일 목록" value={validList} onChange={event => setSelectedList(event.target.value)}><option value="all">모든 목록 ({lists.length})</option>{lists.map(list => <option key={list.id} value={list.id}>{list.title || '(목록 이름 없음)'}</option>)}</select></label><label className="completed-toggle"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/>Google 완료 항목 보기</label></div>
      {loading ? <p className="google-tasks-message" role="status"><LoaderCircle size={16} className="spin"/>모든 Google 할 일 목록을 불러오는 중이에요…</p> : error ? <div className="google-tasks-error" role="alert"><p>{error}</p><a href="https://console.cloud.google.com/apis/library/tasks.googleapis.com" target="_blank" rel="noreferrer">Google Tasks API 설정 열기<ExternalLink size={13}/></a><button className="light-button" onClick={onRefresh}>Google 할 일 다시 불러오기</button></div> : <>
        <div className="google-task-list">{visible.map(task => {
          const diff = task.due ? dayDifference(task.due, todayKey) : null;
          return <article className={`google-task ${task.done ? 'google-task-done' : ''} ${task.parent ? 'google-task-child' : ''}`} key={task.id}>
            <span className="google-task-status" aria-label={task.done ? '완료' : '미완료'}>{task.done ? <Check size={17}/> : <Circle size={18}/>}</span><div><strong>{task.title}</strong><p><span>{task.listTitle}</span><span>·</span><span className={!task.done && diff !== null && diff <= 0 ? 'due-text' : ''}>{!task.due ? '마감일 없음' : diff === 0 ? '오늘 마감' : diff < 0 && !task.done ? `${task.due} · ${-diff}일 지연` : `${task.due} 마감`}</span></p>{task.notes && <details><summary>메모 보기</summary><p className="google-task-notes">{task.notes}</p></details>}</div>
          </article>;
        })}{!visible.length && <p className="google-tasks-message">{selected.length ? '미완료 항목이 없어요. 완료 항목 보기를 켜서 확인할 수 있어요.' : '이 목록에 등록된 할 일이 없어요.'}</p>}</div>
        <div className="google-tasks-footer"><span>미완료 {selected.filter(task => !task.done).length}개 · 완료 {selected.filter(task => task.done).length}개</span><span>{lastSync && `마지막 갱신 ${lastSync.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`}</span></div>
      </>}
    </>}
  </section>;
}
