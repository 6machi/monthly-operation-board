import { $, esc, toISO, todayISO, diffDays, taskOccursOnDate, minutesFromTime, fullClock } from './utils.js?v=40';
import { state } from './state.js?v=40';
import { openDateOnBoard } from './board.js?v=40';
import { createTask, deleteTask, updateTask } from './tasks.js?v=40';
import { refreshAll } from './app.js?v=40';

const DAY_MINUTES = 24 * 60;
function taskArray(){ return Array.isArray(state.tasks) ? state.tasks.filter(t=>t && typeof t === 'object') : []; }
function memberArray(){ return Array.isArray(state.members) ? state.members.filter(m=>m && typeof m === 'object') : []; }
function clampMinute(n){ return Math.max(0, Math.min(DAY_MINUTES, Math.round(Number(n)||0))); }
function snap15(n){ return Math.max(0, Math.min(DAY_MINUTES, Math.round(Number(n||0)/15)*15)); }
function durationBetween(startText, endText){
  const start = snap15(minutesFromTime(startText || '00:00'));
  let end = snap15(minutesFromTime(endText || '00:00'));
  if(String(endText).slice(0,5)==='23:59') end = DAY_MINUTES;
  let duration = end - start;
  if(duration <= 0) duration += DAY_MINUTES;
  return Math.min(DAY_MINUTES, Math.max(15, duration));
}
function intervalParts(start, duration){
  start = snap15(start); duration = Math.max(0, Math.round(Number(duration)||0));
  if(duration >= DAY_MINUTES) return [{start:0,end:DAY_MINUTES}];
  const end = start + duration;
  if(end <= DAY_MINUTES) return [{start, end}];
  return [{start, end:DAY_MINUTES}, {start:0, end:end-DAY_MINUTES}];
}
function unavailableDuration(t){
  const n = Number(t.estimated_minutes || 0);
  if(n <= 0 || n >= DAY_MINUTES) return DAY_MINUTES;
  return n;
}

export function renderCalendar(){
  $('calendarMonth').value = state.calendarMonth;
  renderUnavailableList();
  renderMonthGrid();
  renderMemberSummary();
}

export function isUnavailableTask(t){
  return t?.status === 'unavailable' || t?.category === '稼働不可';
}
export function isAllDayUnavailableTask(t){
  return isUnavailableTask(t) && unavailableDuration(t) >= DAY_MINUTES;
}
export function unavailableTasksForMember(dateIso, memberId = state.user?.id){
  return taskArray()
    .filter(t=>t && t.id && t.owner_id===memberId && isUnavailableTask(t) && (t.schedule_date || t.due_date || t.carryover_date) === dateIso)
    .sort((a,b)=>String(a.start_time||'00:00').localeCompare(String(b.start_time||'00:00')));
}
export function unavailableBlocksForMember(dateIso, memberId = state.user?.id){
  return unavailableTasksForMember(dateIso, memberId).flatMap(t=>{
    const start = minutesFromTime(t.start_time || '00:00');
    const duration = unavailableDuration(t);
    return intervalParts(start, duration).map(part=>({ ...part, task:t, memo:t.memo || '稼働不可', allDay: duration>=DAY_MINUTES }));
  });
}
export function isUnavailableForMember(dateIso, memberId = state.user?.id){
  return unavailableTasksForMember(dateIso, memberId).some(isAllDayUnavailableTask);
}
export function hasUnavailableForMember(dateIso, memberId = state.user?.id){
  return unavailableTasksForMember(dateIso, memberId).length > 0;
}
function visibleTasksOnDate(dateIso, memberId){
  if(isUnavailableForMember(dateIso, memberId)) return [];
  return taskArray().filter(t=>t && t.id && t.owner_id===memberId && !isUnavailableTask(t) && taskOccursOnDate(t, dateIso));
}
function formatUnavailable(t){
  const start = t.start_time || '00:00';
  const duration = unavailableDuration(t);
  if(duration >= DAY_MINUTES) return '終日';
  return `${start.slice(0,5)}〜${fullClock(minutesFromTime(start)+duration)}`;
}
export function renderUnavailableList(){
  const box = $('unavailableList');
  if(!box) return;
  const mine = state.selectedMemberId === state.user?.id;
  const month = state.calendarMonth;
  const list = taskArray()
    .filter(t=>t && t.id && t.owner_id===state.user?.id && isUnavailableTask(t) && String(t.schedule_date||'').startsWith(month))
    .sort((a,b)=>String(a.schedule_date||'').localeCompare(String(b.schedule_date||'')) || String(a.start_time||'').localeCompare(String(b.start_time||'')));
  if(!list.length){
    box.innerHTML = '<div class="empty">この月の稼働不可はまだありません。</div>';
    return;
  }
  box.innerHTML = list.map(t=>`<div class="unavailableItem"><b>${esc(t.schedule_date || '')}</b><span>${esc(formatUnavailable(t))}</span><span>${esc(t.memo || '稼働不可')}</span>${mine?`<button class="ghost" data-convert-unavailable="${esc(t.id)}" type="button">タスクにする</button><button class="ghost" data-del-unavailable="${esc(t.id)}" type="button">解除</button>`:''}</div>`).join('');
  box.querySelectorAll('[data-convert-unavailable]').forEach(btn=>btn.addEventListener('click', async()=>{
    const t = taskArray().find(x=>String(x.id)===String(btn.dataset.convertUnavailable));
    if(!t) return;
    const title = prompt('タスク名に変更', t.memo && t.memo !== '稼働不可' ? t.memo : 'カレンダー予定');
    if(!title) return;
    const oldMemo = t.memo && t.memo !== '稼働不可' ? t.memo : '';
    const newMemo = [oldMemo, '稼働不可予定からタスクに変更'].filter(Boolean).join(' / ');
    await updateTask(t.id, { title:title.trim(), category:'未分類', project:'カレンダー予定', task_type:'', status:'scheduled', done:false, memo:newMemo });
    await refreshAll();
  }));
  box.querySelectorAll('[data-del-unavailable]').forEach(btn=>btn.addEventListener('click', async()=>{
    if(!confirm('この稼働不可を解除しますか？')) return;
    await deleteTask(btn.dataset.delUnavailable);
    await refreshAll();
  }));
}

function relativeMonthStats(iso){
  const list = taskArray().filter(t=>!isUnavailableTask(t) && !isUnavailableForMember(iso, t.owner_id) && taskOccursOnDate(t, iso));
  const total = list.length;
  const carryovers = list.filter(t=>t.carryover_date===iso).length;
  return { total, carryovers };
}

function renderMonthGrid(){
  const grid = $('monthGrid');
  grid.innerHTML = '';
  ['月','火','水','木','金','土','日'].forEach(w=>{
    const d=document.createElement('div');
    d.className='weekday';
    d.textContent=w;
    grid.appendChild(d);
  });

  const [y,m] = state.calendarMonth.split('-').map(Number);
  const first = new Date(y,m-1,1);
  const last = new Date(y,m,0);
  const offset = (first.getDay()+6)%7;
  const today = todayISO();

  for(let i=0;i<offset;i++){
    const blank=document.createElement('div');
    blank.className='dayCell blank';
    grid.appendChild(blank);
  }

  for(let day=1; day<=last.getDate(); day++){
    const iso = toISO(new Date(y,m-1,day));
    const isToday = iso===today;
    const unavailableMembers = memberArray().filter(mem=>hasUnavailableForMember(iso, mem.id));
    const allDayMembers = memberArray().filter(mem=>isUnavailableForMember(iso, mem.id));
    const membersWithTasks = memberArray().map(mem=>{
      const tasks = visibleTasksOnDate(iso, mem.id);
      return { mem, count: tasks.length, carry: tasks.filter(t=>t.carryover_date===iso).length };
    }).filter(x=>x.count>0);

    const { total, carryovers } = relativeMonthStats(iso);
    const cell = document.createElement('button');
    cell.type='button';
    cell.className='dayCell fancy';
    if(isToday) cell.classList.add('today');
    if(diffDays(iso, today) < 0) cell.classList.add('past');
    if(unavailableMembers.length) cell.classList.add('unavailableDay');

    const header = `
      <div class="dayHead">
        <div class="dayNumWrap">
          <div class="dayNum">${day}</div>
          ${isToday ? '<span class="todayTag">TODAY</span>' : ''}
        </div>
        <div class="dayTotal ${total ? 'has' : ''}">${total ? `予定 ${total}` : '予定 0'}</div>
      </div>`;

    const chips = membersWithTasks.length
      ? `<div class="dayMiniWrap">${membersWithTasks.map(({mem,count,carry})=>`
          <span class="dayMini cute" style="--mini-color:${esc(mem.color || '#5d9cec')}">
            <span class="miniEmoji">${esc(mem.emoji || '🌙')}</span>
            <span class="miniName">${esc(mem.name)}</span>
            <span class="miniCount">${count}</span>
            ${carry ? '<span class="miniCarry">↺</span>' : ''}
          </span>`).join('')}</div>`
      : (unavailableMembers.length ? `<div class="dayRest">${unavailableMembers.map(m=>`${esc(m.emoji||'🌙')} ${esc(m.name)}`).join('・')} 稼働不可</div>` : '<div class="dayEmpty">のんびり</div>');

    const partialText = unavailableMembers.length && !allDayMembers.length ? '稼働不可時間あり' : '稼働不可あり';
    const footer = `<div class="dayMood">${unavailableMembers.length ? partialText : (carryovers ? `持ち越し ${carryovers}件` : '持ち越しなし')}</div>`;
    cell.innerHTML = header + chips + footer;
    cell.addEventListener('click',()=>openDateOnBoard(iso));
    grid.appendChild(cell);
  }
}

function renderMemberSummary(){
  const box = $('memberSummary');
  box.innerHTML='';
  const month = state.calendarMonth;

  memberArray().forEach(mem=>{
    const tasks = taskArray().filter(t=>t.owner_id===mem.id && !isUnavailableTask(t) && String(t.schedule_date||t.carryover_date||t.due_date||'').startsWith(month));
    const byProject = new Map();
    tasks.forEach(t=>{
      const key=t.project || t.category || '未分類';
      if(!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(t);
    });

    const doneTotal = tasks.filter(t=>t.done).length;
    const total = tasks.length;
    const totalPct = total ? Math.round(doneTotal/total*100) : 0;

    const card=document.createElement('div');
    card.className='memberCard cute';
    card.style.setProperty('--member-color', mem.color || '#5d9cec');
    card.innerHTML=`
      <div class="memberHead">
        <div class="memberIdentity">
          <span class="memberEmojiBig">${esc(mem.emoji || '🌙')}</span>
          <div>
            <h3>${esc(mem.name)}の今月のタスク</h3>
            <div class="memberMeta">全 ${total}件 ・ 完了 ${doneTotal}件 ・ 進行度 ${totalPct}%</div>
          </div>
        </div>
        <div class="memberProgressBadge">${totalPct}%</div>
      </div>
      <div class="progress memberProgress"><div class="bar" style="width:${totalPct}%"></div></div>`;

    if(!byProject.size){
      card.innerHTML += '<div class="empty">今月のタスクはありません。</div>';
    }

    byProject.forEach((arr,project)=>{
      const done=arr.filter(t=>t.done).length;
      const pct=arr.length?Math.round(done/arr.length*100):0;
      const carryCount = arr.filter(t=>t.carryover_date).length;
      card.innerHTML += `
        <div class="projectRow cute">
          <div class="projectMain">
            <b>${esc(project)}</b>
            <div class="projectSub">${carryCount ? `持ち越し ${carryCount}件` : '通常進行'}</div>
          </div>
          <span class="statPill">タスク ${arr.length}</span>
          <span class="statPill">進行度 ${pct}%</span>
          <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
        </div>`;
    });

    box.appendChild(card);
  });
}

export function initCalendarEvents(){
  $('calendarMonth').addEventListener('change',()=>{ state.calendarMonth = $('calendarMonth').value; renderCalendar(); });
  $('calendarThisMonth').addEventListener('click',()=>{ state.calendarMonth = new Date().toISOString().slice(0,7); renderCalendar(); });
  $('openProfileFromCalendar')?.addEventListener('click',()=>{ import('./app.js').then(m=>m.showView('profile')); });
  $('unavailableAllDay')?.addEventListener('change',()=>{
    const allDay = $('unavailableAllDay').checked;
    $('unavailableStart').disabled = allDay;
    $('unavailableEnd').disabled = allDay;
  });
  $('addUnavailableBtn')?.addEventListener('click', async()=>{
    try{
      const date = $('unavailableDate')?.value;
      if(!date) return alert('稼働できない日を選んでください');
      const allDay = $('unavailableAllDay')?.checked;
      const start = allDay ? '00:00' : ($('unavailableStart')?.value || '00:00');
      const duration = allDay ? DAY_MINUTES : durationBetween(start, $('unavailableEnd')?.value || '00:00');

      // status は既存DBの制約に合わせて scheduled のままにする。
      // category='稼働不可' で稼働不可ブロックとして判定する。
      await createTask({
        team_id:state.team.id,
        owner_id:state.user.id,
        created_by:state.user.id,
        title: allDay ? '終日稼働不可' : '稼働不可時間',
        category:'稼働不可',
        project:'おやすみ',
        task_type:'',
        estimated_minutes: duration,
        start_time:start,
        schedule_date:date,
        due_date:date,
        occurrence:'single',
        status:'scheduled',
        memo:$('unavailableMemo')?.value || '稼働不可',
        sort_order:Date.now()*-1
      });
      $('unavailableMemo').value='';
      await refreshAll();
      alert('稼働不可を追加しました');
    }catch(e){
      console.error(e);
      alert(e.message || '稼働不可の追加に失敗しました');
    }
  });
}
