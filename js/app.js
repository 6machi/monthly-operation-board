import { isConfigured } from './supabase-client.js';
import { getSession, signIn, signUp, signOut, ensureProfileAndTeam, loadMembers } from './auth.js';
import { loadTasks } from './tasks.js';
import { loadTree } from './setup.js';
import { state } from './state.js';
import { $, qsa, todayISO, nowTimeText, fmtDate, addDays } from './utils.js';
import { initBoardEvents, renderBoard } from './board.js';
import { initCalendarEvents, renderCalendar } from './calendar.js';
import { initSetupEvents, renderSetup, renderProfilePage } from './setup-view.js';

export function showView(view){
  state.view = view;
  qsa('.view').forEach(v=>v.classList.remove('active'));
  $(view).classList.add('active');
  qsa('#mainNav button').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  renderCurrent();
}
function renderCurrent(){
  renderMemberTabs();
  renderHero();
  if(state.view==='board') renderBoard();
  if(state.view==='calendar') renderCalendar();
  if(state.view==='setup') renderSetup();
  if(state.view==='profile') renderProfilePage();
}
function renderHero(){
  $('heroDate').textContent = fmtDate(todayISO());
  $('heroTime').textContent = nowTimeText();
}
function renderMemberTabs(){
  const html = state.members.map(m=>`<button class="memberTab ${m.id===state.selectedMemberId?'active':''}" data-member="${m.id}" style="--member-color:${m.color || '#5d9cec'}"><span>${m.emoji || '🌙'}</span>${m.name}</button>`).join('');
  const boardTabs = $('memberTabs');
  const setupTabs = $('setupMemberTabs');
  if(boardTabs) boardTabs.innerHTML = html;
  if(setupTabs) setupTabs.innerHTML = html;
  [...(boardTabs?.querySelectorAll('button') || []), ...(setupTabs?.querySelectorAll('button') || [])].forEach(btn=>{
    btn.addEventListener('click', async()=>{
      state.selectedMemberId = btn.dataset.member;
      if(state.selectedMemberId === state.user.id){
        const treeResult = await loadTree(state.team.id, state.user.id);
        state.treeRowId = treeResult.id; state.tree = treeResult.tree;
      }
      renderCurrent();
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
  state.selectedMemberId = state.selectedMemberId || state.user.id;
  const treeResult = await loadTree(state.team.id, state.user.id);
  state.treeRowId = treeResult.id; state.tree = treeResult.tree;
  state.tasks = await loadTasks(state.team.id);
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); $('mainNav').classList.remove('hidden'); $('logoutBtn').classList.remove('hidden');
  $('loginPill').textContent = `${state.profile?.display_emoji || '🌙'} ${state.profile?.display_name || '自分'}`;
  renderCurrent();
}
function showAuth(){
  $('authView').classList.remove('hidden'); $('appView').classList.add('hidden'); $('mainNav').classList.add('hidden'); $('logoutBtn').classList.add('hidden');
  $('loginPill').textContent='未ログイン';
}
function authMsg(text, error=false){
  const el=$('authMsg'); el.textContent=text; el.className = `notice ${error?'error':'ok'}`; el.classList.remove('hidden');
}
async function init(){
  if(!isConfigured()){
    $('configWarning').classList.remove('hidden');
    authMsg('config.js の設定が必要です。', true);
    return;
  }
  initBoardEvents(); initCalendarEvents(); initSetupEvents();
  qsa('#mainNav button').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
  $('loginPill').addEventListener('click',()=>{ if(state.user) showView('profile'); });
  document.addEventListener('click', (e)=>{
    const pill = e.target.closest?.('#loginPill');
    if(pill && state.user){ e.preventDefault(); showView('profile'); }
  });
  $('signinBtn').addEventListener('click', async()=>{
    try{ const session = await signIn($('authEmail').value, $('authPassword').value); await bootAuthed(session); }
    catch(e){ authMsg(e.message || 'ログインに失敗しました', true); }
  });
  $('signupBtn').addEventListener('click', async()=>{
    try{ const session = await signUp($('authEmail').value, $('authPassword').value); authMsg('登録しました。メール確認が必要な設定の場合は、メールを確認してください。'); if(session) await bootAuthed(session); }
    catch(e){ authMsg(e.message || '登録に失敗しました', true); }
  });
  $('logoutBtn').addEventListener('click', async()=>{ await signOut(); showAuth(); });
  setInterval(()=>{ if(!$('appView').classList.contains('hidden')) renderHero(); }, 1000);
  const session = await getSession();
  if(session) await bootAuthed(session); else showAuth();
}

init().catch(e=>{ console.error(e); authMsg(e.message || '初期化でエラーが出ました', true); });
