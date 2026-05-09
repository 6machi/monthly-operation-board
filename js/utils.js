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
export const DEFAULT_TREE = [
  {name:'かいまほケット2026', color:'#e8a6c8', memo:'イベント・制作系', projects:[
    {name:'乙女ゲーム制作', types:[{name:'立ち絵制作', tasks:['政宗','かがみ','NPC差分','表情差分']},{name:'素材制作', tasks:['背景整理','UI素材','ロゴ','小物']},{name:'運用整理', tasks:['ルール確認','進行表確認','共有文面作成']}]},
    {name:'ハッキング合宿', types:[{name:'原稿制作', tasks:['清書・トーン張り','校正反映','入稿準備']},{name:'確認作業', tasks:['FIX確認','進捗確認','不足素材確認']}]}]},
  {name:'仕事', color:'#5d9cec', memo:'会社・業務委託', projects:[{name:'通常業務', types:[{name:'連絡', tasks:['進捗報告','確認依頼','返信作成']},{name:'チェック', tasks:['タテヨコ確認','資料確認','差し戻し確認']}]}]},
  {name:'プライベート', color:'#63b978', memo:'生活・通院・休息', projects:[{name:'生活', types:[{name:'体調管理', tasks:['通院','薬確認','8時間寝る']},{name:'家事', tasks:['洗濯','片付け','買い出し']}]}]},
  {name:'副業', color:'#a78bfa', memo:'副業・発信・講座', projects:[{name:'占い事業', types:[{name:'発信', tasks:['投稿作成','リール台本','LP修正']},{name:'顧客対応', tasks:['返信','個別相談準備','説明会準備']}]}]}
];
