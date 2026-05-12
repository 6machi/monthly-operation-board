import { $, esc, toISO, todayISO, diffDays, taskOccursOnDate, minutesFromTime, fullClock, fmtDate } from './utils.js?v=48';
import { state } from './state.js?v=48';
import { openDateOnBoard } from './board.js?v=48';
import { createTask, deleteTask, updateTask } from './tasks.js?v=48';
import { refreshAll } from './app.js?v=48';

const DAY_MINUTES = 24 * 60;
let selectedCalendarDate = todayISO();
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
  ensureSelectedCalendarDate();
  renderMonthGrid();
  renderSelectedDayTasks();
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

  const groups = new Map();
  list.forEach(t=>{
    const key = t.schedule_date || '日付なし';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  box.innerHTML = `<div class="unavailableGroups">${Array.from(groups.entries()).map(([date, items])=>`
    <section class="unavailableDayGroup">
      <h4><span>${esc(date && date !== '日付なし' ? fmtDate(date) : date)}</span><small>${items.length}件</small></h4>
      <div class="unavailableCardGrid">
        ${items.map(t=>{
          const duration = unavailableDuration(t);
          const allDay = duration >= DAY_MINUTES;
          return `<article class="unavailableCard ${allDay ? 'allDay' : ''}">
            <div class="unavailableCardMain">
              <span class="unavailableTimeBadge">${esc(formatUnavailable(t))}</span>
              <b>${esc(t.memo || '稼働不可')}</b>
              <small>${allDay ? '終日稼働不可' : `${esc(t.start_time || '00:00')} 開始 / ${Math.round(duration/15)*15}分`}</small>
            </div>
            ${mine?`<div class="unavailableCardActions">
              <button class="ghost" data-edit-unavailable="${esc(t.id)}" type="button">修正</button>
              <button class="ghost" data-convert-unavailable="${esc(t.id)}" type="button">タスクにする</button>
              <button class="danger" data-del-unavailable="${esc(t.id)}" type="button">解除</button>
            </div>`:''}
          </article>`;
        }).join('')}
      </div>
    </section>`).join('')}</div>`;

  box.querySelectorAll('[data-edit-unavailable]').forEach(btn=>btn.addEventListener('click', async()=>{
    const t = taskArray().find(x=>String(x.id)===String(btn.dataset.editUnavailable));
    if(!t) return;
    const currentDuration = unavailableDuration(t);
    const currentStart = (t.start_time || '00:00').slice(0,5);
    const currentEnd = currentDuration >= DAY_MINUTES ? '23:59' : fullClock(minutesFromTime(currentStart) + currentDuration);
    const date = prompt('稼働不可の日（YYYY-MM-DD）', t.schedule_date || todayISO());
    if(!date) return;
    const start = prompt('開始時間（HH:MM）', currentStart);
    if(!start) return;
    const end = prompt('終了時間（HH:MM / 終日は23:59）', currentEnd);
    if(!end) return;
    const memo = prompt('理由メモ', t.memo || '稼働不可');
    const duration = String(end).slice(0,5) === '23:59' && String(start).slice(0,5) === '00:00'
      ? DAY_MINUTES
      : durationBetween(start, end);
    await updateTask(t.id, {
      schedule_date: date,
      due_date: date,
      carryover_date: null,
      start_time: start.slice(0,5),
      estimated_minutes: duration,
      memo: memo || '稼働不可',
      category: '稼働不可',
      project: t.project || '予定',
      status: 'scheduled'
    });
    await refreshAll();
  }));

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
    if(iso === selectedCalendarDate) cell.classList.add('selected');

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
    cell.addEventListener('click',()=>{ selectedCalendarDate = iso; renderCalendar(); });
    grid.appendChild(cell);
  }
}

function ensureSelectedCalendarDate(){
  const month = state.calendarMonth;
  if(!selectedCalendarDate || !String(selectedCalendarDate).startsWith(month)){
    const today = todayISO();
    selectedCalendarDate = String(today).startsWith(month) ? today : `${month}-01`;
  }
}
function categoryColor(name){
  const tree = Array.isArray(state.tree) ? state.tree : [];
  const found = tree.find(c=>c?.name===name);
  if(found?.color) return found.color;
  if(name === '稼働不可') return '#9aa4b6';
  return '#9aa4b6';
}
function formatTaskTime(t){
  const start = (t.start_time || '00:00').slice(0,5);
  const duration = Math.max(15, Number(t.estimated_minutes || 30));
  if(isUnavailableTask(t)) return formatUnavailable(t);
  return `${start}〜${fullClock(minutesFromTime(start)+duration)} / ${duration}分`;
}
function taskTitleForList(t){
  if(isUnavailableTask(t)) return t.memo || t.title || '稼働不可';
  return t.title || t.memo || '無題のタスク';
}
function selectedDayItemsForMember(dateIso, mem){
  const normal = taskArray()
    .filter(t=>t && t.id && t.owner_id===mem.id && !isUnavailableTask(t) && taskOccursOnDate(t, dateIso))
    .map(t=>({ type:'task', task:t }));
  const unavailable = unavailableTasksForMember(dateIso, mem.id).map(t=>({ type:'unavailable', task:t }));
  return [...unavailable, ...normal].sort((a,b)=>String(a.task.start_time||'00:00').localeCompare(String(b.task.start_time||'00:00')));
}
function renderSelectedDayTasks(){
  const title = $('selectedDayTitle');
  const box = $('selectedDayTasks');
  if(!box) return;
  const dateIso = selectedCalendarDate || todayISO();
  if(title) title.textContent = `${fmtDate(dateIso)} の予定`;

  const groups = memberArray().map(mem=>({ mem, items:selectedDayItemsForMember(dateIso, mem) })).filter(g=>g.items.length);
  if(!groups.length){
    box.innerHTML = `<div class="empty">この日のタスク・稼働不可はありません。<div class="actions"><button class="ghost" type="button" id="openSelectedDayTimelineEmpty">タイムラインで見る</button></div></div>`;
    $('openSelectedDayTimelineEmpty')?.addEventListener('click',()=>openDateOnBoard(dateIso));
    return;
  }

  box.innerHTML = `<div class="selectedDayTop"><button class="primary" type="button" id="openSelectedDayTimeline">タイムラインで調整</button></div>
    <div class="selectedDayGroups">${groups.map(({mem,items})=>`
      <section class="selectedDayGroup" style="--member-color:${esc(mem.color || '#5d9cec')}">
        <h3><span class="memberEmojiMini">${esc(mem.emoji || '🌙')}</span>${esc(mem.name)}<small>${items.length}件</small></h3>
        <div class="selectedDayCardGrid">
          ${items.map(({type,task:t})=>`
            <article class="selectedDayCard ${type==='unavailable'?'unavailable':''} ${t.done?'done':''}" style="--task-color:${esc(categoryColor(t.category))}">
              <span class="timeBadge">${esc(formatTaskTime(t))}</span>
              <b>${esc(taskTitleForList(t))}</b>
              <small>${esc(t.category || '未分類')}${t.project ? ` / ${esc(t.project)}` : ''}${t.done ? ' / 完了' : ''}</small>
              ${t.memo && !isUnavailableTask(t) ? `<p>${esc(t.memo)}</p>` : ''}
            </article>`).join('')}
        </div>
      </section>`).join('')}</div>`;
  $('openSelectedDayTimeline')?.addEventListener('click',()=>openDateOnBoard(dateIso));
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


let icsPreviewEvents = [];

function showIcsMsg(text, error=false){
  const el = $('icsImportMsg');
  if(!el) return;
  el.textContent = text;
  el.className = `notice ${error ? 'error' : 'ok'}`;
  el.classList.remove('hidden');
}
function unfoldIcs(text){
  const lines = String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const out = [];
  lines.forEach(line=>{
    if((line.startsWith(' ') || line.startsWith('\t')) && out.length){
      out[out.length-1] += line.slice(1);
    }else{
      out.push(line);
    }
  });
  return out;
}
function unescapeIcs(v){
  return String(v||'')
    .replace(/\\n/g,' ')
    .replace(/\\N/g,' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}
function parseProp(line){
  const idx = line.indexOf(':');
  if(idx < 0) return null;
  const left = line.slice(0,idx);
  const value = line.slice(idx+1);
  const parts = left.split(';');
  const name = parts.shift().toUpperCase();
  const params = {};
  parts.forEach(p=>{
    const eq = p.indexOf('=');
    if(eq > -1) params[p.slice(0,eq).toUpperCase()] = p.slice(eq+1);
  });
  return { name, params, value };
}
function pad2(n){ return String(n).padStart(2,'0'); }
function localPartsFromDate(d){
  return { date:`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`, time:`${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
function parseIcsDate(prop){
  if(!prop) return null;
  const value = prop.value.trim();
  const isDateOnly = prop.params?.VALUE === 'DATE' || /^\d{8}$/.test(value);
  if(isDateOnly){
    return { allDay:true, date:`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`, time:'00:00', raw:value };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if(!m) return null;
  const [,yy,mo,dd,hh,mi,ss,z] = m;
  if(z){
    const d = new Date(Date.UTC(Number(yy), Number(mo)-1, Number(dd), Number(hh), Number(mi), Number(ss||0)));
    return { allDay:false, ...localPartsFromDate(d), raw:value };
  }
  return { allDay:false, date:`${yy}-${mo}-${dd}`, time:`${hh}:${mi}`, raw:value };
}
function dateFromIso(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y,m-1,d);
}
function addDateDays(iso, days){
  const d = dateFromIso(iso);
  d.setDate(d.getDate()+days);
  return toISO(d);
}
function addMonths(iso, months){
  const d = dateFromIso(iso);
  const day = d.getDate();
  d.setMonth(d.getMonth()+months);
  if(d.getDate() !== day) d.setDate(0);
  return toISO(d);
}
function weekdayCode(iso){
  return ['SU','MO','TU','WE','TH','FR','SA'][dateFromIso(iso).getDay()];
}
function parseRRule(text){
  const out = {};
  String(text||'').split(';').forEach(part=>{
    const [k,v] = part.split('=');
    if(k) out[k.toUpperCase()] = v;
  });
  return out;
}
function parseExDates(props){
  const set = new Set();
  props.filter(p=>p.name==='EXDATE').forEach(p=>{
    p.value.split(',').forEach(v=>{
      const parsed = parseIcsDate({ ...p, value:v });
      if(parsed?.date) set.add(parsed.date);
    });
  });
  return set;
}
function minutesToTime(min){ return fullClock(min).slice(0,5); }
function buildEventInstance(base, date){
  const startMin = minutesFromTime(base.startTime || '00:00');
  const duration = base.allDay ? DAY_MINUTES : Math.max(15, base.duration || 60);
  return {
    uid: `${base.uid || base.summary || 'event'}-${date}-${base.startTime || '00:00'}`,
    date,
    startTime: base.allDay ? '00:00' : (base.startTime || '00:00'),
    endTime: base.allDay ? '23:59' : minutesToTime(startMin + duration),
    duration: base.allDay ? DAY_MINUTES : duration,
    allDay: base.allDay,
    summary: base.summary || 'Googleカレンダー予定'
  };
}
function expandRecurring(base, rruleText, exDates, monthStart, monthEnd){
  const rule = parseRRule(rruleText);
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL || 1));
  const countLimit = rule.COUNT ? Number(rule.COUNT) : 500;
  const untilParsed = rule.UNTIL ? parseIcsDate({ value: rule.UNTIL, params:{} }) : null;
  const until = untilParsed?.date || monthEnd;
  const bydays = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const result = [];
  let safety = 0;

  if(freq === 'DAILY'){
    let cur = base.startDate;
    let count = 0;
    while(cur <= monthEnd && cur <= until && count < countLimit && safety++ < 2000){
      if(cur >= monthStart && !exDates.has(cur)) result.push(buildEventInstance(base, cur));
      cur = addDateDays(cur, interval);
      count++;
    }
  }else if(freq === 'WEEKLY'){
    let cur = base.startDate;
    let count = 0;
    const validDays = bydays || [weekdayCode(base.startDate)];
    while(cur <= monthEnd && cur <= until && count < countLimit && safety++ < 2000){
      const weekStart = addDateDays(cur, -((dateFromIso(cur).getDay()+6)%7));
      validDays.forEach(code=>{
        const idx = {MO:0,TU:1,WE:2,TH:3,FR:4,SA:5,SU:6}[code] ?? 0;
        const d = addDateDays(weekStart, idx);
        if(d >= base.startDate && d >= monthStart && d <= monthEnd && d <= until && !exDates.has(d)) result.push(buildEventInstance(base, d));
      });
      cur = addDateDays(cur, interval*7);
      count++;
    }
  }else if(freq === 'MONTHLY'){
    let cur = base.startDate;
    let count = 0;
    while(cur <= monthEnd && cur <= until && count < countLimit && safety++ < 500){
      if(cur >= monthStart && !exDates.has(cur)) result.push(buildEventInstance(base, cur));
      cur = addMonths(cur, interval);
      count++;
    }
  }else{
    if(base.startDate >= monthStart && base.startDate <= monthEnd && !exDates.has(base.startDate)) result.push(buildEventInstance(base, base.startDate));
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}
function parseIcsEvents(text){
  const lines = unfoldIcs(text);
  const events = [];
  let current = null;
  lines.forEach(line=>{
    if(line === 'BEGIN:VEVENT') current = [];
    else if(line === 'END:VEVENT'){
      if(current) events.push(current);
      current = null;
    }else if(current){
      const prop = parseProp(line);
      if(prop) current.push(prop);
    }
  });

  const [y,m] = state.calendarMonth.split('-').map(Number);
  const monthStart = `${y}-${pad2(m)}-01`;
  const monthEnd = toISO(new Date(y, m, 0));
  const output = [];

  events.forEach(props=>{
    const get = name => props.find(p=>p.name===name);
    const start = parseIcsDate(get('DTSTART'));
    if(!start) return;
    const end = parseIcsDate(get('DTEND'));
    const summary = unescapeIcs(get('SUMMARY')?.value || 'Googleカレンダー予定');
    const uid = unescapeIcs(get('UID')?.value || summary);
    let duration = DAY_MINUTES;
    if(!start.allDay){
      const startMin = minutesFromTime(start.time);
      let endMin = end?.date === start.date ? minutesFromTime(end.time) : (end ? minutesFromTime(end.time) + DAY_MINUTES : startMin + 60);
      duration = Math.max(15, snap15(endMin - startMin));
    }
    const base = { uid, summary, startDate:start.date, startTime:start.time, duration, allDay:start.allDay };
    const exDates = parseExDates(props);
    const rrule = get('RRULE')?.value;
    if(rrule){
      output.push(...expandRecurring(base, rrule, exDates, monthStart, monthEnd));
    }else{
      if(start.allDay && end?.date){
        let cur = start.date;
        const last = addDateDays(end.date, -1);
        while(cur <= last){
          if(cur >= monthStart && cur <= monthEnd && !exDates.has(cur)) output.push(buildEventInstance(base, cur));
          cur = addDateDays(cur, 1);
        }
      }else if(start.date >= monthStart && start.date <= monthEnd && !exDates.has(start.date)){
        output.push(buildEventInstance(base, start.date));
      }
    }
  });

  const seen = new Set();
  return output
    .filter(e=>{
      const key = `${e.date}|${e.startTime}|${e.duration}|${e.summary}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a,b)=>a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}
function renderIcsPreview(){
  const box = $('icsPreview');
  const actions = $('icsImportActions');
  if(!box || !actions) return;
  if(!icsPreviewEvents.length){
    box.innerHTML = '<div class="empty">読み込んだ予定はありません。</div>';
    actions.classList.add('hidden');
    return;
  }
  actions.classList.remove('hidden');
  box.innerHTML = `<div class="icsPreviewList">${icsPreviewEvents.map((e,i)=>`
    <label class="icsItem">
      <input type="checkbox" data-ics-index="${i}" checked>
      <span class="icsDate">${esc(e.date)}</span>
      <span class="icsTime">${e.allDay ? '終日' : `${esc(e.startTime)}〜${esc(e.endTime)}`}</span>
      <b>${esc(e.summary)}</b>
    </label>`).join('')}</div>`;
}
async function loadIcsFile(){
  const input = $('icsFileInput');
  const file = input?.files?.[0];
  if(!file) return alert('.icsファイルを選んでください');
  try{
    const text = await file.text();
    icsPreviewEvents = parseIcsEvents(text);
    renderIcsPreview();
    showIcsMsg(`${icsPreviewEvents.length}件の予定を読み込みました。取り込む予定にチェックを入れてください。`);
  }catch(e){
    console.error(e);
    showIcsMsg(e.message || '.icsの読み込みに失敗しました', true);
  }
}
async function importSelectedIcs(){
  const checks = [...document.querySelectorAll('[data-ics-index]:checked')];
  if(!checks.length) return alert('取り込む予定を選んでください');
  let created = 0, skipped = 0;
  for(const chk of checks){
    const ev = icsPreviewEvents[Number(chk.dataset.icsIndex)];
    if(!ev) continue;
    const exists = taskArray().some(t=>
      t.owner_id===state.user.id &&
      isUnavailableTask(t) &&
      t.schedule_date===ev.date &&
      String(t.start_time||'00:00').slice(0,5)===ev.startTime &&
      Number(t.estimated_minutes||0)===Number(ev.duration||0) &&
      String(t.memo||'').includes(ev.summary)
    );
    if(exists){ skipped++; continue; }
    await createTask({
      team_id:state.team.id,
      owner_id:state.user.id,
      created_by:state.user.id,
      title: ev.allDay ? '終日稼働不可' : '稼働不可時間',
      category:'稼働不可',
      project:'Googleカレンダー',
      task_type:'',
      estimated_minutes: ev.duration,
      start_time: ev.startTime,
      schedule_date: ev.date,
      due_date: ev.date,
      occurrence:'single',
      status:'scheduled',
      memo: ev.summary || 'Googleカレンダー予定',
      sort_order:Date.now()*-1 - created
    });
    created++;
  }
  await refreshAll();
  showIcsMsg(`${created}件を稼働不可として取り込みました。${skipped ? `重複っぽい予定 ${skipped}件はスキップしました。` : ''}`);
}

export function initCalendarEvents(){
  $('calendarMonth').addEventListener('change',()=>{ state.calendarMonth = $('calendarMonth').value; renderCalendar(); });
  $('calendarThisMonth').addEventListener('click',()=>{ state.calendarMonth = new Date().toISOString().slice(0,7); renderCalendar(); });
  $('icsParseBtn')?.addEventListener('click', loadIcsFile);
  $('icsFileInput')?.addEventListener('change', loadIcsFile);
  $('icsSelectAllBtn')?.addEventListener('click',()=>document.querySelectorAll('[data-ics-index]').forEach(c=>c.checked=true));
  $('icsClearAllBtn')?.addEventListener('click',()=>document.querySelectorAll('[data-ics-index]').forEach(c=>c.checked=false));
  $('icsImportBtn')?.addEventListener('click', importSelectedIcs);
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
