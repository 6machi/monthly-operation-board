import { $, esc, toISO, todayISO, diffDays, taskOccursOnDate, minutesFromTime, fullClock, fmtDate } from './utils.js?v=86';
import { state } from './state.js?v=86';
import { openDateOnBoard, openTaskEditor, arrangeTasksOnDate } from './board.js?v=86';
import { createTask, deleteTask, updateTask } from './tasks.js?v=86';
import { refreshAll } from './app.js?v=86';

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
  renderGanttBoard();
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


function selectCalendarDate(iso, shouldScroll=true){
  if(!iso) return;
  selectedCalendarDate = iso;
  try{ renderMonthGrid(); }catch(e){ console.error('calendar grid refresh error', e); }
  try{ renderSelectedDayTasks(); }catch(e){ console.error('selected day render error', e); }
  if(shouldScroll){
    requestAnimationFrame(()=>{
      const panel = $('selectedDayPanel');
      if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }
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
    const allDayMembers = memberArray().filter(mem=>isUnavailableForMember(iso, mem.id));
    const unavailableMembers = allDayMembers;
    const membersWithTasks = memberArray().map(mem=>{
      const tasks = visibleTasksOnDate(iso, mem.id);
      return { mem, count: tasks.length, carry: tasks.filter(t=>t.carryover_date===iso).length };
    }).filter(x=>x.count>0);

    const { total, carryovers } = relativeMonthStats(iso);
    const cell = document.createElement('button');
    cell.type='button';
    cell.className='dayCell fancy';
    cell.dataset.date = iso;
    cell.setAttribute('aria-label', `${iso} の予定を見る`);
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

    const footer = `<div class="dayMood">${allDayMembers.length ? '稼働不可' : (carryovers ? `持ち越し ${carryovers}件` : '持ち越しなし')}</div>`;
    cell.innerHTML = header + chips + footer;
    cell.addEventListener('click',(ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      selectCalendarDate(iso, true);
    });
    grid.appendChild(cell);
  }
}


function taskSpanInMonth(t, month){
  const [y,m] = month.split('-').map(Number);
  const monthStart = `${y}-${pad2(m)}-01`;
  const monthEnd = toISO(new Date(y, m, 0));
  const rawStart = t.schedule_date || t.carryover_date || t.due_date || monthStart;
  const rawEnd = t.due_date || t.schedule_date || t.carryover_date || rawStart;
  const start = rawStart < monthStart ? monthStart : rawStart;
  const end = rawEnd > monthEnd ? monthEnd : rawEnd;
  if(end < monthStart || start > monthEnd) return null;
  const startDay = Number(start.slice(8,10));
  const endDay = Number(end.slice(8,10));
  return { start, end, startDay, endDay, span: Math.max(1, endDay - startDay + 1) };
}
function taskOwner(t){
  return memberArray().find(m=>m.id===t.owner_id) || { name:'不明', emoji:'?', color:'#9aa4b6' };
}
function splitTaskBaseTitle(title){
  const raw = String(title || '無題のタスク').trim();
  const m = raw.match(/^(.*?)[\s　]*[（(]\s*\d+\s*\/\s*\d+\s*[）)]\s*$/);
  return (m ? m[1] : raw).trim() || raw;
}
function isSplitLikeTask(t){
  return /[（(]\s*\d+\s*\/\s*\d+\s*[）)]\s*$/.test(String(t?.title || ''));
}
function categorySortIndex(name){
  const idx = (state.tree || []).findIndex(c=>c?.name===name);
  return idx < 0 ? 9999 : idx;
}
function projectSortIndex(category, project){
  const cat = (state.tree || []).find(c=>c?.name===category);
  const idx = (cat?.projects || []).findIndex(p=>p?.name===project);
  return idx < 0 ? 9999 : idx;
}
function ganttGroupName(t){
  const project = String(t?.project || '').trim();
  return project && project !== '未分類' ? project : '未分類グループ';
}
function ganttTaskName(t){
  return splitTaskBaseTitle(t?.title || '未分類タスク');
}
function ganttDetailTitle(t){
  const title = splitTaskBaseTitle(t?.title || '無題のタスク');
  const memoLine = String(t?.memo || '')
    .split('\n')
    .map(x=>x.trim())
    .find(x=>x && !x.startsWith('#') && !x.startsWith('納期から逆算：'));
  return memoLine || title || '無題のタスク';
}
function isGanttSpanTask(t){
  return t?.task_type === 'gantt_span' || String(t?.memo || '').includes('#gantt-span');
}
function visibleGanttDays(y,m){
  // ガンチャはスプレッドシートのように「今見るべき列」から始める。
  // 今月は必ず今日を左端にする。未来月は1日から、過去月は表示しない。
  const today = todayISO();
  const currentMonth = today.slice(0,7);
  const targetMonth = `${y}-${String(m).padStart(2,'0')}`;
  const last = new Date(y,m,0).getDate();
  if(targetMonth < currentMonth) return [];
  const startDay = targetMonth === currentMonth ? Number(today.slice(8,10)) : 1;
  return Array.from({length:Math.max(0,last - startDay + 1)},(_,i)=>startDay+i);
}
function ganttTaskGroups(){
  const month = state.calendarMonth;
  const rawItems = taskArray()
    .filter(t=>t && t.id && !isUnavailableTask(t))
    .map(t=>({ task:t, span:taskSpanInMonth(t, month) }))
    .filter(x=>x.span);

  const barGroups = new Map();
  rawItems.forEach(({task, span})=>{
    const category = task.category || '未分類';
    const groupName = ganttGroupName(task);
    const taskName = ganttTaskName(task);
    const detailTitle = ganttDetailTitle(task);
    const splitLike = isSplitLikeTask(task);
    const key = splitLike
      ? [task.owner_id || '', category, groupName, taskName, detailTitle].join('::')
      : `single::${task.id}`;
    if(!barGroups.has(key)) barGroups.set(key, {
      key,
      category,
      groupName,
      taskName,
      rowName: taskName,
      detailTitle,
      owner_id: task.owner_id,
      project: task.project || '',
      tasks: [],
      spans: [],
      splitLike
    });
    const g = barGroups.get(key);
    g.tasks.push(task);
    g.spans.push(span);
  });

  const bars = Array.from(barGroups.values()).map(g=>{
    const startDay = Math.min(...g.spans.map(s=>s.startDay));
    const endDay = Math.max(...g.spans.map(s=>s.endDay));
    const dueDates = g.tasks.map(t=>t.due_date || '').filter(Boolean).sort();
    const scheduleDates = g.tasks.map(t=>t.schedule_date || t.carryover_date || '').filter(Boolean).sort();
    const doneCount = g.tasks.filter(t=>t.done).length;
    const totalCount = g.tasks.length;
    const representative = g.tasks.find(t=>!t.done) || g.tasks[0];
    return {
      ...g,
      task: representative,
      span: { startDay, endDay, span: Math.max(1, endDay - startDay + 1) },
      due_date: dueDates[dueDates.length-1] || g.spans.map(s=>s.end).sort().at(-1) || '',
      start_date: scheduleDates[0] || g.spans.map(s=>s.start).sort()[0] || '',
      doneCount,
      totalCount,
      done: totalCount > 0 && doneCount === totalCount,
      isSpan: isGanttSpanTask(representative) || startDay !== endDay || totalCount > 1
    };
  });

  const rows = new Map();
  bars.forEach(bar=>{
    const rowKey = [bar.category, bar.groupName || '未分類グループ', bar.taskName || bar.rowName, bar.owner_id || ''].join('::');
    if(!rows.has(rowKey)) rows.set(rowKey, {
      key: rowKey,
      category: bar.category,
      groupName: bar.groupName || '未分類グループ',
      taskName: bar.taskName || bar.rowName,
      rowName: bar.taskName || bar.rowName,
      owner_id: bar.owner_id,
      bars: []
    });
    rows.get(rowKey).bars.push(bar);
  });

  // カテゴリ管理にある「カテゴリ > グループ > タスク名称候補」は、予定がまだ0件でも左列に出す。
  // これにより、スプレッドシートの空セルへ直接ガンチャ予定を入力できる。
  (state.tree || []).forEach(cat=>{
    const category = cat?.name || '未分類';
    (cat?.projects || []).forEach(project=>{
      const groupName = project?.name || '未分類グループ';
      (project?.candidates || []).forEach(candidate=>{
        const taskName = String(candidate || '').trim();
        if(!taskName) return;
        const rowKey = [category, groupName, taskName, state.user?.id || ''].join('::');
        if(!rows.has(rowKey)) rows.set(rowKey, {
          key: rowKey,
          category,
          groupName,
          taskName,
          rowName: taskName,
          owner_id: state.user?.id,
          bars: []
        });
      });
    });
  });

  return Array.from(rows.values()).map(row=>{
    row.bars.sort((a,b)=>
      Number(a.span.startDay)-Number(b.span.startDay)
      || Number(a.span.endDay)-Number(b.span.endDay)
      || String(a.due_date||'').localeCompare(String(b.due_date||''))
      || String(a.detailTitle||'').localeCompare(String(b.detailTitle||''),'ja')
    );
    return row;
  }).sort((a,b)=>
    categorySortIndex(a.category)-categorySortIndex(b.category)
    || String(a.category||'未分類').localeCompare(String(b.category||'未分類'),'ja')
    || projectSortIndex(a.category, a.groupName)-projectSortIndex(b.category, b.groupName)
    || String(a.groupName||'').localeCompare(String(b.groupName||''),'ja')
    || String(a.taskName||'').localeCompare(String(b.taskName||''),'ja')
  );
}
function dayLabel(y,m,d){
  const dt = new Date(y, m-1, d);
  return ['日','月','火','水','木','金','土'][dt.getDay()];
}
function tasksForSheetCell(item, iso){
  return (item.tasks || []).filter(t=>{
    if(!t || t.done) return false;
    if(t.carryover_date === iso || t.schedule_date === iso || t.due_date === iso) return true;
    try{ return taskOccursOnDate(t, iso); }catch(e){ return false; }
  }).sort((a,b)=>String(a.start_time||'').localeCompare(String(b.start_time||'')) || String(a.title||'').localeCompare(String(b.title||''),'ja'));
}
function cellTaskLabel(t, baseTitle, grouped=false){
  const title = String(t?.title || baseTitle || '無題のタスク').trim();
  const memo = String(t?.memo || '').trim().split('\n').find(Boolean) || '';
  if(grouped && baseTitle && title.startsWith(baseTitle)){
    const rest = title.slice(String(baseTitle).length).trim();
    if(rest) return rest;
    if(memo) return memo;
    return '作業';
  }
  if(memo && memo.length <= 28 && memo !== title) return memo;
  return title;
}

function firstUsefulMemoLine(memo){
  return String(memo || '')
    .split('\n')
    .map(x=>x.trim())
    .find(x=>x && !x.startsWith('#') && !x.startsWith('納期から逆算：')) || '';
}
function extraMemoLines(memo, detail=''){
  const d = String(detail || '').trim();
  return String(memo || '')
    .split('\n')
    .map(x=>x.trim())
    .filter(x=>x && x !== d && x !== '#gantt-span')
    .filter(x=>!x.startsWith('納期から逆算：'));
}
function composeGanttMemo(detail, extra, isSpan){
  const lines = [];
  const d = String(detail || '').trim();
  if(d) lines.push(d);
  String(extra || '').split('\n').map(x=>x.trim()).filter(Boolean).forEach(x=>{
    if(x !== d && x !== '#gantt-span') lines.push(x);
  });
  if(isSpan) lines.push('#gantt-span');
  return lines.join('\n');
}
function normalizeEndDate(start, end){
  if(!start) return end || todayISO();
  if(!end || end < start) return start;
  return end;
}
function ensureGanttQuickEditor(){
  let modal = document.getElementById('ganttQuickModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'ganttQuickModal';
  modal.className = 'taskEditModal hidden';
  modal.innerHTML = `
    <div class="taskEditBackdrop" data-close-gantt-editor></div>
    <section class="taskEditPanel ganttQuickPanel" role="dialog" aria-modal="true" aria-label="ガンチャ予定を編集">
      <div class="taskEditPanelHead">
        <div><h2 id="ganttQuickTitle">ガンチャ予定を追加</h2></div>
        <button class="ghost" type="button" data-close-gantt-editor>閉じる</button>
      </div>
      <div class="form taskEditQuickForm">
        <label><small>カテゴリ</small><select id="ganttQuickCategory"></select></label>
        <label><small>グループ</small><input id="ganttQuickGroup" placeholder="例：ネーム"></label>
        <label><small>タスク名称</small><input id="ganttQuickTaskName" placeholder="例：通常業務／トーン"></label>
        <label><small>ガンチャ上の詳細</small><input id="ganttQuickDetail" placeholder="例：25話初稿／初稿〆切"></label>
        <label><small>開始日</small><input id="ganttQuickStart" type="date"></label>
        <label><small>期限</small><input id="ganttQuickDue" type="date"></label>
        <label><small>1日あたり見積もり時間 分</small><input id="ganttQuickMinutes" type="number" min="15" step="15" value="60"></label>
        <label><small>タイムライン開始目安</small><input id="ganttQuickStartTime" type="time" step="900" value="09:00"></label>
        <label style="grid-column:1/-1"><small>補足メモ</small><textarea id="ganttQuickMemo" placeholder="確認先・注意点など。空でもOK"></textarea></label>
      </div>
      <div class="ganttQuickHint">左の「カテゴリ ＞ グループ ＞ タスク名称」は行として使い、右の日付バーには「ガンチャ上の詳細」が表示されます。</div>
      <div class="actions">
        <button class="primary" type="button" id="saveGanttQuickTask">保存</button>
        <button class="danger hidden" type="button" id="deleteGanttQuickTask">削除</button>
      </div>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-gantt-editor]').forEach(btn=>btn.addEventListener('click', closeGanttQuickEditor));
  return modal;
}
function closeGanttQuickEditor(){
  const modal = document.getElementById('ganttQuickModal');
  if(modal) modal.classList.add('hidden');
}
function fillGanttCategoryOptions(current){
  const select = $('ganttQuickCategory');
  const names = (state.tree || []).map(c=>c?.name).filter(Boolean);
  const fallback = current || names[0] || '未分類';
  const values = names.includes(fallback) ? names : [fallback, ...names];
  select.innerHTML = values.map(v=>`<option value="${esc(v)}" ${v===fallback?'selected':''}>${esc(v)}</option>`).join('');
}
function openGanttQuickEditor({ task=null, date=null, category='', groupName='', taskName='' } = {}){
  if(!state.user) return alert('ログイン後に使えます');
  if(task && task.owner_id !== state.user?.id) return alert('他メンバーの予定は閲覧のみです。');
  const modal = ensureGanttQuickEditor();
  const start = task?.schedule_date || task?.carryover_date || date || selectedCalendarDate || todayISO();
  const due = normalizeEndDate(start, task?.due_date || date || start);
  const currentCategory = task?.category || category || (state.tree?.[0]?.name) || '未分類';
  const currentGroup = task ? ganttGroupName(task) : (groupName || '未分類グループ');
  const currentTaskName = task ? ganttTaskName(task) : (taskName || '');
  const detail = task ? ganttDetailTitle(task) : '';
  fillGanttCategoryOptions(currentCategory);
  $('ganttQuickGroup').value = currentGroup || '';
  $('ganttQuickTaskName').value = currentTaskName || '';
  $('ganttQuickDetail').value = detail || '';
  $('ganttQuickStart').value = start || todayISO();
  $('ganttQuickDue').value = due || start || todayISO();
  $('ganttQuickMinutes').value = Math.max(15, Math.round(Number(task?.estimated_minutes || 60)/15)*15);
  $('ganttQuickStartTime').value = task?.start_time || '09:00';
  $('ganttQuickMemo').value = task ? extraMemoLines(task.memo, detail).join('\n') : '';
  $('ganttQuickTitle').textContent = task ? 'ガンチャ予定を編集' : 'ガンチャ予定を追加';
  const del = $('deleteGanttQuickTask');
  del.classList.toggle('hidden', !task);
  del.onclick = async()=>{
    if(!task) return;
    if(!confirm(`ガンチャ予定「${ganttDetailTitle(task)}」を削除しますか？`)) return;
    await deleteTask(task.id);
    closeGanttQuickEditor();
    await refreshAll();
  };
  $('saveGanttQuickTask').onclick = async()=>{
    const startDate = $('ganttQuickStart').value || date || todayISO();
    const dueDate = normalizeEndDate(startDate, $('ganttQuickDue').value || startDate);
    const isSpan = dueDate && startDate && dueDate > startDate;
    const detailValue = $('ganttQuickDetail').value.trim() || '作業';
    const rowTaskName = $('ganttQuickTaskName').value.trim() || detailValue;
    const payload = {
      category: $('ganttQuickCategory').value || '未分類',
      project: $('ganttQuickGroup').value.trim() || '未分類グループ',
      title: rowTaskName,
      task_type: isSpan ? 'gantt_span' : '',
      estimated_minutes: Math.max(15, Math.round(Number($('ganttQuickMinutes').value || 60)/15)*15),
      start_time: $('ganttQuickStartTime').value || '09:00',
      schedule_date: startDate,
      carryover_date: null,
      due_date: dueDate,
      occurrence: 'single',
      status: 'scheduled',
      done: false,
      memo: composeGanttMemo(detailValue, $('ganttQuickMemo').value, isSpan)
    };
    if(task){
      await updateTask(task.id, payload);
    }else{
      await createTask({
        team_id: state.team.id,
        owner_id: state.user.id,
        created_by: state.user.id,
        ...payload,
        sort_order: Date.now()*-1
      });
    }
    closeGanttQuickEditor();
    await refreshAll();
  };
  modal.classList.remove('hidden');
  setTimeout(()=>$('ganttQuickDetail')?.focus(), 0);
}
function renderGanttBoard(){
  const board = $('ganttBoard');
  if(!board) return;
  const [y,m] = state.calendarMonth.split('-').map(Number);
  const last = new Date(y,m,0).getDate();
  const days = visibleGanttDays(y,m);
  const visibleFirstDay = days[0] || 1;
  const today = todayISO();
  const currentMonth = today.slice(0,7);
  const rangeLabel = state.calendarMonth === currentMonth
    ? `${Number(today.slice(5,7))}/${Number(today.slice(8,10))} 今日から`
    : `${m}/1 から`;
  if(!days.length){
    board.innerHTML = '<div class="empty">今日以降のガンチャ予定はありません。<br><button class="primary" type="button" id="ganttEmptyAddBtn">ガンチャ予定を追加</button></div>'; const add=$('ganttEmptyAddBtn'); if(add) add.addEventListener('click',()=>openGanttQuickEditor({date:todayISO()}));
    return;
  }
  const rows = ganttTaskGroups().map(row=>({
    ...row,
    bars:(row.bars || []).filter(bar=>bar.span.endDay >= visibleFirstDay && bar.span.startDay <= last)
  }));
  const groups = new Map();
  rows.forEach(row=>{
    const key = row.category || '未分類';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  if(!rows.length){
    board.innerHTML = '<div class="empty">今日以降のガンチャ予定はありません。<br><button class="primary" type="button" id="ganttEmptyAddBtn">ガンチャ予定を追加</button></div>'; const add=$('ganttEmptyAddBtn'); if(add) add.addEventListener('click',()=>openGanttQuickEditor({date:todayISO()}));
    return;
  }
  board.innerHTML = `
    <div class="sheetGanttScroll detailGanttScroll">
      <div class="sheetHeader" style="--days:${days.length}">
        <div class="sheetTaskHead"><span>カテゴリ / グループ / タスク名称</span><small>${esc(rangeLabel)}</small></div>
        <div class="sheetDates">${days.map(d=>{
          const iso = `${state.calendarMonth}-${String(d).padStart(2,'0')}`;
          const w = dayLabel(y,m,d);
          const cls = `${iso===today?'today':''} ${w==='土'?'sat':''} ${w==='日'?'sun':''}`;
          const todayText = iso===today ? '今日' : w;
          return `<button type="button" class="sheetDate ${cls}" data-gantt-date="${iso}"><b>${d}</b><span>${todayText}</span></button>`;
        }).join('')}</div>
      </div>
      <div class="sheetRows">
        ${Array.from(groups.entries()).map(([category,arr])=>{
          const color = categoryColor(category);
          const catTotal = arr.reduce((sum,row)=>sum + row.bars.length, 0);
          return `<section class="sheetCategory" style="--cat-color:${esc(color)};--days:${days.length}">
            <div class="sheetCategoryTitle"><b>${esc(category)}</b><small>${catTotal}件</small></div>
            ${arr.map(row=>{
              const mem = taskOwner(row.bars[0]?.task || { owner_id: row.owner_id });
              const laneCount = Math.max(1, row.bars.length);
              const dueSoon = row.bars.some(bar=>bar.due_date && diffDays(bar.due_date, today) <= 3 && !bar.done);
              return `<div class="sheetTaskRow detailGanttRow ${dueSoon?'dueSoon':''}" style="--days:${days.length};--cat-color:${esc(color)};--lanes:${laneCount}">
                <button type="button" class="sheetTaskLabel rowOnlyLabel ganttTreeLabel" data-gantt-row-date="${esc(today)}" data-gantt-category="${esc(row.category || '')}" data-gantt-group="${esc(row.groupName || '')}" data-gantt-task-name="${esc(row.taskName || row.rowName || '')}" title="${esc(row.groupName)} / ${esc(row.taskName)}">
                  <span class="sheetOwner">${esc(mem.emoji || '🌙')}</span>
                  <span class="ganttGroupName">┗ ${esc(row.groupName || '未分類グループ')}</span>
                  <span class="sheetTaskTitle ganttTaskName">　┗ ${esc(row.taskName || row.rowName)}</span>
                  <small>${row.bars.length ? `${esc(row.bars.length)}件の予定` : 'セルをクリックして追加'}</small>
                </button>
                <div class="sheetCells detailGanttCells">
                  ${days.map(d=>{
                    const iso = `${state.calendarMonth}-${String(d).padStart(2,'0')}`;
                    const w = dayLabel(y,m,d);
                    const cls = `${iso===today?'today':''} ${w==='土'?'sat':''} ${w==='日'?'sun':''}`;
                    return `<div class="sheetCell detailGanttDay ${cls}" data-gantt-date="${iso}" data-gantt-category="${esc(row.category || '')}" data-gantt-group="${esc(row.groupName || '')}" data-gantt-task-name="${esc(row.taskName || row.rowName || '')}"></div>`;
                  }).join('')}
                  <div class="ganttBarLayer" style="--days:${days.length};--lanes:${laneCount}">
                    ${row.bars.map((bar,idx)=>{
                      const t = bar.task;
                      const title = bar.detailTitle || t.title || '無題のタスク';
                      const meta = bar.due_date ? `〆${bar.due_date.slice(5)}` : '';
                      const progress = bar.totalCount > 1 ? `${bar.doneCount}/${bar.totalCount}` : '';
                      const cls = `${bar.done?'done':''} ${bar.isSpan?'span':''} ${bar.splitLike?'grouped':''}`;
                      const startCol = Math.max(bar.span.startDay, visibleFirstDay) - visibleFirstDay + 1;
                      const endCol = Math.min(bar.span.endDay, last) - visibleFirstDay + 2;
                      return `<button type="button" class="detailGanttBar ${cls}" data-gantt-task-id="${esc(t.id)}" title="${esc(title)}" style="grid-column:${startCol} / ${endCol};grid-row:${idx + 1}">
                        <span class="detailGanttBarTitle">${esc(title)}</span>
                        ${meta || progress ? `<span class="detailGanttBarMeta">${esc([progress, meta].filter(Boolean).join(' / '))}</span>` : ''}
                      </button>`;
                    }).join('')}
                  </div>
                </div>
              </div>`;
            }).join('')}
          </section>`;
        }).join('')}
      </div>
    </div>`;

  requestAnimationFrame(()=>{
    const scroller = board.querySelector('.sheetGanttScroll');
    if(scroller) scroller.scrollLeft = 0;
  });

  board.querySelectorAll('[data-gantt-date]').forEach(btn=>btn.addEventListener('click', e=>{
    if(e.target.closest('[data-gantt-task-id]')) return;
    e.preventDefault();
    e.stopPropagation();
    const date = btn.dataset.ganttDate;
    if(btn.classList.contains('detailGanttDay')){
      openGanttQuickEditor({
        date,
        category: btn.dataset.ganttCategory || '',
        groupName: btn.dataset.ganttGroup || '',
        taskName: btn.dataset.ganttTaskName || ''
      });
      return;
    }
    if(date) selectCalendarDate(date, true);
  }));
  board.querySelectorAll('[data-gantt-row-date]').forEach(btn=>btn.addEventListener('click', e=>{
    if(e.target.closest('[data-gantt-task-id]')) return;
    e.preventDefault();
    e.stopPropagation();
    openGanttQuickEditor({
      date: btn.dataset.ganttRowDate || todayISO(),
      category: btn.dataset.ganttCategory || '',
      groupName: btn.dataset.ganttGroup || '',
      taskName: btn.dataset.ganttTaskName || ''
    });
  }));
  board.querySelectorAll('[data-gantt-task-id]').forEach(btn=>btn.addEventListener('click', e=>{
    e.preventDefault();
    e.stopPropagation();
    const t = taskArray().find(x=>String(x.id)===String(btn.dataset.ganttTaskId));
    if(!t) return;
    openGanttQuickEditor({ task:t });
  }));
}
function showGanttMsg(text, error=false){
  const el = $('ganttMsg');
  if(!el) return;
  el.textContent = text;
  el.className = `notice ${error?'error':'ok'}`;
  el.classList.remove('hidden');
}
function assignGanttToToday(){
  try{
    openDateOnBoard(todayISO());
    showGanttMsg('今日やることへ移動して、未完了タスクを今から入れ直します。');
    setTimeout(()=>{
      const btn = $('reflowFromTodayBtn');
      if(btn) btn.click();
    }, 180);
  }catch(e){
    console.error(e);
    showGanttMsg(e.message || '今日のタイムラインへの自動配置に失敗しました', true);
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

  box.innerHTML = `<div class="selectedDayTop"><button class="primary" type="button" id="autoArrangeSelectedDay">タイムラインへ自動配置</button><button class="ghost" type="button" id="openSelectedDayTimeline">タイムラインで調整</button></div>
    <div class="selectedDayGroups">${groups.map(({mem,items})=>`
      <section class="selectedDayGroup" style="--member-color:${esc(mem.color || '#5d9cec')}">
        <h3><span class="memberEmojiMini">${esc(mem.emoji || '🌙')}</span>${esc(mem.name)}<small>${items.length}件</small></h3>
        <div class="selectedDayCardGrid">
          ${items.map(({type,task:t})=>`
            <article class="selectedDayCard ${type==='unavailable'?'unavailable':''} ${t.done?'done':''} ${t.owner_id===state.user?.id?'editable':''}" data-selected-task-id="${esc(t.id)}" style="--task-color:${esc(categoryColor(t.category))}" title="${t.owner_id===state.user?.id?'クリックして修正':'閲覧のみ'}">
              <span class="timeBadge">${esc(formatTaskTime(t))}</span>
              <b>${esc(taskTitleForList(t))}</b>
              <small>${esc(t.category || '未分類')}${t.project ? ` / ${esc(t.project)}` : ''}${t.done ? ' / 完了' : ''}</small>
              ${t.memo && !isUnavailableTask(t) ? `<p>${esc(t.memo)}</p>` : ''}
              ${t.owner_id===state.user?.id && !t.done && type!=='unavailable' ? `<div class="selectedDayActions"><button type="button" class="selectedDayDoneBtn" data-selected-done-id="${esc(t.id)}">✓ 完了</button><button type="button" class="selectedDayEditBtn" data-selected-edit-id="${esc(t.id)}">修正</button></div>` : ''}
            </article>`).join('')}
        </div>
      </section>`).join('')}</div>`;
  $('autoArrangeSelectedDay')?.addEventListener('click', async()=>{ await arrangeTasksOnDate(dateIso); openDateOnBoard(dateIso); });
  $('openSelectedDayTimeline')?.addEventListener('click',()=>openDateOnBoard(dateIso));
  box.querySelectorAll('[data-selected-done-id]').forEach(btn=>{
    btn.addEventListener('click', async(e)=>{
      e.preventDefault();
      e.stopPropagation();
      const t = taskArray().find(x=>String(x.id)===String(btn.dataset.selectedDoneId));
      if(!t) return;
      await updateTask(t.id, { done:true, status:'done' });
      await refreshAll();
    });
  });
  box.querySelectorAll('[data-selected-edit-id]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const t = taskArray().find(x=>String(x.id)===String(btn.dataset.selectedEditId));
      if(t) openTaskEditor(t);
    });
  });
  box.querySelectorAll('[data-selected-task-id]').forEach(card=>{
    card.addEventListener('click',()=>{
      const t = taskArray().find(x=>String(x.id)===String(card.dataset.selectedTaskId));
      if(!t) return;
      if(t.owner_id !== state.user?.id){
        alert('他メンバーの予定は閲覧のみです。');
        return;
      }
      openTaskEditor(t);
    });
  });
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
  $('ganttQuickAddBtn')?.addEventListener('click',()=>openGanttQuickEditor({date:todayISO()}));
  $('ganttAssignTodayBtn')?.addEventListener('click', assignGanttToToday);
  $('ganttOpenTodayBtn')?.addEventListener('click',()=>openDateOnBoard(todayISO()));
  $('icsParseBtn')?.addEventListener('click', loadIcsFile);
  $('icsFileInput')?.addEventListener('change', loadIcsFile);
  $('icsSelectAllBtn')?.addEventListener('click',()=>document.querySelectorAll('[data-ics-index]').forEach(c=>c.checked=true));
  $('icsClearAllBtn')?.addEventListener('click',()=>document.querySelectorAll('[data-ics-index]').forEach(c=>c.checked=false));
  $('icsImportBtn')?.addEventListener('click', importSelectedIcs);
  $('openProfileFromCalendar')?.addEventListener('click',()=>{ import('./app.js?v=86').then(m=>m.showView('profile')); });
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
