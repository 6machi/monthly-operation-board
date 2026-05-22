import { isConfigured, supabase } from './supabase-client.js?v=105';
import { getSession, signIn, signUp, signOut, resetAuthSession, ensureProfileAndTeam, loadMembers } from './auth.js?v=105';
import { loadTasks } from './tasks.js?v=105';
import { loadTree } from './setup.js?v=105';
import { state } from './state.js?v=105';
import { $, qsa, todayISO, nowTimeText, fmtDate, DEFAULT_TREE } from './utils.js?v=105';
import { initBoardEvents, renderBoard } from './board.js?v=105';
import { initCalendarEvents, renderCalendar } from './calendar.js?v=105';
import { initSetupEvents, renderSetup, renderProfilePage } from './setup-view.js?v=105';

let bootingUserId = null;
let bootPromise = null;
function withTimeout(promise, ms, label){
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject)=>{
      timer = setTimeout(()=>reject(new Error(`${label} がタイムアウトしました。通信状態を確認して、ログインし直してください。`)), ms);
    })
  ]).finally(()=>clearTimeout(timer));
}
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
  const user = session?.user || (await supabase.auth.getUser()).data?.user;
  if(!user?.id) { showAuth(); return; }

  // SIGNED_INイベントとログインボタン直後の二重起動で処理が競合すると、
  // 片方が先にbootingUserIdを立てて、もう片方が何もせず戻り、
  // 画面が「ログイン中です…」のまま止まることがありました。
  // 同じユーザーの起動中は既存Promiseを待つようにします。
  if(bootingUserId === user.id && bootPromise) return bootPromise;

  bootingUserId = user.id;
  bootPromise = (async()=>{
    try{
      authMsg('ログイン情報を確認中です…');
      state.session = session;
      state.user = user;

      authMsg('アカウント情報を反映中です…');
      const result = await withTimeout(ensureProfileAndTeam(state.user), 20000, 'アカウント反映');
      state.profile = result.profile;
      state.team = result.team;

      authMsg('メンバー情報を読み込み中です…');
      try{
        state.members = await withTimeout(loadMembers(state.team.id), 15000, 'メンバー読み込み');
      }catch(e){
        console.warn('members load failed; fallback to myself', e);
        state.members = [];
      }
      normalizeCurrentMember();
      state.selectedMemberId = state.user.id;

      authMsg('棚情報を読み込み中です…');
      try{
        const treeResult = await withTimeout(loadTree(state.team.id, state.user.id), 15000, '棚情報読み込み');
        state.treeRowId = treeResult.id; state.tree = treeResult.tree;
      }catch(e){
        console.warn('tree load failed; use default tree', e);
        state.treeRowId = null; state.tree = DEFAULT_TREE;
      }

      authMsg('タスクを読み込み中です…');
      try{
        state.tasks = await withTimeout(loadTasks(state.team.id), 20000, 'タスク読み込み');
      }catch(e){
        console.warn('tasks load failed; start empty', e);
        state.tasks = [];
        authMsg('ログインはできましたが、タスク読み込みでエラーが出ました。SupabaseのRLS/SQL設定を確認してください。', true);
      }

      safeGet('authView')?.classList.add('hidden');
      safeGet('appView')?.classList.remove('hidden');
      safeGet('mainNav')?.classList.remove('hidden');
      safeGet('logoutBtn')?.classList.remove('hidden');
      const pill = safeGet('loginPill');
      if(pill) pill.textContent = `${state.profile?.display_emoji || '🌙'} ${state.profile?.display_name || '自分'}`;
      renderCurrent();
    }finally{
      bootingUserId = null;
      bootPromise = null;
    }
  })();
  return bootPromise;
}

function showAuth(){
  state.session=null; state.user=null; state.profile=null; state.team=null; state.members=[]; state.selectedMemberId=null;
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
      const session = await withTimeout(signIn(safeGet('authEmail')?.value || '', safeGet('authPassword')?.value || ''), 20000, 'ログイン');
      await bootAuthed(session);
    }catch(e){
      console.error(e);
      authMsg(e.message || 'ログインに失敗しました', true);
    }
  });
  safeOn('signupBtn','click', async()=>{
    try{
      authMsg('登録中です…');
      const session = await withTimeout(signUp(safeGet('authEmail')?.value || '', safeGet('authPassword')?.value || ''), 20000, '新規登録');
      authMsg('登録しました。メール確認が必要な設定の場合は、メールを確認してください。');
      if(session) await bootAuthed(session);
    }catch(e){
      console.error(e);
      authMsg(e.message || '登録に失敗しました', true);
    }
  });
  safeOn('resetSessionBtn','click', async()=>{
    await resetAuthSession();
    showAuth();
    authMsg('ログイン状態をリセットしました。もう一度ログインしてください。');
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
  supabase.auth.onAuthStateChange((event, session)=>{
    // SupabaseのAuthイベント内で直接awaitつきのDB操作を行うと、環境によって
    // ログイン後に固まることがあるため、必ず次のtickへ逃がします。
    if(event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'){
      if(session?.user?.id){
        setTimeout(()=>{
          bootAuthed(session).catch(e=>{
            console.error(e);
            authMsg(e.message || 'アカウント反映でエラーが出ました', true);
          });
        }, 0);
      }
    }
    if(event === 'SIGNED_OUT') showAuth();
  });
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
