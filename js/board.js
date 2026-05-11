import { $, esc, todayISO, addDays, fmtDate, diffDays, relativeFrom, taskOccursOnDate, occurrenceLabel } from './utils.js';
import { state } from './state.js';
import { createTask, markCarryover, returnToSchedule, updateTask } from './tasks.js';
import { refreshAll, showView } from './app.js';

function selectedTasks(){
  return state.tasks.filter(t => t.owner_id === state.selectedMemberId && !t.done);
}
function timelineTasks(){
  return selectedTasks().filter(t => taskOccursOnDate(t, state.scheduleDate));
}
function carryTasks(){
  return selectedTasks().filter(t => t.carryover_date === state.carryDate);
}
function colorFor(t){
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
function taskBlock(t){
  const div = document.createElement('div');
  div.className = 'block';
  div.draggable = true;
  div.dataset.id = t.id;
  div.style.setProperty('--c', colorFor(t));
  div.innerHTML = `<b>${esc(t.title)}</b><small>${esc(t.project || t.category || '')} / ${Math.round((t.estimated_minutes||30))}分 / ${occurrenceLabel(t.occurrence)}</small><div class="dragHint">ドラッグで持ち越しへ移動</div>`;
  div.addEventListener('dragstart', e => { state.draggingTaskId = t.id; div.classList.add('dragging'); e.dataTransfer.setData('text/plain', t.id); });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  return div;
}
function taskCard(t){
  const art = document.createElement('article');
  art.className = 'task';
  art.style.setProperty('--c', colorFor(t));
  art.innerHTML = `<b>${esc(t.title)}</b><small>${esc(t.category || '')} / ${esc(t.project || '')} / ${Math.round(t.estimated_minutes||30)}分</small><div class="badges"><span class="badge">${esc(t.status || '')}</span><span class="badge">${occurrenceLabel(t.occurrence)}</span>${t.due_date?`<span class="badge">期限 ${esc(t.due_date)}</span>`:''}</div><div class="actions"><button data-act="return">この日のタイムラインへ戻す</button><button data-act="done">完了</button></div>`;
  art.querySelector('[data-act="return"]').addEventListener('click', async()=>{ await returnToSchedule(t.id, state.scheduleDate); await refreshAll(); });
  art.querySelector('[data-act="done"]').addEventListener('click', async()=>{ await updateTask(t.id, { done:true, status:'done' }); await refreshAll(); });
  return art;
}
export function renderBoard(){
  normalizeCarryDate();
  $('scheduleTitle').textContent = scheduleTitle();
  $('schedulePrev').disabled = diffDays(state.scheduleDate, todayISO()) <= 0;
  $('carryDateText').textContent = fmtDate(state.carryDate);
  $('carryRelative').textContent = `(${relativeFrom(state.scheduleDate, state.carryDate)})`;
  $('carryPrev').disabled = diffDays(state.carryDate, addDays(state.scheduleDate,1)) <= 0;
  $('boardNotice').textContent = state.selectedMemberId === state.user.id ? '自分の今日やることです。編集できます。' : '他メンバーの今日やることです。閲覧中心です。';
  renderTimeline();
  renderCarryList();
}
export function renderTimeline(){
  const box = $('timeline'); box.innerHTML = '';
  const isToday = state.scheduleDate === todayISO();
  const now = new Date();
  const startHour = isToday ? now.getHours() : 0;
  const rows = [];
  for(let i=0;i<24;i++) rows.push((startHour+i)%24);
  const byHour = new Map();
  timelineTasks().forEach((t,idx)=>{
    const start = isToday && idx===0 ? Math.max(now.getHours(), startHour) : (idx*2)%24;
    if(!byHour.has(start)) byHour.set(start, []);
    byHour.get(start).push(t);
  });
  rows.forEach(h=>{
    const row = document.createElement('div'); row.className='hour'; row.dataset.hour=h;
    row.innerHTML = `<div class="timeLabel">${String(h).padStart(2,'0')}:00</div><div class="slot"></div>`;
    const slot = row.querySelector('.slot');
    (byHour.get(h)||[]).forEach(t => slot.appendChild(taskBlock(t)));
    box.appendChild(row);
  });
  if(isToday){
    const line = document.createElement('div'); line.className='nowLine';
    const minutes = now.getMinutes();
    const hourRows = Array.from(box.querySelectorAll('.hour'));
    const target = hourRows.find(r=>Number(r.dataset.hour)===now.getHours());
    if(target){
      target.querySelector('.slot').appendChild(line);
      line.style.top = `${8 + minutes/60*44}px`;
    }
  }
  const totalMin = timelineTasks().reduce((a,t)=>a+(Number(t.estimated_minutes)||30),0);
  $('planMsg').textContent = totalMin ? `この日の作業予定：${Math.round(totalMin/60*10)/10}時間` : 'この日のタスクはまだありません。時間軸だけ表示しています。';
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
    await markCarryover(id, state.carryDate);
    state.draggingTaskId = null;
    await refreshAll();
  });
  $('quickAddBtn').addEventListener('click', async()=>{
    const title = $('quickTitle').value.trim();
    if(!title) return alert('タスク名を入れてください');
    await createTask({
      team_id: state.team.id,
      owner_id: state.user.id,
      created_by: state.user.id,
      title,
      category:'差し込みタスク', project:'差し込み', task_type:'差し込み',
      estimated_minutes:Number($('quickMinutes').value||30),
      due_date:$('quickDue').value || null,
      schedule_date: state.scheduleDate,
      status:'scheduled', memo:$('quickMemo').value || '', sort_order: Date.now()*-1
    });
    $('quickTitle').value=''; $('quickMinutes').value=''; $('quickDue').value=''; $('quickMemo').value='';
    await refreshAll();
  });
}
export function openDateOnBoard(iso){ state.scheduleDate = iso; state.carryDate = addDays(iso,1); showView('board'); renderBoard(); }
