import { $, esc, toISO, parseISO } from './utils.js';
import { state } from './state.js';
import { openDateOnBoard } from './board.js';

export function renderCalendar(){
  $('calendarMonth').value = state.calendarMonth;
  renderMonthGrid();
  renderMemberSummary();
}
function renderMonthGrid(){
  const grid = $('monthGrid'); grid.innerHTML = '';
  ['月','火','水','木','金','土','日'].forEach(w=>{ const d=document.createElement('div'); d.className='weekday'; d.textContent=w; grid.appendChild(d); });
  const [y,m] = state.calendarMonth.split('-').map(Number);
  const first = new Date(y,m-1,1);
  const last = new Date(y,m,0);
  const offset = (first.getDay()+6)%7;
  for(let i=0;i<offset;i++){ const blank=document.createElement('div'); blank.className='dayCell'; blank.style.opacity=.35; grid.appendChild(blank); }
  for(let day=1; day<=last.getDate(); day++){
    const iso = toISO(new Date(y,m-1,day));
    const cell = document.createElement('div'); cell.className='dayCell'; cell.innerHTML = `<div class="dayNum">${day}</div>`;
    state.members.forEach(mem=>{
      const count = state.tasks.filter(t=>t.owner_id===mem.id && !t.done && (t.schedule_date===iso || t.carryover_date===iso || t.due_date===iso)).length;
      if(count) cell.innerHTML += `<span class="dayMini">${esc(mem.name)} ${count}件</span>`;
    });
    cell.addEventListener('click',()=>openDateOnBoard(iso));
    grid.appendChild(cell);
  }
}
function renderMemberSummary(){
  const box = $('memberSummary'); box.innerHTML='';
  const month = state.calendarMonth;
  state.members.forEach(mem=>{
    const tasks = state.tasks.filter(t=>t.owner_id===mem.id && (String(t.schedule_date||t.carryover_date||t.due_date||'').startsWith(month)));
    const byProject = new Map();
    tasks.forEach(t=>{
      const key=t.project || t.category || '未分類';
      if(!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(t);
    });
    const card=document.createElement('div'); card.className='memberCard'; card.innerHTML=`<h3>${esc(mem.name)}の今月のタスク</h3>`;
    if(!byProject.size){ card.innerHTML += '<div class="empty">今月のタスクはありません。</div>'; }
    byProject.forEach((arr,project)=>{
      const done=arr.filter(t=>t.done).length;
      const pct=arr.length?Math.round(done/arr.length*100):0;
      card.innerHTML += `<div class="projectRow"><b>${esc(project)}</b><span>タスク数 ${arr.length}</span><span>進行度 ${pct}%</span><div class="progress"><div class="bar" style="width:${pct}%"></div></div></div>`;
    });
    box.appendChild(card);
  });
}
export function initCalendarEvents(){
  $('calendarMonth').addEventListener('change',()=>{ state.calendarMonth = $('calendarMonth').value; renderCalendar(); });
  $('calendarThisMonth').addEventListener('click',()=>{ state.calendarMonth = new Date().toISOString().slice(0,7); renderCalendar(); });
}
