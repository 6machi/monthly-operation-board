import { $, esc, todayISO, addDays, fmtDate, diffDays, relativeFrom, taskOccursOnDate, occurrenceLabel, fullClock, minutesFromTime } from './utils.js?v=46';
import { state } from './state.js?v=46';
import { createTask, markCarryover, returnToSchedule, updateTask, deleteTask } from './tasks.js?v=46';
import { refreshAll, showView } from './app.js?v=46';
import { isUnavailableTask, isUnavailableForMember, unavailableBlocksForMember } from './calendar.js?v=46';

const SLOT_MINUTES = 15;
const PX_PER_MINUTE = 1.15; // 15分 = 約17px / 60分 = 約69px
const DAY_MINUTES = 24 * 60;
const DEFAULT_START_MINUTES = 9 * 60;
function taskArray(){ return Array.isArray(state.tasks) ? state.tasks.filter(t=>t && typeof t === 'object') : []; }
function memberArray(){ return Array.isArray(state.members) ? state.members.filter(m=>m && typeof m === 'object') : []; }

function uniq(arr){ return [...new Set((arr||[]).map(v=>String(v||'').trim()).filter(Boolean))]; }
function normalizeQuickCategory(c){
  if(!c) return c;
  if(!Array.isArray(c.projects)) c.projects=[];
  const categoryLevelCandidates = uniq(c.candidates || []);
  const normalizedProjects = [];
  c.projects.forEach(p=>{
    if(typeof p === 'string'){
      normalizedProjects.push({ name:p, candidates:[] });
      return;
    }
    if(!p?.name) return;
    const candidates = [];
    if(Array.isArray(p.candidates)) candidates.push(...p.candidates);
    (p.types||[]).forEach(ty=>(ty?.tasks||[]).forEach(t=>candidates.push(t)));
    normalizedProjects.push({ name:p.name, candidates:uniq(candidates) });
  });
  if(!normalizedProjects.length && categoryLevelCandidates.length){
    normalizedProjects.push({ name:'未分類', candidates:categoryLevelCandidates });
  }else if(categoryLevelCandidates.length && normalizedProjects[0]){
    normalizedProjects[0].candidates = uniq([...(normalizedProjects[0].candidates||[]), ...categoryLevelCandidates]);
  }
  c.projects = normalizedProjects;
  delete c.candidates;
  return c;
}
function normalizeQuickTree(){ state.tree = (Array.isArray(state.tree) ? state.tree : []).map(normalizeQuickCategory); }
function quickCategories(){ normalizeQuickTree(); return state.tree.filter(c=>c?.name); }
function quickCategory(){ const cats = quickCategories(); const selected = $('quickCategory')?.value; return cats.find(c=>c.name===selected) || cats[0] || null; }
function quickProject(){ const c = quickCategory(); const projects = c?.projects || []; const selected = $('quickProject')?.value; return projects.find(p=>p.name===selected) || projects[0] || null; }
function optionHtml(values, current){ return (values||[]).map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join(''); }
function renderQuickSelectors(){
  const catSel = $('quickCategory');
  const projectSel = $('quickProject');
  const candSel = $('quickCandidate');
  if(!catSel || !projectSel || !candSel) return;
  const oldCat = catSel.value, oldProj = projectSel.value, oldCand = candSel.value;
  const cats = quickCategories();
  catSel.innerHTML = optionHtml(cats.map(c=>c.name), oldCat);
  const c = quickCategory();
  projectSel.innerHTML = optionHtml((c?.projects||[]).map(p=>p.name), oldProj);
  const p = quickProject();
  candSel.innerHTML = optionHtml(['候補から選ぶ', ...(p?.candidates||[])], oldCand);
}
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
function earliestUnfinishedTaskStartHour(dateIso=state.scheduleDate){
  try{
    const starts = selectedTasks()
      .filter(t => taskOccursOnDate(t, dateIso))
      .map((t,i)=>taskStartMinutes(t,i))
      .filter(v=>Number.isFinite(v));
    if(!starts.length) return null;
    return Math.floor(Math.min(...starts) / 60) * 60;
  }catch(_e){ return null; }
}
function timelineBaseMinutes(){
  if(state.scheduleDate === todayISO()){
    const saved = getWorkStartTime(state.scheduleDate);
    if(saved) return Math.floor(minutesFromTime(saved) / 60) * 60;
    const now = new Date();
    const currentHour = now.getHours() * 60;
    const earliest = earliestUnfinishedTaskStartHour(state.scheduleDate);
    // 起きた時間を設定するまでは、未完了の過去タスクが画面の遥か下に流れないように、
    // 現在時刻の時台と未完了タスクの最初の時台のうち早い方から表示します。
    return earliest == null ? currentHour : Math.min(currentHour, earliest);
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
function timelineTopAbsolute(absStart, baseMin){
  return Math.max(0, (Number(absStart || 0) - Number(baseMin || 0)) * PX_PER_MINUTE);
}
function timelineDateForAbsolute(absMin){
  const offset = Math.floor(Math.max(0, Number(absMin || 0)) / DAY_MINUTES);
  return addDays(state.scheduleDate, offset);
}
function minutesFromTimelineTop(topPx, baseMin){
  return wrapMinutes(baseMin + snapMinutes(topPx / PX_PER_MINUTE));
}
function absoluteMinutesFromTimelineTop(topPx, baseMin){
  return Math.max(0, Number(baseMin || 0) + snapMinutes(Number(topPx || 0) / PX_PER_MINUTE));
}
function taskDateForDisplay(t){
  return t?.carryover_date || t?.schedule_date || t?.due_date || state.scheduleDate;
}

function selectedTasks(){
  if(!state.user || !state.selectedMemberId) return [];
  return taskArray().filter(t => t.id && t.owner_id === state.selectedMemberId && !t.done && !isUnavailableTask(t));
}
function timelineTasks(){ if(isUnavailableForMember(state.scheduleDate, state.selectedMemberId)) return []; return selectedTasks().filter(t => taskOccursOnDate(t, state.scheduleDate)); }
function timelineTaskEntries(baseMin=timelineBaseMinutes()){
  const entries = [];
  if(!state.selectedMemberId) return entries;
  for(let offset=0; offset<=1; offset++){
    const dateIso = addDays(state.scheduleDate, offset);
    if(isUnavailableForMember(dateIso, state.selectedMemberId)) continue;
    selectedTasks().forEach((t, idx)=>{
      if(!taskOccursOnDate(t, dateIso)) return;
      const start = taskStartMinutes(t, idx);
      const duration = taskDuration(t);
      const absStart = offset * DAY_MINUTES + start;
      const absEnd = absStart + duration;
      if(absEnd <= baseMin || absStart >= baseMin + DAY_MINUTES) return;
      entries.push({ t, dateIso, offset, absStart, duration, idx });
    });
  }
  return entries.sort((a,b)=>a.absStart-b.absStart);
}
function carryTasks(){ return selectedTasks().filter(t => t.carryover_date === state.carryDate); }
function colorFor(t){
  const cat = (state.tree || []).find(c => c.name === t.category);
  if(cat?.color) return cat.color;
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
function taskDuration(t){ return snapDuration(Number(t?.estimated_minutes || 30)); }
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
function isEditable(){ return !!state.user && state.selectedMemberId === state.user.id; }

function selectedMember(){
  return memberArray().find(m=>m.id===state.selectedMemberId) || state.profile || {};
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
  const absStart = Number.isFinite(Number(block.absStart)) ? Number(block.absStart) : Number(block.start || 0);
  const absEnd = Number.isFinite(Number(block.absEnd)) ? Number(block.absEnd) : Number(block.end || 0);
  el.style.top = `${timelineTopAbsolute(absStart, baseMin)}px`;
  el.style.height = `${Math.max(24, Math.max(15, absEnd - absStart) * PX_PER_MINUTE - 4)}px`;
  el.innerHTML = `<b>${esc(block.label || '稼働不可')}</b><small>${esc(block.meta || `${timeLabelWrap(block.start)} - ${timeLabelWrap(block.end)}`)}</small>`;
  return el;
}
function memberBlockedIntervals(dateIso=state.scheduleDate, memberId=state.selectedMemberId){
  const sleep = memberSleepIntervals();
  let unavail = [];
  try{
    const blocks = unavailableBlocksForMember(dateIso, memberId) || [];
    unavail = blocks
      .filter(b=>b && Number.isFinite(Number(b.start)) && Number.isFinite(Number(b.end)))
      .map(b=>({ start:Number(b.start), end:Number(b.end), kind:'unavailable', label:b.allDay?'終日稼働不可':'稼働不可', meta:b.allDay ? (b.memo || '稼働不可') : `${timeLabelWrap(b.start)} - ${timeLabelWrap(b.end)} / ${b.memo || '稼働不可'}` }));
  }catch(e){
    console.warn('稼働不可時間の読み込みをスキップしました', e);
  }
  return [...sleep, ...unavail].sort((a,b)=>a.start-b.start);
}
function intervalsOverlap(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd; }
function busyIntervals(dateIso, memberId=state.selectedMemberId, excludeTaskId=null){
  const blocked = memberBlockedIntervals(dateIso, memberId).map(b=>({start:b.start,end:b.end}));
  const tasks = taskArray()
    .filter(t=>t && t.id && t.owner_id===memberId && !t.done && !isUnavailableTask(t) && String(t.id)!==String(excludeTaskId) && taskOccursOnDate(t, dateIso))
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

function unwrapMinuteAtOrAfter(min, baseMin){
  let v = snapMinutes(min);
  while(v < baseMin) v += DAY_MINUTES;
  return v;
}
function intervalOccurrencesInRange(interval, rangeStart, rangeEnd){
  const out = [];
  const start = Number(interval.start);
  const end = Number(interval.end);
  if(!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;
  [-DAY_MINUTES,0,DAY_MINUTES].forEach(offset=>{
    const s = start + offset;
    const e = end + offset;
    if(s < rangeEnd && e > rangeStart) out.push({ start:Math.max(s, rangeStart), end:Math.min(e, rangeEnd) });
  });
  return out;
}
function nextSleepStartAfter(baseMin){
  const sleep = memberSleep();
  let sleepStart = snapMinutes(minutesFromTime(sleep.start || '02:00'));
  while(sleepStart <= baseMin) sleepStart += DAY_MINUTES;
  return sleepStart;
}
function blockedIntervalsUnwrapped(dateIso, memberId, rangeStart, rangeEnd){
  const blocks = [];
  const baseDate = state.scheduleDate || dateIso || todayISO();
  for(let offset=0; offset<=1; offset++){
    const d = addDays(baseDate, offset);
    memberBlockedIntervals(d, memberId).forEach(block=>{
      const absStart = offset * DAY_MINUTES + Number(block.start || 0);
      const absEnd = offset * DAY_MINUTES + Number(block.end || 0);
      if(absStart < rangeEnd && absEnd > rangeStart){
        blocks.push({ start:Math.max(absStart, rangeStart), end:Math.min(absEnd, rangeEnd) });
      }
    });
  }
  return mergeIntervals(blocks);
}
function fitsAtUnwrapped(start, duration, busy, rangeEnd){
  const end = start + duration;
  if(start < 0 || end > rangeEnd) return false;
  return !busy.some(b=>intervalsOverlap(start,end,b.start,b.end));
}
function findNextSlotUnwrapped(after, duration, busy, rangeEnd){
  let cursor = Math.max(0, snapMinutes(after));
  let guard = 0;
  while(cursor + duration <= rangeEnd && guard < 1000){
    guard++;
    const hit = busy.find(b=>intervalsOverlap(cursor, cursor+duration, b.start, b.end));
    if(!hit) return cursor;
    cursor = snapMinutes(hit.end + SLOT_MINUTES - 1);
  }
  return null;
}
function makeReflowPlan(startMin){
  const dateIso = state.scheduleDate;
  const memberId = state.selectedMemberId;
  const rangeStart = snapMinutes(startMin);
  const rangeEnd = nextSleepStartAfter(rangeStart);
  const busy = blockedIntervalsUnwrapped(dateIso, memberId, rangeStart, rangeEnd);
  const tasks = timelineTasks()
    .filter(t=>t && t.id && !t.done && !isUnavailableTask(t))
    .map((t,i)=>({ t, oldStart:unwrapMinuteAtOrAfter(taskStartMinutes(t,i), rangeStart), duration:taskDuration(t) }))
    .sort((a,b)=>a.oldStart-b.oldStart);
  const moves = [];
  const carryovers = [];
  let cursor = rangeStart;
  tasks.forEach(item=>{
    const start = findNextSlotUnwrapped(cursor, item.duration, busy, rangeEnd);
    if(start == null){
      carryovers.push(item);
      return;
    }
    moves.push({ task:item.t, start, duration:item.duration });
    busy.push({ start, end:start+item.duration });
    busy.sort((a,b)=>a.start-b.start);
    cursor = start + item.duration;
  });
  return { moves, carryovers, rangeStart, rangeEnd };
}
async function applyReflowPlan(plan, carryUnfit){
  for(const m of plan.moves){
    await updateTask(m.task.id, {
      start_time: timeLabelWrap(m.start),
      schedule_date: state.scheduleDate,
      carryover_date: null,
      status: 'scheduled'
    });
  }
  if(carryUnfit){
    for(const item of plan.carryovers){
      await carryTaskToDate(item.t.id, addDays(state.scheduleDate, 1));
    }
  }
}
async function setWorkStartAndMaybeReflow(value){
  const start = snapMinutes(minutesFromTime(value));
  setWorkStartTime(timeLabelWrap(start), todayISO());
  const plan = makeReflowPlan(start);
  if(!plan.moves.length && !plan.carryovers.length){
    renderBoard();
    return;
  }
  let carryUnfit = false;
  if(plan.carryovers.length){
    carryUnfit = confirm(`${plan.carryovers.length}件のタスクが今日の睡眠までに入りません。明日へ自動で持ち越しますか？`);
    if(!carryUnfit){
      alert('入りきらないタスクはそのまま残します。必要なら手動で修正してください。');
    }
  }
  await applyReflowPlan(plan, carryUnfit);
  await refreshAll();
}
async function carryTaskToDate(taskId, carryDate){
  const t = taskArray().find(x=>String(x.id)===String(taskId));
  const duration = taskDuration(t || {});
  const sleep = memberSleep();
  const preferred = minutesFromTime(sleep.end || '09:00');
  const start = findAvailableStart(carryDate, duration, preferred, t?.owner_id || state.selectedMemberId, taskId);
  await updateTask(taskId, { carryover_date: carryDate, schedule_date: null, status:'carryover', start_time: timeLabel(start), sort_order: Date.now()*-1 });
}

function monthEndIso(dateIso){
  const [y,m] = String(dateIso || todayISO()).split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateRangeInclusive(startIso, endIso){
  const out=[];
  if(!startIso || !endIso || diffDays(endIso,startIso)<0) return out;
  for(let d=startIso; diffDays(d,endIso)<=0; d=addDays(d,1)) out.push(d);
  return out;
}
function effectiveTaskDate(t){ return t?.carryover_date || t?.schedule_date || t?.due_date || state.scheduleDate || todayISO(); }
function isWholeDayBlocked(dateIso, memberId=state.selectedMemberId){
  try{ return isUnavailableForMember(dateIso, memberId); }catch(_e){ return false; }
}
function blockedOnlyIntervals(dateIso, memberId=state.selectedMemberId){
  return memberBlockedIntervals(dateIso, memberId).map(b=>({ start:Number(b.start||0), end:Number(b.end||0) }));
}
function fixedBusyIntervals(dateIso, memberId, excludeIds){
  const exclude = new Set((excludeIds||[]).map(String));
  const blocks = blockedOnlyIntervals(dateIso, memberId);
  const tasks = taskArray()
    .filter(t=>t && t.id && t.owner_id===memberId && !t.done && !isUnavailableTask(t) && !exclude.has(String(t.id)) && taskOccursOnDate(t, dateIso))
    .map((t,i)=>({ start:taskStartMinutes(t,i), end:taskStartMinutes(t,i)+taskDuration(t) }));
  return mergeIntervals([...blocks, ...tasks]);
}
function findSlotWithBusy(preferred, duration, busy){
  duration = snapDuration(duration);
  const start = snapMinutes(preferred);
  const candidates=[];
  for(let m=start; m<=DAY_MINUTES-duration; m+=SLOT_MINUTES) candidates.push(m);
  for(let m=0; m<start; m+=SLOT_MINUTES) candidates.push(m);
  return candidates.find(m=>!busy.some(b=>intervalsOverlap(m,m+duration,b.start,b.end))) ?? null;
}
function getCategoryColorByName(name){
  const cat = (state.tree || []).find(c=>c.name===name);
  return cat?.color || '#9aa4b6';
}
function showOrganizeMessage(text, error=false){
  const el = $('organizeMsg');
  if(!el) return;
  el.textContent = text;
  el.className = `notice ${error ? 'error' : 'ok'}`;
  el.classList.remove('hidden');
}
async function reflowTasksAvoidingUnavailable(){
  if(!isEditable()) return alert('自分のタスクだけ整理できます');
  const startDate = state.scheduleDate || todayISO();
  const endDate = monthEndIso(startDate);
  const ownerId = state.selectedMemberId || state.user.id;
  const movable = selectedTasks()
    .filter(t=>t && t.id && !isUnavailableTask(t) && (t.occurrence || 'single') === 'single')
    .filter(t=>diffDays(effectiveTaskDate(t), startDate) >= 0 && diffDays(effectiveTaskDate(t), endDate) <= 0)
    .sort((a,b)=>{
      const da = effectiveTaskDate(a), db = effectiveTaskDate(b);
      if(da!==db) return da.localeCompare(db);
      return taskStartMinutes(a,0)-taskStartMinutes(b,0);
    });
  if(!movable.length){ showOrganizeMessage('並べ直せる単発タスクはありません。'); return; }
  const excludeIds = movable.map(t=>t.id);
  const busyByDate = new Map();
  function busyFor(date){
    if(!busyByDate.has(date)) busyByDate.set(date, fixedBusyIntervals(date, ownerId, excludeIds));
    return busyByDate.get(date);
  }
  let moved=0, skipped=0;
  for(const t of movable){
    const duration = taskDuration(t);
    const original = effectiveTaskDate(t);
    const due = t.due_date && diffDays(t.due_date, startDate)>=0 ? t.due_date : endDate;
    const searchStart = diffDays(original, startDate)<0 ? startDate : original;
    let placed = null;
    for(const date of dateRangeInclusive(searchStart, due)){
      if(isWholeDayBlocked(date, ownerId)) continue;
      const busy = busyFor(date);
      const preferred = date===original ? taskStartMinutes(t,0) : minutesFromTime(memberSleep().end || '09:00');
      const slot = findSlotWithBusy(preferred, duration, busy);
      if(slot !== null){
        placed = { date, start:slot };
        busy.push({ start:slot, end:slot+duration });
        busy.sort((a,b)=>a.start-b.start);
        break;
      }
    }
    if(!placed){ skipped++; continue; }
    const patch = { schedule_date:placed.date, carryover_date:null, status:'scheduled', start_time:timeLabel(placed.start) };
    if(t.schedule_date!==patch.schedule_date || t.carryover_date || t.start_time!==patch.start_time){
      await updateTask(t.id, patch);
      moved++;
    }
  }
  showOrganizeMessage(`${moved}件を稼働不可・睡眠を避けて並べ直しました。${skipped ? ` ${skipped}件は空き枠が見つかりませんでした。` : ''}`, !!skipped);
  await refreshAll();
}
async function redistributeDailyTasksFromToday(){
  if(!isEditable()) return alert('自分のタスクだけ整理できます');
  const ownerId = state.selectedMemberId || state.user.id;
  const startDate = state.scheduleDate || todayISO();
  const daily = selectedTasks()
    .filter(t=>t && t.id && !isUnavailableTask(t) && (t.occurrence || 'single') === 'daily')
    .filter(t=>!t.due_date || diffDays(t.due_date, startDate)>=0);
  if(!daily.length){ showOrganizeMessage('今日以降に分け直せる毎日タスクはありません。'); return; }
  if(!confirm(`毎日タスク ${daily.length}件を、今日以降の単発タスクに分け直します。元の毎日タスクは完了扱いにして、できたことログには入れません。よろしいですか？`)) return;
  let created=0, originals=0, skipped=0;
  const ACHIEVE_EXCLUDE = '#achievement-exclude';
  for(const t of daily){
    const from = diffDays(t.schedule_date || startDate, startDate)>0 ? t.schedule_date : startDate;
    const to = t.due_date || monthEndIso(from);
    const dates = dateRangeInclusive(from, to).filter(d=>!isWholeDayBlocked(d, ownerId));
    if(!dates.length){ skipped++; continue; }
    const excludeIds = [t.id];
    const busyByDate = new Map();
    for(let i=0;i<dates.length;i++){
      const date = dates[i];
      if(!busyByDate.has(date)) busyByDate.set(date, fixedBusyIntervals(date, ownerId, excludeIds));
      const busy = busyByDate.get(date);
      const duration = taskDuration(t);
      const preferred = t.start_time ? minutesFromTime(t.start_time) : minutesFromTime(memberSleep().end || '09:00');
      const slot = findSlotWithBusy(preferred, duration, busy);
      if(slot === null){ skipped++; continue; }
      busy.push({ start:slot, end:slot+duration });
      busy.sort((a,b)=>a.start-b.start);
      await createTask({
        team_id:state.team.id,
        owner_id:ownerId,
        created_by:state.user.id,
        title:`${t.title}${dates.length>1 ? `（${i+1}/${dates.length}）` : ''}`,
        category:t.category || '未分類',
        project:t.project || '未分類',
        task_type:'',
        estimated_minutes:duration,
        start_time:timeLabel(slot),
        schedule_date:date,
        due_date:t.due_date || null,
        occurrence:'single',
        status:'scheduled',
        memo:`${t.memo || ''}${t.memo ? '\n' : ''}毎日タスクから再配分`,
        sort_order:(Date.now()*-1)-created
      });
      created++;
    }
    await updateTask(t.id, { done:true, status:'done', memo:`${t.memo || ''}${t.memo ? '\n' : ''}${ACHIEVE_EXCLUDE}\n毎日タスクを単発タスクへ再配分済み` });
    originals++;
  }
  showOrganizeMessage(`${created}件の単発タスクを作りました。元の毎日タスク ${originals}件はログ対象外の完了扱いにしました。${skipped ? ` ${skipped}枠は空きが見つかりませんでした。` : ''}`, !!skipped);
  await refreshAll();
}
async function scheduleTaskOnDate(taskId, scheduleDate){
  const t = taskArray().find(x=>String(x.id)===String(taskId));
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
      memo:($('editTaskMemo').value || t.memo || '稼働不可') + '\nタスクから稼働不可予定へ変更'
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

function makeEventElement(t, index, baseMin, instanceDate=state.scheduleDate, absStartOverride=null){
  if(!t || !t.id){ const empty=document.createElement('div'); return empty; }
  const duration = taskDuration(t);
  const rawStart = taskStartMinutes(t, index);
  const dayOffset = Math.max(0, diffDays(instanceDate, state.scheduleDate));
  const start = rawStart;
  const absStart = Number.isFinite(Number(absStartOverride)) ? Number(absStartOverride) : dayOffset * DAY_MINUTES + start;
  const el = document.createElement('div');
  el.className = 'taskEvent';
  if(state.scheduleDate === todayISO()){
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    if(instanceDate === todayISO() && start + duration <= nowMin) el.classList.add('pastUnfinished');
  }
  el.dataset.id = t.id;
  el.style.setProperty('--c', colorFor(t));
  el.style.top = `${timelineTopAbsolute(absStart, baseMin)}px`;
  el.style.height = `${Math.max(22, duration * PX_PER_MINUTE - 4)}px`;
  el.innerHTML = `
    <div class="eventMain">
      <b>${esc(t.title)}</b>
      <small>${instanceDate !== state.scheduleDate ? esc(fmtDate(instanceDate)) + ' ' : ''}${timeLabel(start)} - ${timeLabel(start + duration)} / ${Math.round(duration)}分 / ${esc(t.project || t.category || '')}</small>
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
      const abs = absoluteMinutesFromTimelineTop(parseFloat(el.style.top)||0, timelineBaseMinutes());
      const targetDate = timelineDateForAbsolute(abs);
      let newStart = wrapMinutes(abs);
      if(!fitsAt(targetDate, newStart, taskDuration(t), state.selectedMemberId, t.id)) newStart = findAvailableStart(targetDate, taskDuration(t), newStart, state.selectedMemberId, t.id);
      const keepCarry = !!t.carryover_date;
      await updateTask(t.id, keepCarry
        ? { start_time: timeLabelWrap(newStart), carryover_date: targetDate, schedule_date:null, status:'carryover' }
        : { start_time: timeLabelWrap(newStart), schedule_date: targetDate, carryover_date:null, status:'scheduled' }
      );
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
  if(!t || !t.id){ art.className='empty'; art.textContent='読み込めないタスクがありました'; return art; }
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
  let dayMin = 0;
  try{ dayMin = availableMinutesForDate(state.scheduleDate, state.selectedMemberId); }catch(e){ console.warn('day activity calculation failed', e); dayMin = DAY_MINUTES; }
  const savedWorkStart = getWorkStartTime(state.scheduleDate);
  const currentBase = savedWorkStart ? minutesFromTime(savedWorkStart) : (new Date().getHours()*60 + new Date().getMinutes());
  const todayMin = state.scheduleDate === todayISO()
    ? Math.max(0, dayMin - currentBase)
    : dayMin;
  const [,m] = String(state.scheduleDate || todayISO()).split('-').map(Number);
  const remainingMonthDates = monthDatesFrom(state.scheduleDate).filter(d => d >= state.scheduleDate);
  const monthMin = remainingMonthDates.reduce((sum,d)=>{
    try{ return sum+availableMinutesForDate(d, state.selectedMemberId); }catch(_e){ return sum; }
  },0);
  let dayTasks = [];
  try{ dayTasks = timelineTasks(); }catch(e){ console.warn('timeline task calculation failed', e); dayTasks = []; }
  const workMin = dayTasks.reduce((sum,t)=>sum+taskDuration(t),0);
  const remainMin = Math.max(0, todayMin - workMin);
  const dayWord = state.scheduleDate === todayISO() ? '今日' : fmtDate(state.scheduleDate);
  box.innerHTML = `
    <div class="activityCard"><b>${formatHours(todayMin)}</b><span>${dayWord}の残り活動可能時間</span></div>
    <div class="activityCard"><b>${formatHours(monthMin)}</b><span>${m}月の残り活動可能時間（残り${remainingMonthDates.length}日）</span></div>
    <div class="activityCard"><b>${formatHours(workMin)}</b><span>${dayWord}のタスク予定時間</span></div>
    <div class="activityCard"><b>${formatHours(remainMin)}</b><span>${dayWord}の余白時間</span></div>`;
}

function renderWorkStartStatus(){
  const box = $('workStartBox');
  if(!box) return;
  const isToday = state.scheduleDate === todayISO();
  box.classList.toggle('hidden', !isToday);
  const text = $('workStartText');
  const input = $('workStartInput');
  const saved = getWorkStartTime(state.scheduleDate);
  if(text) text.textContent = saved ? `活動開始時間：${saved.slice(0,5)}` : '活動開始時間：未設定';
  if(input) input.value = saved ? saved.slice(0,5) : '';
}

export function renderBoard(){
  try{
    if(!state.user){ renderTimelineFallback(new Error('未ログインです')); return; }
    if(!state.selectedMemberId){ state.selectedMemberId = state.user.id; }
    if(!Array.isArray(state.members)) state.members = [];
    if(!Array.isArray(state.tasks)) state.tasks = [];
    normalizeCarryDate();

    const scheduleTitleEl = $('scheduleTitle');
    if(scheduleTitleEl) scheduleTitleEl.textContent = scheduleTitle();
    const schedulePrevEl = $('schedulePrev');
    if(schedulePrevEl) schedulePrevEl.disabled = diffDays(state.scheduleDate, todayISO()) <= 0;
    const carryDateTextEl = $('carryDateText');
    if(carryDateTextEl) carryDateTextEl.textContent = fmtDate(state.carryDate);
    const carryRelativeEl = $('carryRelative');
    if(carryRelativeEl) carryRelativeEl.textContent = `(${relativeFrom(state.scheduleDate, state.carryDate)})`;
    const carryPrevEl = $('carryPrev');
    if(carryPrevEl) carryPrevEl.disabled = diffDays(state.carryDate, addDays(state.scheduleDate,1)) <= 0;

    const boardNoticeEl = $('boardNotice');
    if(boardNoticeEl){
      let unavailable = false;
      try{ unavailable = isUnavailableForMember(state.scheduleDate, state.selectedMemberId); }catch(e){ console.warn('終日稼働不可の判定をスキップしました', e); }
      const mine = isEditable();
      boardNoticeEl.textContent = unavailable
        ? 'この日は終日稼働不可です。毎日タスクや分割タスクは表示されません。'
        : (mine ? '自分の今日やることです。編集できます。' : '他メンバーの今日やることです。閲覧中心です。');
    }

    try{ renderActivitySummary(); }catch(e){ console.warn('activity summary skipped', e); }
    try{ renderWorkStartStatus(); }catch(e){ console.warn('work start status skipped', e); }
    try{ renderTimeline(); }catch(e){ console.error('timeline render failed', e); renderTimelineFallback(e); }
    try{ renderCarryList(); }catch(e){ console.warn('carry list skipped', e); }
    try{ renderQuickSelectors(); }catch(e){ console.warn('quick selectors skipped', e); }
  }catch(e){
    console.error('board render hard failed', e);
    renderTimelineFallback(e);
    const msg = $('planMsg');
    if(msg) msg.textContent = `今日やることの表示でエラー：${e?.message || '不明なエラー'}`;
  }
}


function renderTimelineFallback(error){
  const box = $('timeline');
  if(!box) return;
  const baseMin = timelineBaseMinutes();
  box.innerHTML = '';
  box.className = 'timeline timelineCalendar';
  box.style.setProperty('--day-height', `${DAY_MINUTES * PX_PER_MINUTE}px`);
  const axis = document.createElement('div');
  axis.className = 'timeAxis';
  const grid = document.createElement('div');
  grid.className = 'calendarGrid';
  for(let h=0; h<24; h++){
    const label = document.createElement('div');
    label.className = 'timeMark';
    label.style.top = `${h*60*PX_PER_MINUTE}px`;
    label.textContent = timeLabelWrap(baseMin + h*60);
    axis.appendChild(label);
    const line = document.createElement('div');
    line.className = 'hourLine';
    line.style.top = `${h*60*PX_PER_MINUTE}px`;
    grid.appendChild(line);
  }
  const hint = document.createElement('div');
  hint.className = 'timelineHint';
  hint.textContent = 'タイムラインのタスク表示でエラーが出たため、時間軸だけ表示しています。';
  box.appendChild(axis);
  box.appendChild(grid);
  box.appendChild(hint);
  const msg = $('planMsg');
  if(msg) msg.textContent = `タイムラインの表示を一時的に保護しました：${error?.message || '不明なエラー'}`;
}

export function renderTimeline(){
  const box = $('timeline');
  if(!box) return;
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
  let blocks = [];
  try{
    for(let offset=0; offset<=1; offset++){
      const dateIso = addDays(state.scheduleDate, offset);
      (memberBlockedIntervals(dateIso, state.selectedMemberId) || []).forEach(block=>{
        const absStart = offset * DAY_MINUTES + Number(block.start || 0);
        const absEnd = offset * DAY_MINUTES + Number(block.end || 0);
        if(absEnd > baseMin && absStart < baseMin + DAY_MINUTES) blocks.push({ ...block, absStart, absEnd });
      });
    }
  }catch(e){ console.warn('block list skipped', e); blocks = []; }
  blocks.forEach(block=>{ try{ events.appendChild(makeBlockedElement(block, baseMin)); }catch(e){ console.warn('block skipped', e); } });
  let entries = [];
  try{ entries = timelineTaskEntries(baseMin); }catch(e){ console.warn('timeline task list skipped', e); entries = []; }
  entries.forEach(entry=>{ try{ events.appendChild(makeEventElement(entry.t, entry.idx, baseMin, entry.dateIso, entry.absStart)); }catch(e){ console.warn('task skipped', entry.t, e); } });

  const isToday = state.scheduleDate === todayISO();
  if(isToday){
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    const nowTop = (nowMin - baseMin) * PX_PER_MINUTE;
    if(nowTop >= 0 && nowTop <= DAY_MINUTES * PX_PER_MINUTE){
      const line = document.createElement('div');
      line.className = 'nowLine calendarNowLine';
      line.style.top = `${nowTop}px`;
      grid.appendChild(line);
    }
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

  const totalMin = entries.reduce((a,e)=>a+(Number(e?.t?.estimated_minutes)||30),0);
  const planMsgEl = $('planMsg');
  if(planMsgEl) planMsgEl.textContent = totalMin ? `この日の作業予定：${Math.round(totalMin/60*10)/10}時間` : 'この日のタスクはまだありません。時間軸だけ表示しています。';

  requestAnimationFrame(()=>{
    const container = $('timelineBox') || box.parentElement;
    if(!container) return;
    // 今日は読み込んだ時刻の「時台」を先頭にして、そこから24時間を表示します。
    // 明日以降は00:00始まりです。
    container.scrollTop = 0;
  });
}

export function renderCarryList(){
  const list = $('carryList');
  if(!list) return;
  list.innerHTML = '';
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
  $('workStartInfoBtn')?.addEventListener('click', (e)=>{
    e.preventDefault();
    const info = $('workStartInfoText');
    if(info) info.classList.toggle('hidden');
  });
  $('setWorkStartBtn')?.addEventListener('click', async()=>{
    const input = $('workStartInput');
    const now = new Date();
    const fallback = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const value = (input?.value || fallback).slice(0,5);
    await setWorkStartAndMaybeReflow(value);
  });
  $('clearWorkStartBtn')?.addEventListener('click', ()=>{
    setWorkStartTime(null, todayISO());
    renderBoard();
  });
  $('reflowFromTodayBtn')?.addEventListener('click', async()=>{
    try{ await reflowTasksAvoidingUnavailable(); }catch(e){ console.error(e); showOrganizeMessage(e.message || 'タスクの並べ直しに失敗しました', true); }
  });
  $('reflowDailyTasksBtn')?.addEventListener('click', async()=>{
    try{ await redistributeDailyTasksFromToday(); }catch(e){ console.error(e); showOrganizeMessage(e.message || '毎日タスクの分け直しに失敗しました', true); }
  });
  $('quickCategory')?.addEventListener('change', renderQuickSelectors);
  $('quickProject')?.addEventListener('change', renderQuickSelectors);
  $('quickCandidate')?.addEventListener('change', ()=>{ const v=$('quickCandidate')?.value; if(v && v !== '候補から選ぶ') $('quickTitle').value = v; });
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
      category:$('quickCategory')?.value || '未分類', project:$('quickProject')?.value || '未分類', task_type:'',
      estimated_minutes:duration,
      start_time: timeLabel(startMin),
      due_date:$('quickDue').value || null,
      schedule_date: state.scheduleDate,
      status:'scheduled', memo:$('quickMemo').value || '', sort_order: Date.now()*-1
    });
    $('quickTitle').value=''; $('quickMinutes').value=''; $('quickDue').value=''; $('quickMemo').value=''; if($('quickCandidate')) $('quickCandidate').value='候補から選ぶ';
    await refreshAll();
  });
}
export function openDateOnBoard(iso){ state.scheduleDate = iso; state.carryDate = addDays(iso,1); showView('board'); renderBoard(); }
