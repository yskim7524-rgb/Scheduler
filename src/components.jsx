import React from 'react';
import { ArrowRight, Check, Circle, Clock3, Flag, ListTodo, MapPin, Pencil, Pin, Plus, Target, Trash2 } from 'lucide-react';
import { addDays, dateKey, dayDifference, eventsForDay, PRIORITY } from './domain.js';

const formatTime = value => new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

export function TaskRow({ task, onToggle, onEdit, onPin, onPostpone, onDelete, todayKey }) {
  const difference = dayDifference(task.due, todayKey);
  const focused = task.focusDate === todayKey;
  return <div className={`task-row ${task.done ? 'completed' : ''}`}>
    <button className="check-button" aria-label={`${task.title} ${task.done ? '완료 취소' : '완료'}`} aria-pressed={task.done} onClick={() => onToggle(task.id)}>{task.done ? <span className="checked"><Check size={13}/></span> : <Circle size={20}/>}</button>
    <div className="task-info"><strong>{task.title}</strong><small><span>{task.tag}</span><span>·</span><Clock3 size={11}/><span className={!task.done && difference <= 0 ? 'due-text' : ''}>{difference === 0 ? '오늘까지' : difference === 1 ? '내일까지' : `${Number(task.due.slice(5, 7))}/${Number(task.due.slice(-2))}까지`}{!task.done && difference < 0 ? ' · 지연' : ''}</span><span className={`priority ${task.priority}`}><Flag size={10}/>{PRIORITY[task.priority]}</span></small></div>
    <div className="task-actions">
      {onPin && (!task.done || focused) && <button className={`icon-button pin-button ${focused ? 'pinned' : ''}`} aria-label={`${task.title} 오늘 집중 ${focused ? '해제' : '선택'}`} title={focused ? '오늘 집중에서 해제' : '오늘 집중할 일로 선택'} aria-pressed={focused} onClick={() => onPin(task.id)}><Pin size={15}/></button>}
      {onEdit && <button className="icon-button" aria-label={`${task.title} 수정`} title="할 일 수정" onClick={() => onEdit(task)}><Pencil size={15}/></button>}
      {onPostpone && !task.done && difference <= 0 && <button className="icon-button" aria-label={`${task.title} 내일로 미루기`} title="마감일을 내일로 변경" onClick={() => onPostpone(task.id)}><ArrowRight size={15}/></button>}
      {onDelete && <button className="icon-button delete-task" aria-label={`${task.title} 삭제`} title="삭제" onClick={() => onDelete(task.id)}><Trash2 size={15}/></button>}
    </div>
  </div>;
}

export function TaskForm({ task, todayKey, onSubmit }) {
  return <form className="task-form" onSubmit={onSubmit}>
    <label>무엇을 해야 하나요?<input autoFocus name="title" defaultValue={task?.title || ''} placeholder="예: 다음 주 프로젝트 기획안 작성" required maxLength={160} pattern=".*\S.*" title="공백 이외의 내용을 입력해 주세요"/></label>
    <label>마감일<input type="date" name="due" defaultValue={task?.due || todayKey} required/></label>
    <div className="form-grid"><label>우선순위<select aria-label="우선순위" name="priority" defaultValue={task?.priority || 'medium'}><option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option></select></label><label>분류<select aria-label="분류" name="tag" defaultValue={task?.tag || '업무'}>{[...new Set(['업무', '개인', '학습', ...(task?.tag ? [task.tag] : [])])].map(tag => <option key={tag}>{tag}</option>)}</select></label></div>
    <p className="form-note">할 일은 이 브라우저에 저장됩니다. Google Tasks와는 동기화되지 않습니다.</p>
    <button className="primary-button" type="submit">{task ? <Check size={16}/> : <Plus size={16}/>}{task ? '변경 사항 저장' : '할 일 추가'}</button>
  </form>;
}

export function FocusPanel({ tasks, todayKey, notice, onChoose, onToggle, onEdit, onPin }) {
  const focused = tasks.filter(task => task.focusDate === todayKey);
  const completed = focused.filter(task => task.done).length;
  return <section className="panel focus-panel" aria-label="오늘 집중할 일">
    <div className="panel-heading"><div className="section-title"><Target size={20}/><h2>오늘 집중할 일</h2><span className="count-badge">{focused.length}/3</span></div><span className="focus-progress">{focused.length ? `${completed}개 완료 · ${focused.length - completed}개 남음` : '가장 중요한 세 가지만'}</span></div>
    <div className="focus-items">{focused.map(task => <TaskRow key={task.id} task={task} todayKey={todayKey} onToggle={onToggle} onEdit={onEdit} onPin={onPin}/>)}{Array.from({ length: 3 - focused.length }, (_, index) => <button className="focus-empty" key={index} onClick={onChoose}><span>{focused.length + index + 1}</span><Plus size={15}/>{focused.length + index === 0 ? '오늘 집중할 일을 선택해 보세요' : '중요한 일 하나 더 선택하기'}</button>)}</div>
    <div className="focus-footer"><span role="status">{notice || '브라우저 할 일 옆의 핀을 눌러 선택하세요. 매일 새롭게 3개까지 정할 수 있어요.'}</span><button className="text-button" onClick={onChoose}><ListTodo size={13}/>할 일에서 선택</button></div>
  </section>;
}

export function CalendarAgenda({ events, start, todayKey, loading, failed, personalDisconnected, onSelect }) {
  return <div className="calendar-agenda" aria-label="날짜순 일정 목록">
    {Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index); const key = dateKey(date); const dayEvents = eventsForDay(events, key);
      return <section className={`agenda-day ${key === todayKey ? 'agenda-today' : ''}`} key={key}>
        <div className="agenda-date"><strong>{date.getDate()}</strong><span>{date.getMonth() + 1}월 · {date.toLocaleDateString('ko-KR', { weekday: 'short' })}</span>{key === todayKey && <small>오늘</small>}</div>
        <div className="agenda-events">{loading ? <p className="agenda-empty">불러오는 중…</p> : failed ? <p className="agenda-empty">일정 조회 실패 · 위에서 다시 불러오세요</p> : personalDisconnected ? <p className="agenda-empty">Google Calendar 연결이 필요해요</p> : dayEvents.length ? dayEvents.map(event => <button className={`agenda-event ${event.category}`} key={event.id} onClick={() => onSelect(event)}><span className="agenda-time"><Clock3 size={12}/>{event.isGoogleTask ? '할 일 · 마감일' : event.allDay ? '종일' : `${formatTime(event.start)} – ${formatTime(event.end)}`}</span><strong>{event.title}</strong>{event.location && <small><MapPin size={11}/>{event.location}</small>}</button>) : <p className="agenda-empty">등록된 일정이 없어요</p>}</div>
      </section>;
    })}
  </div>;
}

export function DeadlineGroups({ groups, todayKey, compact = false, onToggle, onEdit, onPin, onPostpone }) {
  return <div className="deadline-groups">{[
    ['today', '오늘 마감', '오늘 끝낼 일을 먼저 확인하세요'],
    ['overdue', '지난 마감', '마감일을 조정하거나 완료해 주세요'],
    ['upcoming', '다가오는 마감', '미리 준비하면 가벼워져요'],
  ].map(([key, title, subtitle]) => groups[key].length > 0 && <section className={`deadline-group ${key}`} key={key} aria-label={title}>
    <div className="deadline-group-heading"><h3>{title}<span>{groups[key].length}</span></h3>{!compact && <small>{subtitle}</small>}</div>
    {groups[key].slice(0, compact ? 2 : undefined).map(task => compact ? <button className="deadline-summary-row" key={task.id} onClick={() => onEdit(task)} aria-label={`${task.title} 마감 수정`}><div className={`deadline-date ${key !== 'upcoming' ? 'due-now' : ''}`}><small>{Number(task.due.slice(5, 7))}월</small><strong>{Number(task.due.slice(-2))}</strong></div><span className="deadline-summary-title"><strong>{task.title}</strong><small>{task.tag} · {PRIORITY[task.priority]} 우선순위</small></span><span className={`dday ${key !== 'upcoming' ? 'red' : ''}`}>{key === 'today' ? '오늘 마감' : key === 'overdue' ? `${-dayDifference(task.due, todayKey)}일 지연` : `D-${dayDifference(task.due, todayKey)}`}</span></button> : <TaskRow key={task.id} task={task} todayKey={todayKey} onToggle={onToggle} onEdit={onEdit} onPin={onPin} onPostpone={onPostpone}/>)}
    {compact && groups[key].length > 2 && <p className="deadline-overflow">외 {groups[key].length - 2}개 · 모든 마감에서 확인</p>}
  </section>)}</div>;
}
