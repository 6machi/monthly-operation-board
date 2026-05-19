import { isConfigured } from './supabase-client.js?v=78';
import { getSession, signIn, signUp, signOut, ensureProfileAndTeam, loadMembers } from './auth.js?v=78';
import { loadTasks } from './tasks.js?v=78';
import { loadTree } from './setup.js?v=78';
import { state } from './state.js?v=78';
import { $, qsa, todayISO, nowTimeText, fmtDate } from './utils.js?v=78';
import { initBoardEvents, renderBoard } from './board.js?v=78';
import { initCalendarEvents, renderCalendar } from './calendar.js?v=78';
import { initSetupEvents, renderSetup, renderProfilePage } from './setup-view.js?v=78';

function safeGet(id){ return document.getElementById(id); }
function safeOn(id, event, fn){
  const el = safeGet(id);
  if(el) el.addEventListener(event, fn);
}

export function showView(view){
  state.view = view;
  qsa('.view').forEach(v=>v.classList.remove('active'));
  const target = safeGet(view);
  if(target) target.classList.add('active');
  qsa('#mainNav button').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  renderCurrent();
}

function normalizeCurrentMember(){
  if(!state.user) return;
  if(!Array.isArray(state.members)) state.members = [];
  const userId = state.user.id;
  const hasMe = state.members.some(m=>m && m.id===userId);
  if(!hasMe){
    state.members.unshift({
      id:userId,
      role:'owner',
      name:state.profile?.display_name || '自分',
      emoji:state.profile?.display_emoji || '🌙',
      color:state.profile?.display_color || '#5d9cec',
      sleepStart:String(state.profile?.sleep_start_time || '02:00').slice(0,5),
      sleepEnd:String(state.profile?.sleep_end_time || '09:00').slice(0,5),
      workEnabled:!!state.profile?.work_enabled,
      workStart:String(state.profile?.work_start_time || '10:00').slice(0,5),
      workEnd:String(state.profile?.work_end_time || '19:00').slice(0,5),
      workDays:Array.isArray(state.profile?.work_days) ? state.profile.work_days : [1,2,3,4,5],
      workCategory:state.profile?.work_category || '仕事'
    });
  }
  state.members = state.members.filter(Boolean).sort((a,b)=>{
    if(a.id===userId) return -1;
    if(b.id===userId) return 1;
    return String(a.name||'').localeCompare(String(b.name||''),'ja');
  });
  if(!state.selectedMemberId || !state.members.some(m=>m.id===state.selectedMemberId)){
    state.selectedMemberId = userId;
  }
}

function renderCurrent(){
  normalizeCurrentMember();
  renderMemberTabs();
  renderHero();
  try{
    if(state.view==='board') renderBoard();
    if(state.view==='calendar') renderCalendar();
    if(state.view==='setup') renderSetup();
    if(state.view==='profile') renderProfilePage();
  }catch(e){
    console.error('render error', e);
    authMsg(e.message || '画面表示でエラーが出ました', true);
  }
}
function renderHero(){
  const dateEl = safeGet('heroDate');
  if(dateEl) dateEl.textContent = `${fmtDate(todayISO())}　${nowTimeText()}`;
}
function renderMemberTabs(){
  normalizeCurrentMember();
  const html = state.members.map(m=>`<button class="memberTab ${m.id===state.selectedMemberId?'active':''}" data-member="${m.id}" style="--member-color:${m.color || '#5d9cec'}"><span>${m.emoji || '🌙'}</span>${m.id===state.user?.id ? (m.name || '自分') + '（自分）' : (m.name || 'メンバー')}</button>`).join('');
  const boardTabs = safeGet('memberTabs');
  const setupTabs = safeGet('setupMemberTabs');
  if(boardTabs) boardTabs.innerHTML = html;
  if(setupTabs) setupTabs.innerHTML = html;
  [...(boardTabs?.querySelectorAll('button') || []), ...(setupTabs?.querySelectorAll('button') || [])].forEach(btn=>{
    btn.addEventListener('click', async()=>{
      try{
        state.selectedMemberId = btn.dataset.member;
        if(state.selectedMemberId === state.user.id){
          const treeResult = await loadTree(state.team.id, state.user.id);
          state.treeRowId = treeResult.id; state.tree = treeResult.tree;
        }
        renderCurrent();
      }catch(e){ authMsg(e.message || 'メンバー切り替えでエラーが出ました', true); }
    });
  });
}
export async function refreshAll(){
  state.tasks = await loadTasks(state.team.id);
  renderCurrent();
}
async function bootAuthed(session){
  state.session = session; state.user = session.user;
  const result = await ensureProfileAndTeam(state.user);
  state.profile = result.profile; state.team = result.team;
  state.members = await loadMembers(state.team.id);
  normalizeCurrentMember();
  // ログイン直後は必ず本人のタブに戻す。
  // 前の操作で他メンバーを見ていた状態が残ると、自分の予定が消えたように見えるため。
  state.selectedMemberId = state.user.id;
  const treeResult = await loadTree(state.team.id, state.user.id);
  state.treeRowId = treeResult.id; state.tree = treeResult.tree;
  state.tasks = await loadTasks(state.team.id);
  safeGet('authView')?.classList.add('hidden');
  safeGet('appView')?.classList.remove('hidden');
  safeGet('mainNav')?.classList.remove('hidden');
  safeGet('logoutBtn')?.classList.remove('hidden');
  const pill = safeGet('loginPill');
  if(pill) pill.textContent = `${state.profile?.display_emoji || '🌙'} ${state.profile?.display_name || '自分'}`;
  renderCurrent();
}
function showAuth(){
  safeGet('authView')?.classList.remove('hidden');
  safeGet('appView')?.classList.add('hidden');
  safeGet('mainNav')?.classList.add('hidden');
  safeGet('logoutBtn')?.classList.add('hidden');
  const pill=safeGet('loginPill');
  if(pill) pill.textContent='未ログイン';
}
function authMsg(text, error=false){
  const el=safeGet('authMsg');
  if(!el) { console.log(text); return; }
  el.textContent=text;
  el.className = `notice ${error?'error':'ok'}`;
  el.classList.remove('hidden');
}
function bindAuthEvents(){
  safeOn('signinBtn','click', async()=>{
    try{
      authMsg('ログイン中です…');
      const session = await signIn(safeGet('authEmail')?.value || '', safeGet('authPassword')?.value || '');
      await bootAuthed(session);
    }catch(e){
      console.error(e);
      authMsg(e.message || 'ログインに失敗しました', true);
    }
  });
  safeOn('signupBtn','click', async()=>{
    try{
      authMsg('登録中です…');
      const session = await signUp(safeGet('authEmail')?.value || '', safeGet('authPassword')?.value || '');
      authMsg('登録しました。メール確認が必要な設定の場合は、メールを確認してください。');
      if(session) await bootAuthed(session);
    }catch(e){
      console.error(e);
      authMsg(e.message || '登録に失敗しました', true);
    }
  });
  safeOn('logoutBtn','click', async()=>{ await signOut(); showAuth(); });
  safeOn('loginPill','click',()=>{ if(state.user) showView('profile'); });
  document.addEventListener('click', (e)=>{
    const pill = e.target.closest?.('#loginPill');
    if(pill && state.user){ e.preventDefault(); showView('profile'); }
  });
}
function bindCommonEvents(){

  document.addEventListener('click', (e)=>{
    const info = e.target?.closest?.('.infoDot[data-info]');
    if(!info) return;
    // 説明はホバー/フォーカスのツールチップで表示する。
    // summary内の i をクリックしても開閉が暴発しないように止める。
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // 日付/時間入力は、クリックでネイティブUI、キーボードで直接入力の両方を使えるように、
  // ここでは showPicker を強制しません。
  qsa('#mainNav button').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
}
function initFeatureEvents(){
  for(const [name, fn] of [['board', initBoardEvents], ['calendar', initCalendarEvents], ['setup', initSetupEvents]]){
    try{ fn(); }
    catch(e){ console.error(`${name} init error`, e); authMsg(`${name}の初期化でエラー：${e.message}`, true); }
  }
}
async function init(){
  bindAuthEvents();
  bindCommonEvents();
  if(!isConfigured()){
    safeGet('configWarning')?.classList.remove('hidden');
    authMsg('config.js の設定が必要です。', true);
    return;
  }
  initFeatureEvents();
  setInterval(()=>{ if(!safeGet('appView')?.classList.contains('hidden')) renderHero(); }, 1000);
  try{
    const session = await getSession();
    if(session) await bootAuthed(session); else showAuth();
  }catch(e){
    console.error(e);
    authMsg(e.message || '初期化でエラーが出ました', true);
    showAuth();
  }
}

init().catch(e=>{ console.error(e); authMsg(e.message || '初期化でエラーが出ました', true); showAuth(); });
