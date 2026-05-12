import { $, esc, todayISO, addDays, fmtDate, diffDays, relativeFrom, taskOccursOnDate, occurrenceLabel, fullClock, minutesFromTime } from './utils.js';
import { state } from './state.js';
import { createTask, markCarryover, returnToSchedule, updateTask, deleteTask } from './tasks.js';
import { refreshAll, showView } from './app.js';
import { isUnavailableTask, isUnavailableForMember, unavailableBlocksForMember } from './calendar.js';

const SLOT_MINUTES = 15;
const PX_PER_MINUTE = 1.15; // 15分 = 約17px / 60分 = 約69px
const DAY_MINUTES = 24 * 60;
const DEFAULT_START_MINUTES = 9 * 60;
function workStartStorageKey(dateIso=state.scheduleDate){
  return `task-kanri-work-start:${state.user?.id || 'anon'}:${dateIso}`;
}
function getWorkStartTime(dateIso=state.scheduleDate){
  if(dateIso !== todayISO()) return null;
  try{ return localStorage.getItem(workStartStorageKey(dateIso)); }catch(_e){ return null; }
}
function setWorkStartTime(value, dateIso=state.scheduleDate){
  try{
    if(value) localStorage.setItem(workStartStorageKey(dateIso), value);
    else localStorage.removeItem(workStartStorageKey(dateIso));
  }catch(_e){}
}
function timelineBaseMinutes(){
  if(state.scheduleDate === todayISO()){
    const saved = getWorkStartTime(state.scheduleDate);
    if(saved) return Math.floor(minutesFromTime(saved) / 60) * 60;
    const now = new Date();
    return now.getHours() * 60;
  }
  return 0;
}
function wrapMinutes(min){ return ((Math.round(min) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES; }
function timeLabelWrap(min){ return fullClock(wrapMinutes(min)); }
function relativeTimelineTop(startMin, baseMin){
  const wrappedStart = wrapMinutes(startMin);
  let delta = wrappedStart - baseMin;
  if(delta < 0) delta += DAY_MINUTES;
  return delta * PX_PER_MINUTE;
}
function minutesFromTimelineTop(topPx, baseMin){
  return wrapMinutes(baseMin + snapMinutes(topPx / PX_PER_MINUTE));
}

function selectedTasks(){ return state.tasks.filter(t => t.owner_id === state.selectedMemberId && !t.done && !isUnavailableTask(t)); }
function timelineTasks(){ if(isUnavailableForMember(state.scheduleDate, state.selectedMemberId)) return []; return selectedTasks().filter(t => taskOccursOnDate(t, state.scheduleDate)); }
function carryTasks(){ return selectedTasks().filter(t => t.carryover_date === state.carryDate); }
function colorFor(t){
  const cat = (state.tree || []).find(c => c.name === t.category);
  if(cat?.color) return cat.color;
  if(t.category === '差し込みタスク') return '#f5a623';
  if(t.category === 'プライベート') return '#63b978';
  if(t.category === '仕事') return '#5d9cec';
  if(t.category === '副業') return '#a78bfa';
  return '#9aa4b6';
}
function scheduleTitle(){
  const d = diffDays(state.scheduleDate, todayISO());
  if(d === 0) return `今日のスケジュール`;
  if(d === 1) return `明日のスケジュール`;
  if(d === 2) return `明後日のスケジュール`;
  return `${fmtDate(state.scheduleDate)} のスケジュール`;
}
function normalizeCarryDate(){
  const min = addDays(state.scheduleDate, 1);
  if(diffDays(state.carryDate, min) < 0) state.carryDate = min;
}
function snapMinutes(min){
  return Math.max(0, Math.min(DAY_MINUTES - SLOT_MINUTES, Math.round(min / SLOT_MINUTES) * SLOT_MINUTES));
}
function snapDuration(min){
  return Math.max(SLOT_MINUTES, Math.round(min / SLOT_MINUTES) * SLOT_MINUTES);
}
function taskDuration(t){ return snapDuration(Number(t.estimated_minutes || 30)); }
function fallbackStart(index){
  if(state.scheduleDate === todayISO()){
    const now = new Date();
    return snapMinutes(now.getHours()*60 + now.getMinutes() + index * 30);
  }
  return snapMinutes(DEFAULT_START_MINUTES + index * 30);
}
function taskStartMinutes(t, index=0){
  if(t.start_time) return snapMinutes(minutesFromTime(t.start_time));
  return fallbackStart(index);
}
function timeLabel(min){ return timeLabelWrap(snapMinutes(min)); }
function isEditable(){ return state.selectedMemberId === state.user.id; }

function selectedMember(){
  return state.members.find(m=>m.id===state.selectedMemberId) || {};
}
function memberSleep(){
  const member = selectedMember();
  const own = state.selectedMemberId === state.user?.id ? state.profile || {} : {};
  const start = String(member.sleepStart || own.sleep_start_time || '02:00').slice(0,5);
  const end = String(member.sleepEnd || own.sleep_end_time || '09:00').slice(0,5);
  return { start, end };
}
function sleepDurationMinutes(startText, endText){
  const start = minutesFromTime(startText || '02:00');
  const end = minutesFromTime(endText || '09:00');
  let duration = end - start;
  if(duration <= 0) duration += DAY_MINUTES;
  return snapDuration(duration);
}
function splitInterval(start, duration){
  start = snapMinutes(start);
  duration = Number(duration || 0);
  if(duration >= DAY_MINUTES) return [{start:0,end:DAY_MINUTES}];
  const end = start + duration;
  if(end <= DAY_MINUTES) return [{start, end}];
  return [{start, end:DAY_MINUTES}, {start:0, end:end-DAY_MINUTES}];
}
function memberSleepIntervals(){
  const { start, end } = memberSleep();
  const startMin = snapMinutes(minutesFromTime(start));
  const duration = sleepDurationMinutes(start, end);
  return splitInterval(startMin, duration).map(part=>({ ...part, kind:'sleep', label:'すいみん', meta:`${start} - ${end}` }));
}
function makeBlockedElement(block, baseMin){
  const el = document.createElement('div');
  el.className = block.kind === 'sleep' ? 'sleepEvent' : 'unavailableEvent';
  el.style.top = `${relativeTimelineTop(block.start, baseMin)}px`;
  el.style.height = `${Math.max(24, (block.end - block.start) * PX_PER_MINUTE - 4)}px`;
  el.innerHTML = `<b>${esc(block.label || '稼働不可')}</b><small>${esc(block.meta || `${timeLabelWrap(block.start)} - ${timeLabelWrap(block.end)}`)}</small>`;
  return el;
}
function memberBlockedIntervals(dateIso=state.scheduleDate, memberId=state.selectedMemberId){
  const sleep = memberSleepIntervals();
  const unavail = unavailableBlocksForMember(dateIso, memberId).map(b=>({ start:b.start, end:b.end, kind:'unavailable', label:b.allDay?'終日稼働不可':'稼働不可', meta:b.allDay ? (b.memo || '稼働不可') : `${timeLabelWrap(b.start)} - ${timeLabelWrap(b.end)} / ${b.memo || '稼働不可'}` }));
  return [...sleep, ...unavail].sort((a,b)=>a.start-b.start);
}
function intervalsOverlap(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd; }
function busyIntervals(dateIso, memberId=state.selectedMemberId, excludeTaskId=null){
  const blocked = memberBlockedIntervals(dateIso, memberId).map(b=>({start:b.start,end:b.end}));
  const tasks = state.tasks
    .filter(t=>t.owner_id===memberId && !t.done && !isUnavailableTask(t) && String(t.id)!==String(excludeTaskId) && taskOccursOnDate(t, dateIso))
    .map((t,i)=>({ start:taskStartMinutes(t, i), end:taskStartMinutes(t, i)+taskDuration(t) }));
  return [...blocked, ...tasks].sort((a,b)=>a.start-b.start);
}
function fitsAt(dateIso, start, duration, memberId=state.selectedMemberId, excludeTaskId=null){
  const end = start + duration;
  if(start < 0 || end > DAY_MINUTES) return false;
  return !busyIntervals(dateIso, memberId, excludeTaskId).some(b=>intervalsOverlap(start, end, b.start, b.end));
}
function findAvailableStart(dateIso, duration, preferred=DEFAULT_START_MINUTES, memberId=state.selectedMemberId, excludeTaskId=null){
  duration = snapDuration(duration);
  const start = snapMinutes(preferred);
  const candidates = [];
  for(let m=start; m<=DAY_MINUTES-duration; m+=SLOT_MINUTES) candidates.push(m);
  for(let m=0; m<start; m+=SLOT_MINUTES) candidates.push(m);
  return candidates.find(m=>fitsAt(dateIso, m, duration, memberId, excludeTaskId)) ?? start;
}
async function carryTaskToDate(taskId, carryDate){
  const t = state.tasks.find(x=>String(x.id)===String(taskId));
  const duration = taskDuration(t || {});
  const preferred = t?.start_time ? minutesFromTime(t.start_time) : DEFAULT_START_MINUTES;
  const start = findAvailableStart(carryDate, duration, preferred, t?.owner_id || state.selectedMemberId, taskId);
  await updateTask(taskId, { carryover_date: carryDate, schedule_date: null, status:'carryover', start_time: timeLabel(start), sort_order: Date.now()*-1 });
}
async function scheduleTaskOnDate(taskId, scheduleDate){
  const t = state.tasks.find(x=>String(x.id)===String(taskId));
  const duration = taskDuration(t || {});
  const preferred = t?.start_time ? minutesFromTime(t.start_time) : DEFAULT_START_MINUTES;
  const start = findAvailableStart(scheduleDate, duration, preferred, t?.owner_id || state.selectedMemberId, taskId);
  await updateTask(taskId, { schedule_date: scheduleDate, carryover_date: null, status:'scheduled', start_time: timeLabel(start), sort_order: Date.now()*-1 });
}

function ensureTaskEditor(){
  let modal = document.getElementById('taskEditModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'taskEditModal';
  modal.className = 'taskEditModal hidden';
  modal.innerHTML = `
    <div class="taskEditBackdrop" data-close-editor></div>
    <section class="taskEditPanel" role="dialog" aria-modal="true" aria-label="タスクを修正">
      <div class="taskEditPanelHead">
        <div><h2>タスクを修正</h2><p class="muted">タイムラインのカードから開いています。</p></div>
        <button class="ghost" type="button" data-close-editor>閉じる</button>
      </div>
      <div class="form taskEditQuickForm">
        <label><small>タスク名</small><input id="editTaskTitle"></label>
        <label><small>カテゴリ</small><select id="editTaskCategory"></select></label>
        <label><small>プロジェクト</small><select id="editTaskProject"></select></label>
        <label><small>見積もり時間 分</small><input id="editTaskMinutes" type="number" min="15" step="15"></label>
        <label><small>予定日</small><input id="editTaskScheduleDate" type="date"></label>
        <label><small>開始時間</small><input id="editTaskStartTime" type="time" step="900"></label>
        <label><small>持ち越し日</small><input id="editTaskCarryDate" type="date"></label>
        <label><small>期限</small><input id="editTaskDue" type="date"></label>
        <label><small>発生タイプ</small><select id="editTaskOccurrence"><option value="single">単発</option><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
        <label><small>状態</small><select id="editTaskDone"><option value="false">未完了</option><option value="true">完了</option></select></label>
        <label style="grid-column:1/-1"><small>メモ</small><textarea id="editTaskMemo"></textarea></label>
      </div>
      <div class="actions">
        <button class="primary" type="button" id="saveTaskFromTimeline">保存</button>
        <button class="ghost" type="button" id="carryTaskFromTimeline">選択中の持ち越し日に移動</button>
        <button class="ghost" type="button" id="makeUnavailableFromTimeline">稼働不可予定にする</button>
        <button class="danger" type="button" id="deleteTaskFromTimeline">削除</button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-editor]').forEach(btn=>btn.addEventListener('click', closeTaskEditor));
  return modal;
}
function closeTaskEditor(){
  const modal = document.getElementById('taskEditModal');
  if(modal) modal.classList.add('hidden');
}
function fillSelect(el, values, current){
  el.innerHTML = (values||[]).map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('');
}
function projectNamesForCategory(category){
  const c = (state.tree || []).find(x=>x.name===category);
  return (c?.projects || []).map(p=>p.name);
}
function openTaskEditor(t){
  if(!isEditable()) return;
  const modal = ensureTaskEditor();
  modal.dataset.taskId = t.id;
  const categories = (state.tree || []).map(c=>c.name);
  const categoryValue = categories.includes(t.category) ? t.category : (t.category || categories[0] || '未分類');
  $('editTaskTitle').value = t.title || '';
  fillSelect($('editTaskCategory'), categories.length ? categories : [categoryValue], categoryValue);
  const updateProjectOptions = ()=>{
    const category = $('editTaskCategory').value;
    const projects = projectNamesForCategory(category);
    const current = projects.includes(t.project) ? t.project : (t.project || projects[0] || '未分類');
    fillSelect($('editTaskProject'), projects.length ? projects : [current], current);
  };
  updateProjectOptions();
  $('editTaskCategory').onchange = updateProjectOptions;
  $('editTaskMinutes').value = Math.max(15, Math.round(Number(t.estimated_minutes||30)/15)*15);
  $('editTaskScheduleDate').value = t.schedule_date || state.scheduleDate || '';
  $('editTaskStartTime').value = t.start_time || '09:00';
  $('editTaskCarryDate').value = t.carryover_date || '';
  $('editTaskDue').value = t.due_date || '';
  $('editTaskOccurrence').value = t.occurrence || 'single';
  $('editTaskDone').value = t.done ? 'true' : 'false';
  $('editTaskMemo').value = t.memo || '';
  $('saveTaskFromTimeline').onclick = async()=>{
    const minutes = snapDuration(Number($('editTaskMinutes').value||30));
    const carry = $('editTaskCarryDate').value || null;
    const schedule = carry ? null : ($('editTaskScheduleDate').value || state.scheduleDate || todayISO());
    await updateTask(t.id, {
      title: $('editTaskTitle').value.trim() || '無題タスク',
      category: $('editTaskCategory').value || '未分類',
      project: $('editTaskProject').value || '未分類',
      task_type:'',
      estimated_minutes: minutes,
      schedule_date: schedule,
      carryover_date: carry,
      start_time: $('editTaskStartTime').value || '09:00',
      due_date: $('editTaskDue').value || null,
      occurrence: $('editTaskOccurrence').value || 'single',
      done: $('editTaskDone').value === 'true',
      status: $('editTaskDone').value === 'true' ? 'done' : (carry ? 'carryover' : 'scheduled'),
      memo: $('editTaskMemo').value || ''
    });
    closeTaskEditor();
    await refreshAll();
  };
  $('carryTaskFromTimeline').onclick = async()=>{
    await carryTaskToDate(t.id, state.carryDate);
    closeTaskEditor();
    await refreshAll();
  };
  $('makeUnavailableFromTimeline').onclick = async()=>{
    const targetDate = $('editTaskScheduleDate').value || t.schedule_date || state.scheduleDate || todayISO();
    const minutes = snapDuration(Number($('editTaskMinutes').value||t.estimated_minutes||30));
    await updateTask(t.id, {
      title: $('editTaskTitle').value.trim() || t.title || '稼働不可予定',
      category:'稼働不可', project:'予定', task_type:'', estimated_minutes:minutes,
      start_time:$('editTaskStartTime').value || t.start_time || '09:00',
      schedule_date:targetDate, carryover_date:null, due_date:targetDate,
      occurrence:'single', done:false, status:'scheduled',
      memo:($('editTaskMemo').value || t.memo || '稼働不可') + '
タスクから稼働不可予定へ変更'
    });
    closeTaskEditor();
    await refreshAll();
  };
  $('deleteTaskFromTimeline').onclick = async()=>{
    if(!confirm(`タスク「${t.title || ''}」を削除しますか？`)) return;
    await deleteTask(t.id);
    closeTaskEditor();
    await refreshAll();
  };
  modal.classList.remove('hidden');
  $('editTaskTitle').focus();
}

function makeEventElement(t, index, baseMin){
  const duration = taskDuration(t);
  const rawStart = taskStartMinutes(t, index);
  const start = fitsAt(state.scheduleDate, rawStart, duration, state.selectedMemberId, t.id)
    ? rawStart
    : findAvailableStart(state.scheduleDate, duration, rawStart, state.selectedMemberId, t.id);
  const el = document.createElement('div');
  el.className = 'taskEvent';
  el.dataset.id = t.id;
  el.style.setProperty('--c', colorFor(t));
  el.style.top = `${relativeTimelineTop(start, baseMin)}px`;
  el.style.height = `${Math.max(22, duration * PX_PER_MINUTE - 4)}px`;
  el.innerHTML = `
    <div class="eventMain">
      <b>${esc(t.title)}</b>
      <small>${timeLabel(start)} - ${timeLabel(start + duration)} / ${Math.round(duration)}分 / ${esc(t.project || t.category || '')}</small>
    </div>
    <div class="eventMeta">${occurrenceLabel(t.occurrence)}</div>
    <div class="resizeHandle" title="下に引っぱると時間を変更"></div>`;

  if(!isEditable()){
    el.classList.add('readonly');
    el.addEventListener('click',()=>{});
    return el;
  }

  let mode = null;
  let pointerId = null;
  let startY = 0;
  let originalTop = 0;
  let originalHeight = 0;
  let moved = false;

  const cleanup = ()=>{
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    el.classList.remove('moving','resizing');
  };

  const begin = (e, resize=false)=>{
    e.preventDefault();
    e.stopPropagation();
    pointerId = e.pointerId;
    mode = resize ? 'resize' : 'move';
    startY = e.clientY;
    originalTop = parseFloat(el.style.top) || 0;
    originalHeight = parseFloat(el.style.height) || Math.max(22, duration * PX_PER_MINUTE - 4);
    moved = false;
    el.classList.add(mode === 'resize' ? 'resizing' : 'moving');
    try{ el.setPointerCapture(pointerId); }catch(_e){}
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  };

  const onMove = (e)=>{
    if(!mode || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    if(Math.abs(dy) > 4) moved = true;
    if(mode === 'move'){
      const rawTop = Math.max(0, Math.min(DAY_MINUTES * PX_PER_MINUTE - originalHeight, originalTop + dy));
      const snappedTop = snapMinutes(rawTop / PX_PER_MINUTE) * PX_PER_MINUTE;
      el.style.top = `${snappedTop}px`;
    }else{
      const rawHeight = Math.max(SLOT_MINUTES * PX_PER_MINUTE - 4, originalHeight + dy);
      const snappedDuration = snapDuration((rawHeight + 4) / PX_PER_MINUTE);
      el.style.height = `${snappedDuration * PX_PER_MINUTE - 4}px`;
    }
  };

  const onUp = async(e)=>{
    if(!mode || e.pointerId !== pointerId) return;
    const currentMode = mode;
    mode = null; pointerId = null;
    cleanup();

    const drop = $('carryDrop');
    const dropRect = drop?.getBoundingClientRect();
    const droppedToCarry = dropRect && e.clientX >= dropRect.left && e.clientX <= dropRect.right && e.clientY >= dropRect.top && e.clientY <= dropRect.bottom;
    if(currentMode === 'move' && droppedToCarry){
      await carryTaskToDate(t.id, state.carryDate);
      await refreshAll();
      return;
    }

    if(!moved){
      openTaskEditor(t);
      return;
    }

    if(currentMode === 'move'){
      let newStart = minutesFromTimelineTop(parseFloat(el.style.top)||0, timelineBaseMinutes());
      if(!fitsAt(state.scheduleDate, newStart, taskDuration(t), state.selectedMemberId, t.id)) newStart = findAvailableStart(state.scheduleDate, taskDuration(t), newStart, state.selectedMemberId, t.id);
      await updateTask(t.id, { start_time: timeLabelWrap(newStart), schedule_date: state.scheduleDate, carryover_date:null, status:'scheduled' });
    }else{
      const newDuration = snapDuration(((parseFloat(el.style.height)||0) + 4) / PX_PER_MINUTE);
      await updateTask(t.id, { estimated_minutes: newDuration });
    }
    await refreshAll();
  };

  const onCancel = ()=>{
    mode = null; pointerId = null;
    cleanup();
  };

  el.addEventListener('pointerdown', e=>{
    if(e.target.closest('.resizeHandle')) return;
    begin(e, false);
  });
  el.querySelector('.resizeHandle').addEventListener('pointerdown', e=>begin(e, true));

  return el;
}

function taskCard(t){
  const art = document.createElement('article');
  art.className = 'task';
  art.draggable = true;
  art.dataset.id = t.id;
  art.style.setProperty('--c', colorFor(t));
  art.innerHTML = `<b>${esc(t.title)}</b><small>${esc(t.category || '')} / ${esc(t.project || '')} / ${Math.round(t.estimated_minutes||30)}分</small><div class="badges"><span class="badge">${esc(t.status || '')}</span><span class="badge">${occurrenceLabel(t.occurrence)}</span>${t.due_date?`<span class="badge">期限 ${esc(t.due_date)}</span>`:''}</div><div class="actions"><button data-act="return">この日のタイムラインへ戻す</button><button data-act="done">完了</button></div>`;
  art.addEventListener('dragstart', e=>{ state.draggingTaskId = t.id; e.dataTransfer.setData('text/plain', t.id); });
  art.addEventListener('click', e=>{ if(e.target.closest('button')) return; if(isEditable()) openTaskEditor(t); });
  art.querySelector('[data-act="return"]').addEventListener('click', async(e)=>{ e.stopPropagation(); await scheduleTaskOnDate(t.id, state.scheduleDate); await refreshAll(); });
  art.querySelector('[data-act="done"]').addEventListener('click', async(e)=>{ e.stopPropagation(); await updateTask(t.id, { done:true, status:'done' }); await refreshAll(); });
  return art;
}


function mergeIntervals(intervals){
  const sorted = intervals
    .map(x=>({start:Math.max(0, Math.min(DAY_MINUTES, x.start)), end:Math.max(0, Math.min(DAY_MINUTES, x.end))}))
    .filter(x=>x.end>x.start)
    .sort((a,b)=>a.start-b.start);
  const merged=[];
  sorted.forEach(it=>{
    const last=merged[merged.length-1];
    if(!last || it.start>last.end) merged.push({...it});
    else last.end=Math.max(last.end,it.end);
  });
  return merged;
}
function availableMinutesForDate(dateIso, memberId=state.selectedMemberId){
  const busy = mergeIntervals(memberBlockedIntervals(dateIso, memberId));
  const busyMin = busy.reduce((sum,b)=>sum+(b.end-b.start),0);
  return Math.max(0, DAY_MINUTES - busyMin);
}
function monthDatesFrom(dateIso){
  const [y,m] = String(dateIso || todayISO()).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({length:last}, (_,i)=>`${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
}
function formatHours(min){
  const h = min / 60;
  return `${Math.round(h*10)/10}h`;
}
function renderActivitySummary(){
  const box = $('activitySummary');
  if(!box) return;
  const dayMin = availableMinutesForDate(state.scheduleDate, state.selectedMemberId);
  const todayMin = state.scheduleDate === todayISO()
    ? Math.max(0, dayMin - (new Date().getHours()*60 + new Date().getMinutes()))
    : dayMin;
  const [y,m] = String(state.scheduleDate || todayISO()).split('-').map(Number);
  const remainingMonthDates = monthDatesFrom(state.scheduleDate).filter(d => d >= state.scheduleDate);
  const monthMin = remainingMonthDates.reduce((sum,d)=>sum+availableMinutesForDate(d, state.selectedMemberId),0);
  const workMin = timelineTasks().reduce((sum,t)=>sum+taskDuration(t),0);
  const remainMin = Math.max(0, todayMin - workMin);
  box.innerHTML = `
    <div class="activityCard"><b>${formatHours(todayMin)}</b><span>今日の残り活動可能時間</span></div>
    <div class="activityCard"><b>${formatHours(monthMin)}</b><span>${m}月の残り活動可能時間（残り${remainingMonthDates.length}日）</span></div>
    <div class="activityCard"><b>${formatHours(workMin)}</b><span>今日のタスク予定時間</span></div>
    <div class="activityCard"><b>${formatHours(remainMin)}</b><span>今日の余白時間</span></div>`;
}

function renderWorkStartStatus(){
  const box = $('workStartBox');
  if(!box) return;
  const isToday = state.scheduleDate === todayISO();
  box.classList.toggle('hidden', !isToday);
  const text = $('workStartText');
  if(!text) return;
  const saved = getWorkStartTime(state.scheduleDate);
  text.textContent = saved ? `作業開始：${saved.slice(0,5)}` : '作業開始：未設定';
}

export function renderBoard(){
  normalizeCarryDate();
  $('scheduleTitle').textContent = scheduleTitle();
  $('schedulePrev').disabled = diffDays(state.scheduleDate, todayISO()) <= 0;
  $('carryDateText').textContent = fmtDate(state.carryDate);
  $('carryRelative').textContent = `(${relativeFrom(state.scheduleDate, state.carryDate)})`;
  $('carryPrev').disabled = diffDays(state.carryDate, addDays(state.scheduleDate,1)) <= 0;
  $('boardNotice').textContent = isUnavailableForMember(state.scheduleDate, state.selectedMemberId) ? 'この日は終日稼働不可です。毎日タスクや分割タスクは表示されません。' : (state.selectedMemberId === state.user.id ? '自分の今日やることです。編集できます。' : '他メンバーの今日やることです。閲覧中心です。');
  renderActivitySummary();
  renderWorkStartStatus();
  renderTimeline();
  renderCarryList();
}

export function renderTimeline(){
  const box = $('timeline');
  const baseMin = timelineBaseMinutes();
  box.innerHTML = '';
  box.className = 'timeline timelineCalendar';
  box.style.setProperty('--day-height', `${DAY_MINUTES * PX_PER_MINUTE}px`);

  const axis = document.createElement('div');
  axis.className = 'timeAxis';
  for(let h=0; h<24; h++){
    const label = document.createElement('div');
    label.className = 'timeMark';
    label.style.top = `${h*60*PX_PER_MINUTE}px`;
    label.textContent = timeLabelWrap(baseMin + h*60);
    axis.appendChild(label);
  }

  const grid = document.createElement('div');
  grid.className = 'calendarGrid';
  for(let h=0; h<=24; h++){
    const line = document.createElement('div');
    line.className = 'hourLine';
    line.style.top = `${h*60*PX_PER_MINUTE}px`;
    grid.appendChild(line);
  }
  for(let m=15; m<DAY_MINUTES; m+=15){
    const line = document.createElement('div');
    line.className = m%60===0 ? 'quarterLine hourQuarter' : 'quarterLine';
    line.style.top = `${m*PX_PER_MINUTE}px`;
    grid.appendChild(line);
  }

  const events = document.createElement('div');
  events.className = 'eventLayer';
  memberBlockedIntervals(state.scheduleDate, state.selectedMemberId).forEach(block=>events.appendChild(makeBlockedElement(block, baseMin)));
  const list = timelineTasks();
  list.forEach((t,idx)=>events.appendChild(makeEventElement(t, idx, baseMin)));

  const isToday = state.scheduleDate === todayISO();
  if(isToday){
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const line = document.createElement('div');
    line.className = 'nowLine calendarNowLine';
    line.style.top = `${relativeTimelineTop(nowMin, baseMin)}px`;
    grid.appendChild(line);
  }

  const dropHint = document.createElement('div');
  dropHint.className = 'timelineHint';
  dropHint.textContent = isEditable()
    ? '15分刻みで移動・伸縮できます / カードクリックで修正 / 持ち越し欄へ放すと持ち越し'
    : '他メンバーのタイムラインは閲覧のみです。';

  box.appendChild(axis);
  box.appendChild(grid);
  box.appendChild(events);
  box.appendChild(dropHint);

  const totalMin = list.reduce((a,t)=>a+(Number(t.estimated_minutes)||30),0);
  $('planMsg').textContent = totalMin ? `この日の作業予定：${Math.round(totalMin/60*10)/10}時間` : 'この日のタスクはまだありません。時間軸だけ表示しています。';

  requestAnimationFrame(()=>{
    const container = $('timelineBox') || box.parentElement;
    if(!container) return;
    // 今日は読み込んだ時刻の「時台」を先頭にして、そこから24時間を表示します。
    // 明日以降は00:00始まりです。
    container.scrollTop = 0;
  });
}

export function renderCarryList(){
  const list = $('carryList'); list.innerHTML = '';
  const arr = carryTasks();
  if(!arr.length){ list.innerHTML = '<div class="empty">この日の持ち越しタスクはありません。</div>'; return; }
  arr.forEach(t => list.appendChild(taskCard(t)));
}

export function initBoardEvents(){
  $('schedulePrev').addEventListener('click',()=>{ if(diffDays(state.scheduleDate,todayISO())>0){state.scheduleDate=addDays(state.scheduleDate,-1); normalizeCarryDate(); renderBoard(); }});
  $('scheduleNext').addEventListener('click',()=>{ state.scheduleDate=addDays(state.scheduleDate,1); normalizeCarryDate(); renderBoard(); });
  $('carryPrev').addEventListener('click',()=>{ const min=addDays(state.scheduleDate,1); if(diffDays(state.carryDate,min)>0){ state.carryDate=addDays(state.carryDate,-1); renderBoard(); }});
  $('carryNext').addEventListener('click',()=>{ state.carryDate=addDays(state.carryDate,1); renderBoard(); });
  const drop = $('carryDrop');
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,()=>drop.classList.remove('dragover')));
  drop.addEventListener('drop', async(e)=>{
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || state.draggingTaskId;
    if(!id) return;
    await carryTaskToDate(id, state.carryDate);
    state.draggingTaskId = null;
    await refreshAll();
  });
  $('setWorkStartBtn')?.addEventListener('click', ()=>{
    const now = new Date();
    const value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    setWorkStartTime(value, todayISO());
    renderBoard();
  });
  $('clearWorkStartBtn')?.addEventListener('click', ()=>{
    setWorkStartTime(null, todayISO());
    renderBoard();
  });
  $('quickAddBtn').addEventListener('click', async()=>{
    const title = $('quickTitle').value.trim();
    if(!title) return alert('タスク名を入れてください');
    const now = new Date();
    const duration = snapDuration(Number($('quickMinutes').value||30));
    const savedStart = getWorkStartTime(state.scheduleDate);
    const preferred = state.scheduleDate === todayISO() ? snapMinutes(savedStart ? minutesFromTime(savedStart) : now.getHours()*60 + now.getMinutes()) : DEFAULT_START_MINUTES;
    const startMin = findAvailableStart(state.scheduleDate, duration, preferred, state.user.id);
    await createTask({
      team_id: state.team.id,
      owner_id: state.user.id,
      created_by: state.user.id,
      title,
      category:'差し込みタスク', project:'差し込み', task_type:'差し込み',
      estimated_minutes:duration,
      start_time: timeLabel(startMin),
      due_date:$('quickDue').value || null,
      schedule_date: state.scheduleDate,
      status:'scheduled', memo:$('quickMemo').value || '', sort_order: Date.now()*-1
    });
    $('quickTitle').value=''; $('quickMinutes').value=''; $('quickDue').value=''; $('quickMemo').value='';
    await refreshAll();
  });
}
export function openDateOnBoard(iso){ state.scheduleDate = iso; state.carryDate = addDays(iso,1); showView('board'); renderBoard(); }
