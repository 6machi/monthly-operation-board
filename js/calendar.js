import { $, esc, toISO, todayISO, diffDays, taskOccursOnDate } from './utils.js';
import { state } from './state.js';
import { openDateOnBoard } from './board.js';
import { createTask, deleteTask } from './tasks.js';
import { refreshAll } from './app.js';

export function renderCalendar(){
  $('calendarMonth').value = state.calendarMonth;
  renderUnavailableList();
  renderMonthGrid();
  renderMemberSummary();
}

export function isUnavailableTask(t){
  return t?.status === 'unavailable' || t?.category === '稼働不可';
}
export function unavailableDatesForMember(memberId = state.user?.id){
  return new Set(state.tasks
    .filter(t=>t.owner_id===memberId && isUnavailableTask(t) && (t.schedule_date || t.due_date || t.carryover_date))
    .map(t=>t.schedule_date || t.due_date || t.carryover_date));
}
export function isUnavailableForMember(dateIso, memberId = state.user?.id){
  return unavailableDatesForMember(memberId).has(dateIso);
}
function visibleTasksOnDate(dateIso, memberId){
  if(isUnavailableForMember(dateIso, memberId)) return [];
  return state.tasks.filter(t=>t.owner_id===memberId && !isUnavailableTask(t) && taskOccursOnDate(t, dateIso));
}
function renderUnavailableList(){
  const box = $('unavailableList');
  if(!box) return;
  const mine = state.selectedMemberId === state.user?.id;
  const month = state.calendarMonth;
  const list = state.tasks
    .filter(t=>t.owner_id===state.user?.id && isUnavailableTask(t) && String(t.schedule_date||'').startsWith(month))
    .sort((a,b)=>String(a.schedule_date||'').localeCompare(String(b.schedule_date||'')));
  if(!list.length){
    box.innerHTML = '<div class="empty">この月の稼働不可日はまだありません。</div>';
    return;
  }
  box.innerHTML = list.map(t=>`<div class="unavailableItem"><b>${esc(t.schedule_date || '')}</b><span>${esc(t.memo || '稼働不可')}</span>${mine?`<button class="ghost" data-del-unavailable="${esc(t.id)}" type="button">解除</button>`:''}</div>`).join('');
  box.querySelectorAll('[data-del-unavailable]').forEach(btn=>btn.addEventListener('click', async()=>{
    if(!confirm('この日の稼働不可を解除しますか？')) return;
    await deleteTask(btn.dataset.delUnavailable);
    await refreshAll();
  }));
}

function relativeMonthStats(iso){
  const list = state.tasks.filter(t=>!isUnavailableTask(t) && !isUnavailableForMember(iso, t.owner_id) && taskOccursOnDate(t, iso));
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
    const unavailableMembers = state.members.filter(mem=>isUnavailableForMember(iso, mem.id));
    const membersWithTasks = state.members.map(mem=>{
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
      : (unavailableMembers.length ? `<div class="dayRest">${unavailableMembers.map(m=>`${esc(m.emoji||'🌙')} ${esc(m.name)}`).join('・')} おやすみ</div>` : '<div class="dayEmpty">のんびり</div>');

    const footer = `<div class="dayMood">${unavailableMembers.length ? '稼働不可あり' : (carryovers ? `持ち越し ${carryovers}件` : '持ち越しなし')}</div>`;
    cell.innerHTML = header + chips + footer;
    cell.addEventListener('click',()=>openDateOnBoard(iso));
    grid.appendChild(cell);
  }
}

function renderMemberSummary(){
  const box = $('memberSummary');
  box.innerHTML='';
  const month = state.calendarMonth;

  state.members.forEach(mem=>{
    const tasks = state.tasks.filter(t=>t.owner_id===mem.id && !isUnavailableTask(t) && String(t.schedule_date||t.carryover_date||t.due_date||'').startsWith(month));
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
  $('addUnavailableBtn')?.addEventListener('click', async()=>{
    const date = $('unavailableDate')?.value;
    if(!date) return alert('稼働できない日を選んでください');
    if(isUnavailableForMember(date, state.user.id)) return alert('その日はすでに稼働不可です');
    await createTask({ team_id:state.team.id, owner_id:state.user.id, created_by:state.user.id, title:'稼働不可', category:'稼働不可', project:'おやすみ', task_type:'', estimated_minutes:0, start_time:'00:00', schedule_date:date, due_date:date, occurrence:'single', status:'unavailable', memo:$('unavailableMemo')?.value || '稼働不可', sort_order:Date.now()*-1 });
    $('unavailableMemo').value='';
    await refreshAll();
  });
}
