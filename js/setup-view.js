import { $, esc, occurrenceLabel } from './utils.js';
import { state } from './state.js';
import { saveTree } from './setup.js';
import { updateMyProfile, loadMembers } from './auth.js';
import { createTask, updateTask, deleteTask } from './tasks.js';
import { refreshAll, showView } from './app.js';

let draggingCategoryIndex = null;

function editable(){ return state.selectedMemberId === state.user.id; }
function cat(){ normalizeTree(); return state.tree[state.selectedCategoryIndex] || state.tree[0]; }
function fill(sel, arr, cur){ sel.innerHTML=(arr||[]).map(v=>`<option ${v===cur?'selected':''}>${esc(v)}</option>`).join(''); }
function uniq(arr){ return [...new Set((arr||[]).map(v=>String(v||'').trim()).filter(Boolean))]; }
function normalizeCategory(c){
  if(!c) return c;
  if(!Array.isArray(c.sharedWith)) c.sharedWith=[];
  if(!Array.isArray(c.projects)) c.projects=[];
  const categoryLevelCandidates = uniq(c.candidates || []);
  const normalizedProjects = [];

  c.projects.forEach((p, index)=>{
    if(typeof p === 'string'){
      normalizedProjects.push({ name:p, candidates:[] });
      return;
    }
    if(!p?.name) return;
    const projectCandidates = [];
    if(Array.isArray(p.candidates)) projectCandidates.push(...p.candidates);
    (p.types||[]).forEach(ty=>(ty?.tasks||[]).forEach(t=>projectCandidates.push(t)));
    normalizedProjects.push({ name:p.name, candidates:uniq(projectCandidates) });
  });

  if(!normalizedProjects.length && categoryLevelCandidates.length){
    normalizedProjects.push({ name:'未分類', candidates:categoryLevelCandidates });
  }else if(categoryLevelCandidates.length){
    // v16以前の「カテゴリ直下の候補」は、最初のプロジェクトへ退避させます。
    normalizedProjects[0].candidates = uniq([...(normalizedProjects[0].candidates||[]), ...categoryLevelCandidates]);
  }

  c.projects = normalizedProjects;
  delete c.candidates;
  return c;
}
function normalizeTree(){ state.tree = (state.tree||[]).map(normalizeCategory); }
function memberById(id){ return state.members.find(m=>m.id===id); }
function categorySharedWith(c){ return Array.isArray(c?.sharedWith) ? c.sharedWith : []; }
function projectCandidateCount(c){ return (c?.projects||[]).reduce((n,p)=>n + (p.candidates?.length||0), 0); }
function categoryShareLabel(c){
  const ids = categorySharedWith(c).filter(id=>id && id!==state.user?.id);
  if(!ids.length) return '<span class="catSharePill solo">ひとりでやる</span>';
  return ids.map(id=>{
    const m = memberById(id);
    if(!m) return '';
    return `<span class="catSharePill" style="--share-color:${esc(m.color || '#5d9cec')}">${esc(m.emoji || '🌙')} ${esc(m.name)}</span>`;
  }).join('');
}
function canUseCategoryForMember(c, memberId){
  if(memberId === state.user?.id) return true;
  return categorySharedWith(c).includes(memberId);
}
async function persist(){ normalizeTree(); await saveTree(state.treeRowId, state.tree); renderSetup(); }

export function renderSetup(){
  normalizeTree();
  $('setupNotice').textContent = editable()
    ? 'タスクを追加する画面です。カテゴリはドラッグで並び替えできます。'
    : '他メンバーのタスク追加画面は閲覧中心です。';
  renderCategories();
  renderSelectors();
  renderCategoryEditor();
  renderRegisteredTasks();
  document.querySelectorAll('#setup input,#setup select,#setup textarea,#setup button').forEach(el=>{ if(!el.closest('.tabs')) el.disabled = !editable(); });
}

export function renderProfilePage(){
  state.selectedMemberId = state.user.id;
  renderProfileSettings();
  renderAchievementArchive(state.user.id);
}

function renderProfileSettings(){
  const panel = $('profileSettingsPanel');
  if(!panel) return;
  panel.classList.remove('hidden');
  const profile = state.profile || {};
  $('profileName').value = profile.display_name || '自分';
  $('profileEmoji').value = profile.display_emoji || '🌙';
  $('profileColor').value = profile.display_color || '#5d9cec';
  renderProfilePreview();
}
function renderProfilePreview(){
  const name = $('profileName').value || '自分';
  const emoji = $('profileEmoji').value || '🌙';
  const color = $('profileColor').value || '#5d9cec';
  $('profilePreview').innerHTML = `<div class="profileChip" style="--profile-color:${esc(color)}"><span>${esc(emoji)}</span><b>${esc(name)}</b></div>`;
}

function renderAchievementArchive(memberId = state.user?.id){
  const box = $('achievementArchive');
  if(!box) return;
  const member = state.members.find(m=>m.id===memberId) || state.profile || {};
  const name = member.name || '自分';
  const emoji = member.emoji || '🌙';
  const color = member.color || '#5d9cec';
  const doneTasks = state.tasks
    .filter(t=>t.owner_id===memberId && t.done)
    .slice()
    .sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')));
  const byCategory = new Map();
  doneTasks.forEach(t=>{
    const key = t.category || '未分類';
    if(!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(t);
  });
  const categories = [...byCategory.entries()].sort((a,b)=>b[1].length-a[1].length || a[0].localeCompare(b[0],'ja'));
  const topCategory = categories[0]?.[0] || 'まだこれから';
  const latest = doneTasks[0];
  const latestText = latest ? `最近は「${latest.title || '無題タスク'}」を完了` : '完了したタスクはまだありません';
  box.innerHTML = `
    <div class="achievementHero" style="--ach-color:${esc(color)}">
      <div class="achievementIcon">${esc(emoji)}</div>
      <div class="achievementMain">
        <div class="achievementTitle">${esc(name)}は合計 <strong>${doneTasks.length}</strong> 個のタスクを完了させたね！</div>
        <div class="achievementSub">${esc(latestText)}</div>
      </div>
      <div class="achievementBadge">${esc(topCategory)}</div>
    </div>
    ${doneTasks.length ? `<div class="achievementCategories">${categories.map(([category, arr])=>`
      <section class="achievementCategory" style="--ach-color:${esc(color)}">
        <div class="achievementCategoryHead"><b>${esc(category)}</b><span>${arr.length}個できた</span></div>
        <div class="achievementDoneList">
          ${arr.slice(0,8).map(t=>`
            <div class="doneTaskPill"><span class="doneMark">✓</span><span class="doneTitle">${esc(t.title || '無題タスク')}</span><small>${esc(t.project || '')}</small></div>
          `).join('')}
          ${arr.length>8 ? `<div class="doneMore">ほか ${arr.length-8}個</div>` : ''}
        </div>
      </section>`).join('')}</div>` : '<div class="empty">完了にしたタスクがここに積み上がります。</div>'}
  `;
}

function renderCategories(){
  const grid=$('categoryGrid'); grid.innerHTML='';
  state.tree.forEach((c,i)=>{
    const card=document.createElement('article');
    card.className='cat sortableCat draggableCat';
    if(i===state.selectedCategoryIndex) card.classList.add('selected');
    card.style.setProperty('--c', c.color || '#9aa4b6');
    card.setAttribute('draggable', editable() ? 'true' : 'false');
    card.dataset.catIndex = String(i);
    card.innerHTML=`
      <div class="catCardMain">
        <h3>${esc(c.name)}</h3>
        <p>${esc(c.memo||'')}<br>プロジェクト ${c.projects?.length||0} / タスク候補 ${projectCandidateCount(c)}</p>
        <div class="catShareList">${categoryShareLabel(c)}</div>
      </div>
      <div class="dragHint">ドラッグで並び替え</div>`;
    card.addEventListener('click',()=>{ state.selectedCategoryIndex=i; renderSetup(); });
    card.addEventListener('dragstart',e=>{
      if(!editable()){ e.preventDefault(); return; }
      draggingCategoryIndex = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    card.addEventListener('dragend',()=>{ draggingCategoryIndex=null; card.classList.remove('dragging'); grid.querySelectorAll('.dragover').forEach(el=>el.classList.remove('dragover')); });
    card.addEventListener('dragover',e=>{ if(draggingCategoryIndex===null)return; e.preventDefault(); card.classList.add('dragover'); e.dataTransfer.dropEffect='move'; });
    card.addEventListener('dragleave',()=>card.classList.remove('dragover'));
    card.addEventListener('drop',async e=>{
      e.preventDefault(); card.classList.remove('dragover');
      const from = draggingCategoryIndex ?? Number(e.dataTransfer.getData('text/plain'));
      const to = Number(card.dataset.catIndex);
      if(Number.isNaN(from) || Number.isNaN(to) || from===to) return;
      const [item] = state.tree.splice(from, 1);
      state.tree.splice(to, 0, item);
      state.selectedCategoryIndex = to;
      await persist();
    });
    grid.appendChild(card);
  });
}

function renderSelectors(){
  const c=cat(); if(!c) return;
  const oldCat=$('newCategory').value, oldProj=$('newProject').value, oldCand=$('newCandidate').value;
  const usableTree = state.tree.filter(x=>canUseCategoryForMember(x, state.user.id));
  fill($('newCategory'), usableTree.map(x=>x.name), oldCat || c.name);
  const currentCat = usableTree.find(x=>x.name===$('newCategory').value) || c;
  fill($('newProject'), (currentCat.projects||[]).map(p=>p.name), oldProj);
  const currentProject = (currentCat.projects||[]).find(p=>p.name===$('newProject').value) || currentCat.projects?.[0];
  fill($('newCandidate'), ['候補から選ぶ', ...(currentProject?.candidates||[])], oldCand);
}

function renderSharePicker(c){
  const ids = categorySharedWith(c);
  const others = state.members.filter(m=>m.id !== state.user.id);
  if(!others.length){ return '<div class="empty">まだ一緒に選べるメンバーがいません。</div>'; }
  return `<div class="shareMemberList">${others.map(m=>`
    <label class="shareMemberOption" style="--share-color:${esc(m.color || '#5d9cec')}">
      <input type="checkbox" class="shareMemberCheck" value="${esc(m.id)}" ${ids.includes(m.id)?'checked':''}>
      <span class="shareEmoji">${esc(m.emoji || '🌙')}</span><span class="shareName">${esc(m.name)}</span>
    </label>`).join('')}</div>`;
}

function renderProjectCandidateBoxes(c){
  const projects = c.projects || [];
  return `
    <div class="projectCandidateEditor">
      ${projects.length ? projects.map((p,pi)=>`
        <section class="projectCandidateBox" data-project-box="${pi}">
          <div class="projectCandidateHead">
            <div><b>${esc(p.name)}</b><span>タスク候補 ${p.candidates?.length||0}件</span></div>
            <div class="boxItemActions"><button type="button" class="ghost tiny" data-edit-project="${pi}">プロジェクト名を修正</button><button type="button" class="danger tiny" data-delete-project="${pi}">×</button></div>
          </div>
          <p class="muted">このプロジェクトで使うタスク候補です。</p>
          <div class="candidateChips bigCandidates">
            ${(p.candidates||[]).length ? p.candidates.map((name,ci)=>`
              <span class="candidateChip editableCandidate">${esc(name)}
                <button type="button" class="chipEdit" data-edit-cand="${pi}:${ci}" title="修正">修正</button>
                <button type="button" class="chipDelete" data-del-cand="${pi}:${ci}" title="削除">×</button>
              </span>
            `).join('') : '<span class="muted">タスク候補はまだありません。</span>'}
          </div>
          <div class="minirow candidateAddRow">
            <input data-candidate-input="${pi}" placeholder="このプロジェクトに候補を追加">
            <button type="button" class="ghost" data-add-cand-to-project="${pi}">追加</button>
          </div>
        </section>`).join('') : '<div class="empty">プロジェクトを追加すると、その中にタスク候補を入れられます。</div>'}
    </div>`;
}

function renderCategoryEditor(){
  const c=cat(); const box=$('categoryEditor');
  if(!c){
    box.innerHTML=`<div class="empty">カテゴリがありません。</div><div class="actions"><button id="addCategoryBtn" class="primary">カテゴリ追加</button></div>`;
    $('addCategoryBtn').onclick = async()=>{ const name=prompt('追加するカテゴリ名'); if(!name)return; state.tree.push({name, memo:'', color:'#9aa4b6', projects:[], sharedWith:[]}); state.selectedCategoryIndex=state.tree.length-1; await persist(); };
    return;
  }
  box.innerHTML = `
    <div class="editorgrid">
      <label><small>カテゴリ名</small><input id="editCatName" value="${esc(c.name)}"></label>
      <label><small>色</small><input id="editCatColor" type="color" value="${esc(c.color||'#9aa4b6')}"></label>
      <label style="grid-column:1/-1"><small>メモ</small><input id="editCatMemo" value="${esc(c.memo||'')}"></label>
    </div>
    <section class="sharePickerBox"><div class="sharePickerHead"><b>一緒に頑張るひとを選択</b><span>選ばない場合は、ひとりでやるカテゴリです。</span></div>${renderSharePicker(c)}</section>
    <div class="actions mainActions"><button id="saveCatBtn" class="primary">カテゴリを保存</button></div>
    <details class="softDetails" open><summary>登録されている棚</summary>${renderProjectCandidateBoxes(c)}</details>
    <details class="softDetails adminDetails"><summary>棚の追加・削除など</summary><div class="actions"><button id="addCategoryBtn" class="ghost">カテゴリ追加</button><button id="addProjectBtn" class="ghost">プロジェクト追加</button><button id="deleteCategoryBtn" class="danger">カテゴリ削除</button></div></details>`;

  $('saveCatBtn').onclick = async()=>{
    c.name=$('editCatName').value.trim()||c.name; c.color=$('editCatColor').value; c.memo=$('editCatMemo').value;
    c.sharedWith = [...box.querySelectorAll('.shareMemberCheck:checked')].map(input=>input.value); await persist();
  };
  box.querySelectorAll('.shareMemberCheck').forEach(input=>input.addEventListener('change', async()=>{ c.sharedWith=[...box.querySelectorAll('.shareMemberCheck:checked')].map(input=>input.value); await saveTree(state.treeRowId,state.tree); renderCategories(); }));
  $('addCategoryBtn').onclick = async()=>{ const name=prompt('追加するカテゴリ名'); if(!name)return; state.tree.push({name, memo:'', color:'#9aa4b6', projects:[], sharedWith:[]}); state.selectedCategoryIndex=state.tree.length-1; await persist(); };
  $('deleteCategoryBtn').onclick = async()=>{ if(!confirm(`カテゴリ「${c.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return; state.tree.splice(state.selectedCategoryIndex,1); state.selectedCategoryIndex=Math.max(0,state.selectedCategoryIndex-1); await persist(); };
  $('addProjectBtn').onclick = async()=>{ const name=prompt('追加するプロジェクト名'); if(!name)return; c.projects=c.projects||[]; c.projects.push({name:name.trim(), candidates:[]}); await persist(); };
  box.querySelectorAll('[data-edit-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.editProject); const p=c.projects?.[pi]; if(!p)return; const name=prompt('プロジェクト名を修正', p.name); if(!name)return; p.name=name.trim()||p.name; await persist(); });
  box.querySelectorAll('[data-delete-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.deleteProject); const p=c.projects?.[pi]; if(!p)return; if(!confirm(`プロジェクト「${p.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return; c.projects.splice(pi,1); await persist(); });
  box.querySelectorAll('[data-add-cand-to-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.addCandToProject); const p=c.projects?.[pi]; if(!p)return; const input=box.querySelector(`[data-candidate-input="${pi}"]`); const name=input?.value?.trim(); if(!name)return alert('追加するタスク候補を入力してください'); p.candidates=uniq([...(p.candidates||[]), name]); input.value=''; await persist(); });
  box.querySelectorAll('[data-edit-cand]').forEach(btn=>btn.onclick=async()=>{ const [pi,ci]=String(btn.dataset.editCand).split(':').map(Number); const p=c.projects?.[pi]; const old=p?.candidates?.[ci]; if(!old)return; const name=prompt('タスク候補を修正', old); if(!name)return; p.candidates[ci]=name.trim()||old; p.candidates=uniq(p.candidates); await persist(); });
  box.querySelectorAll('[data-del-cand]').forEach(btn=>btn.onclick=async()=>{ const [pi,ci]=String(btn.dataset.delCand).split(':').map(Number); const p=c.projects?.[pi]; const name=p?.candidates?.[ci]; if(!name)return; if(!confirm(`「${name}」を候補から削除しますか？`)) return; p.candidates.splice(ci,1); await persist(); });
}

function taskDateLabel(t){ return t.schedule_date || t.carryover_date || t.due_date || ''; }
function renderRegisteredTasks(){
  const box = $('registeredTasks'); if(!box) return;
  const mine = editable();
  const arr = state.tasks.filter(t=>t.owner_id===state.selectedMemberId).slice().sort((a,b)=>String(taskDateLabel(b)).localeCompare(String(taskDateLabel(a))) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!arr.length){ box.innerHTML = '<div class="empty">登録済みタスクはまだありません。</div>'; return; }
  box.innerHTML = arr.map(t=>`
    <article class="registeredTask ${t.done?'done':''}" data-task-card="${esc(t.id)}">
      <div class="registeredTaskHead"><div><b>${esc(t.title)}</b><div class="muted">${esc(t.category||'未分類')} / ${esc(t.project||'')}</div></div><div class="taskDateBadge">${esc(taskDateLabel(t) || '日付なし')}</div></div>
      <div class="badges"><span class="badge">${Math.round(Number(t.estimated_minutes||30))}分</span><span class="badge">${esc(t.status||'')}</span><span class="badge">${occurrenceLabel(t.occurrence)}</span>${t.done?'<span class="badge">完了</span>':''}</div>
      ${t.memo?`<p class="taskMemo">${esc(t.memo)}</p>`:''}
      <details class="taskEditDetails"><summary>このタスクを修正する</summary>
        <div class="form taskEditForm">
          <label><small>タスク名</small><input data-field="title" value="${esc(t.title||'')}"></label>
          <label><small>カテゴリ</small><input data-field="category" value="${esc(t.category||'')}"></label>
          <label><small>プロジェクト</small><input data-field="project" value="${esc(t.project||'')}"></label>
          <label><small>見積もり時間 分</small><input data-field="estimated_minutes" type="number" min="5" step="5" value="${esc(t.estimated_minutes||30)}"></label>
          <label><small>予定日</small><input data-field="schedule_date" type="date" value="${esc(t.schedule_date||'')}"></label>
          <label><small>持ち越し日</small><input data-field="carryover_date" type="date" value="${esc(t.carryover_date||'')}"></label>
          <label><small>期限</small><input data-field="due_date" type="date" value="${esc(t.due_date||'')}"></label>
          <label><small>発生タイプ</small><select data-field="occurrence">
            <option value="single" ${t.occurrence==='single'||!t.occurrence?'selected':''}>単発</option>
            <option value="daily" ${t.occurrence==='daily'?'selected':''}>毎日</option>
            <option value="weekly" ${t.occurrence==='weekly'?'selected':''}>毎週</option>
            <option value="monthly" ${t.occurrence==='monthly'?'selected':''}>毎月</option>
          </select></label>
          <label style="grid-column:1/-1"><small>メモ</small><textarea data-field="memo">${esc(t.memo||'')}</textarea></label>
        </div>
        <div class="actions"><button type="button" class="primary" data-save-task="${esc(t.id)}">保存</button><button type="button" class="ghost" data-toggle-done="${esc(t.id)}">${t.done?'未完了に戻す':'完了にする'}</button><button type="button" class="danger" data-delete-task="${esc(t.id)}">削除</button></div>
      </details>
    </article>`).join('');
  box.querySelectorAll('[data-save-task]').forEach(btn=>btn.onclick=async()=>{
    if(!mine) return alert('他メンバーのタスクは編集できません');
    const id=btn.dataset.saveTask; const card=box.querySelector(`[data-task-card="${id}"]`); const val=(name)=>card.querySelector(`[data-field="${name}"]`)?.value || '';
    const schedule=val('schedule_date')||null; const carry=val('carryover_date')||null;
    await updateTask(id,{ title:val('title').trim()||'無題タスク', category:val('category').trim()||'未分類', project:val('project').trim()||'未分類', task_type:'', estimated_minutes:Number(val('estimated_minutes')||30), schedule_date:schedule, carryover_date:carry, due_date:val('due_date')||null, occurrence:val('occurrence')||'single', memo:val('memo')||'', status:carry?'carryover':'scheduled' });
    await refreshAll();
  });
  box.querySelectorAll('[data-toggle-done]').forEach(btn=>btn.onclick=async()=>{ if(!mine)return alert('他メンバーのタスクは編集できません'); const id=btn.dataset.toggleDone; const t=state.tasks.find(x=>String(x.id)===String(id)); if(!t)return; await updateTask(id,{ done:!t.done, status:!t.done?'done':'scheduled' }); await refreshAll(); });
  box.querySelectorAll('[data-delete-task]').forEach(btn=>btn.onclick=async()=>{ if(!mine)return alert('他メンバーのタスクは編集できません'); const id=btn.dataset.deleteTask; const t=state.tasks.find(x=>String(x.id)===String(id)); if(!confirm(`タスク「${t?.title||''}」を削除しますか？`))return; await deleteTask(id); await refreshAll(); });
}

export function initSetupEvents(){
  $('backToBoardBtn')?.addEventListener('click', ()=>showView('board'));
  $('saveProfileBtn').addEventListener('click', async()=>{
    try{
      const updated = await updateMyProfile({ display_name:$('profileName').value, display_emoji:$('profileEmoji').value, display_color:$('profileColor').value });
      state.profile = updated; state.members = await loadMembers(state.team.id); $('loginPill').textContent = `${updated.display_emoji || '🌙'} ${updated.display_name || '自分'}`; alert('自分設定を保存しました'); renderProfilePage(); refreshAll();
    }catch(e){ alert(e.message || '自分設定の保存に失敗しました'); }
  });
  ['profileName','profileEmoji','profileColor'].forEach(id=>$(id).addEventListener('input', renderProfilePreview));
  ['newCategory','newProject'].forEach(id=>$(id).addEventListener('change',renderSelectors));
  $('newCandidate').addEventListener('change',()=>{ if($('newCandidate').value !== '候補から選ぶ') $('newTitle').value = $('newCandidate').value; });
  $('addMonthlyTaskBtn').addEventListener('click', async()=>{
    if(!editable()) return alert('他メンバーの棚卸しは編集できません');
    const title = $('newTitle').value.trim() || ($('newCandidate').value==='候補から選ぶ'?'':$('newCandidate').value);
    if(!title) return alert('タスク名を入れてください');
    const occurrence = document.querySelector('input[name="occurrence"]:checked')?.value || 'single';
    const start = $('newStart').value || new Date().toISOString().slice(0,10);
    await createTask({ team_id:state.team.id, owner_id:state.user.id, created_by:state.user.id, title, category:$('newCategory').value, project:$('newProject').value, task_type:'', estimated_minutes:Number($('newMinutes').value||30), schedule_date:start, due_date:$('newDue').value||null, occurrence, status:'scheduled', memo:$('newMemo').value||'', sort_order:Date.now()*-1 });
    $('newTitle').value=''; $('newMinutes').value=''; $('newMemo').value=''; await refreshAll();
  });
}
