import { $, esc, toISO } from './utils.js';
import { state } from './state.js';
import { openDateOnBoard } from './board.js';

export function renderCalendar(){
  $('calendarMonth').value = state.calendarMonth;
  renderMonthGrid();
  renderMemberSummary();
}

function relativeMonthStats(iso){
  const list = state.tasks.filter(t=>!t.done && (t.schedule_date===iso || t.carryover_date===iso || t.due_date===iso));
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
  const today = new Date().toISOString().slice(0,10);

  for(let i=0;i<offset;i++){
    const blank=document.createElement('div');
    blank.className='dayCell blank';
    grid.appendChild(blank);
  }

  for(let day=1; day<=last.getDate(); day++){
    const iso = toISO(new Date(y,m-1,day));
    const isToday = iso===today;
    const membersWithTasks = state.members.map(mem=>{
      const tasks = state.tasks.filter(t=>t.owner_id===mem.id && !t.done && (t.schedule_date===iso || t.carryover_date===iso || t.due_date===iso));
      return { mem, count: tasks.length, carry: tasks.filter(t=>t.carryover_date===iso).length };
    }).filter(x=>x.count>0);

    const { total, carryovers } = relativeMonthStats(iso);
    const cell = document.createElement('button');
    cell.type='button';
    cell.className='dayCell fancy';
    if(isToday) cell.classList.add('today');

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
      : '<div class="dayEmpty">のんびり</div>';

    const footer = `<div class="dayMood">${carryovers ? `持ち越し ${carryovers}件` : '持ち越しなし'}</div>`;
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
    const tasks = state.tasks.filter(t=>t.owner_id===mem.id && String(t.schedule_date||t.carryover_date||t.due_date||'').startsWith(month));
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
}
