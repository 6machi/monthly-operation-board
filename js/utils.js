export const $ = (id) => document.getElementById(id);
export const qsa = (sel) => Array.from(document.querySelectorAll(sel));
export function esc(v){return String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
export function todayISO(){return toISO(new Date());}
export function toISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function addDays(iso, n){const d=parseISO(iso); d.setDate(d.getDate()+n); return toISO(d);}
export function parseISO(iso){const [y,m,d]=String(iso).split('-').map(Number); return new Date(y, (m||1)-1, d||1);}
export function fmtDate(iso){const d=parseISO(iso); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;}
export function fmtMonth(iso){return String(iso).slice(0,7);}
export function diffDays(a,b){const da=parseISO(a), db=parseISO(b); return Math.round((da-db)/86400000);}
export function relativeFrom(base, target){const n=diffDays(target, base); if(n===0)return '今日'; if(n===1)return '明日'; if(n===2)return '明後日'; return `${n}日後`;}
export function nowTimeText(){const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
export function minutesFromTime(t){const [h,m]=String(t||'00:00').split(':').map(Number); return (h||0)*60+(m||0);}
export function clock(min){const n=((Math.round(min)%1440)+1440)%1440; return `${String(Math.floor(n/60)).padStart(2,'0')}:00`;}
export function fullClock(min){const n=((Math.round(min)%1440)+1440)%1440; return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function uuidLike(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}

export function isBetweenDates(dateIso, startIso, endIso){
  if(!dateIso || !startIso) return false;
  if(diffDays(dateIso, startIso) < 0) return false;
  if(endIso && diffDays(dateIso, endIso) > 0) return false;
  return true;
}
export function taskOccursOnDate(task, dateIso){
  if(!task || !dateIso || task.done) return false;
  if(task.carryover_date === dateIso) return true;
  const start = task.schedule_date;
  const end = task.due_date || null;
  const occurrence = task.occurrence || 'single';
  if(occurrence === 'daily') return isBetweenDates(dateIso, start, end);
  if(occurrence === 'weekly'){
    if(!isBetweenDates(dateIso, start, end)) return false;
    return parseISO(dateIso).getDay() === parseISO(start).getDay();
  }
  if(occurrence === 'monthly'){
    if(!isBetweenDates(dateIso, start, end)) return false;
    return parseISO(dateIso).getDate() === parseISO(start).getDate();
  }
  return start === dateIso;
}
export function occurrenceLabel(v){
  return ({single:'単発', daily:'毎日', weekly:'毎週', monthly:'毎月'}[v] || '単発');
}

export const DEFAULT_TREE = [
  {name:'かいまほケット2026', color:'#e8a6c8', memo:'イベント・制作系', sharedWith:[], projects:[
    {name:'乙女ゲーム制作', candidates:['政宗','かがみ','NPC差分','表情差分','背景整理','UI素材','ロゴ','小物','ルール確認','進行表確認','共有文面作成']},
    {name:'ハッキング合宿', candidates:['清書・トーン張り','校正反映','入稿準備','FIX確認','不足素材確認']}
  ]},
  {name:'仕事', color:'#5d9cec', memo:'会社・業務委託', sharedWith:[], projects:[
    {name:'通常業務', candidates:['進捗報告','確認依頼','返信作成','タテヨコ確認','資料確認','差し戻し確認']}
  ]},
  {name:'プライベート', color:'#63b978', memo:'生活・通院・休息', sharedWith:[], projects:[
    {name:'生活', candidates:['通院','薬確認','8時間寝る','洗濯','片付け','買い出し']}
  ]},
  {name:'副業', color:'#a78bfa', memo:'副業・発信・講座', sharedWith:[], projects:[
    {name:'占い事業', candidates:['投稿作成','リール台本','LP修正','返信','個別相談準備','説明会準備']}
  ]}
];
