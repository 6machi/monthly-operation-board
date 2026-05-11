import { $, esc } from './utils.js';
import { state } from './state.js';
import { saveTree } from './setup.js';
import { updateMyProfile, loadMembers } from './auth.js';
import { createTask, updateTask, deleteTask } from './tasks.js';
import { refreshAll, showView } from './app.js';

function editable(){ return state.selectedMemberId === state.user.id; }
function cat(){ return state.tree[state.selectedCategoryIndex] || state.tree[0]; }
function proj(){ const c=cat(); return c?.projects?.find(p=>p.name===$('newProject').value) || c?.projects?.[0]; }
function typ(){ const p=proj(); return p?.types?.find(t=>t.name===$('newType').value) || p?.types?.[0]; }
function fill(sel, arr, cur){ sel.innerHTML=(arr||[]).map(v=>`<option ${v===cur?'selected':''}>${esc(v)}</option>`).join(''); }
export function renderSetup(){
  $('setupNotice').textContent = editable() ? '自分のタスク追加画面です。棚・登録済みタスクを編集できます。' : '他メンバーのタスク追加画面は閲覧中心です。';
  renderCategories(); renderSelectors(); renderCategoryEditor(); renderRegisteredTasks();
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
        <div class="achievementCategoryHead">
          <b>${esc(category)}</b>
          <span>${arr.length}個できた</span>
        </div>
        <div class="achievementDoneList">
          ${arr.slice(0,8).map(t=>`
            <div class="doneTaskPill">
              <span class="doneMark">✓</span>
              <span class="doneTitle">${esc(t.title || '無題タスク')}</span>
              <small>${esc(t.project || '')}${t.task_type ? ` / ${esc(t.task_type)}` : ''}</small>
            </div>
          `).join('')}
          ${arr.length>8 ? `<div class="doneMore">ほか ${arr.length-8}個</div>` : ''}
        </div>
      </section>`).join('')}</div>` : '<div class="empty">完了にしたタスクがここに積み上がります。</div>'}
  `;
}

function renderCategories(){
  const grid=$('categoryGrid'); grid.innerHTML='';
  state.tree.forEach((c,i)=>{
    const card=document.createElement('article'); card.className='cat sortableCat'; card.style.setProperty('--c', c.color || '#9aa4b6');
    card.innerHTML=`
      <div class="catCardMain">
        <h3>${esc(c.name)}</h3>
        <p>${esc(c.memo||'')}<br>プロジェクト ${c.projects?.length||0}</p>
      </div>
      <div class="catOrderButtons" aria-label="カテゴリの並び替え">
        <button type="button" class="ghost catMoveBtn" data-cat-up="${i}" ${i===0?'disabled':''}>上へ</button>
        <button type="button" class="ghost catMoveBtn" data-cat-down="${i}" ${i===state.tree.length-1?'disabled':''}>下へ</button>
      </div>`;
    card.querySelector('.catCardMain').addEventListener('click',()=>{ state.selectedCategoryIndex=i; renderSetup(); });
    grid.appendChild(card);
  });
  grid.querySelectorAll('[data-cat-up]').forEach(btn=>{
    btn.onclick = async(e)=>{ e.stopPropagation(); await moveCategory(Number(btn.dataset.catUp), -1); };
  });
  grid.querySelectorAll('[data-cat-down]').forEach(btn=>{
    btn.onclick = async(e)=>{ e.stopPropagation(); await moveCategory(Number(btn.dataset.catDown), 1); };
  });
}
async function moveCategory(index, direction){
  if(!editable()) return alert('他メンバーのカテゴリは編集できません');
  const next = index + direction;
  if(next < 0 || next >= state.tree.length) return;
  const [item] = state.tree.splice(index, 1);
  state.tree.splice(next, 0, item);
  state.selectedCategoryIndex = next;
  await persist();
}
function renderSelectors(){
  const c=cat(); if(!c) return;
  const oldCat=$('newCategory').value, oldProj=$('newProject').value, oldType=$('newType').value, oldCand=$('newCandidate').value;
  fill($('newCategory'), state.tree.map(x=>x.name), oldCat || c.name);
  const currentCat = state.tree.find(x=>x.name===$('newCategory').value) || c;
  fill($('newProject'), (currentCat.projects||[]).map(p=>p.name), oldProj);
  const currentProj = currentCat.projects?.find(p=>p.name===$('newProject').value) || currentCat.projects?.[0];
  fill($('newType'), (currentProj?.types||[]).map(t=>t.name), oldType);
  const currentType = currentProj?.types?.find(t=>t.name===$('newType').value) || currentProj?.types?.[0];
  fill($('newCandidate'), ['候補から選ぶ', ...(currentType?.tasks||[])], oldCand);
}
async function persist(){ await saveTree(state.treeRowId, state.tree); renderSetup(); }
function renderProjectTree(c){
  const projects = c.projects || [];
  if(!projects.length){
    return '<div class="empty">このカテゴリにはまだプロジェクトがありません。</div>';
  }
  return `<div class="categoryTreeList">${projects.map((p,pi)=>`
    <section class="treeProject">
      <div class="treeProjectHead">
        <b>${esc(p.name)}</b>
        <span>${p.types?.length || 0} 種類</span>
      </div>
      <div class="actions compactActions">
        <button type="button" class="ghost" data-edit-project="${pi}">プロジェクト名を修正</button>
        <button type="button" class="danger" data-delete-project="${pi}">プロジェクト削除</button>
      </div>
      <div class="treeTypeList">
        ${(p.types||[]).map((ty,ti)=>`
          <div class="treeType">
            <div class="treeTypeHead">
              <span>タスク種類</span>
              <b>${esc(ty.name)}</b>
            </div>
            <div class="actions compactActions">
              <button type="button" class="ghost" data-edit-type="${pi}:${ti}">種類名を修正</button>
              <button type="button" class="danger" data-delete-type="${pi}:${ti}">種類削除</button>
            </div>
            <div class="candidateChips">
              ${(ty.tasks||[]).length ? (ty.tasks||[]).map((name,ci)=>`
                <span class="candidateChip">${esc(name)}
                  <button type="button" class="chipEdit" data-edit-cand="${pi}:${ti}:${ci}" title="修正">修正</button>
                  <button type="button" class="chipDelete" data-del-cand="${pi}:${ti}:${ci}" title="削除">×</button>
                </span>
              `).join('') : '<span class="muted">タスク名候補はまだありません。</span>'}
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('')}</div>`;
}

function renderCategoryEditor(){
  const c=cat(); const box=$('categoryEditor');
  if(!c){
    box.innerHTML=`<div class="empty">カテゴリがありません。</div><div class="actions"><button id="addCategoryBtn" class="primary">カテゴリ追加</button></div>`;
    $('addCategoryBtn').onclick = async()=>{ const name=prompt('追加するカテゴリ名'); if(!name)return; state.tree.push({name, memo:'', color:'#9aa4b6', projects:[]}); state.selectedCategoryIndex=state.tree.length-1; await persist(); };
    return;
  }
  box.innerHTML = `
    <div class="editorgrid">
      <label><small>カテゴリ名</small><input id="editCatName" value="${esc(c.name)}"></label>
      <label><small>色</small><input id="editCatColor" type="color" value="${esc(c.color||'#9aa4b6')}"></label>
      <label style="grid-column:1/-1"><small>メモ</small><input id="editCatMemo" value="${esc(c.memo||'')}"></label>
    </div>
    <div class="actions">
      <button id="saveCatBtn" class="primary">カテゴリを保存</button>
      <button id="moveCatUpBtn" class="ghost" ${state.selectedCategoryIndex===0?'disabled':''}>上へ移動</button>
      <button id="moveCatDownBtn" class="ghost" ${state.selectedCategoryIndex===state.tree.length-1?'disabled':''}>下へ移動</button>
      <button id="addCategoryBtn" class="ghost">カテゴリ追加</button>
      <button id="deleteCategoryBtn" class="danger">カテゴリ削除</button>
      <button id="addProjectBtn" class="ghost">プロジェクト追加</button>
      <button id="addTypeBtn" class="ghost">タスク種類追加</button>
      <button id="addCandidateBtn" class="ghost">タスク名候補追加</button>
    </div>
    <div class="sectionline"><b>登録されている棚</b><p class="muted">プロジェクト名・タスク種類・タスク名候補はここから修正できます。</p>${renderProjectTree(c)}</div>`;
  $('saveCatBtn').onclick = async()=>{ c.name=$('editCatName').value.trim()||c.name; c.color=$('editCatColor').value; c.memo=$('editCatMemo').value; await persist(); };
  $('moveCatUpBtn').onclick = async()=>{ await moveCategory(state.selectedCategoryIndex, -1); };
  $('moveCatDownBtn').onclick = async()=>{ await moveCategory(state.selectedCategoryIndex, 1); };
  $('addCategoryBtn').onclick = async()=>{ const name=prompt('追加するカテゴリ名'); if(!name)return; state.tree.push({name, memo:'', color:'#9aa4b6', projects:[]}); state.selectedCategoryIndex=state.tree.length-1; await persist(); };
  $('deleteCategoryBtn').onclick = async()=>{ if(!confirm(`カテゴリ「${c.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return; state.tree.splice(state.selectedCategoryIndex,1); state.selectedCategoryIndex=Math.max(0,state.selectedCategoryIndex-1); await persist(); };
  $('addProjectBtn').onclick = async()=>{ const name=prompt('追加するプロジェクト名'); if(!name)return; c.projects=c.projects||[]; c.projects.push({name, types:[{name:'未分類',tasks:[]}]}); await persist(); };
  $('addTypeBtn').onclick = async()=>{ const pName=prompt('どのプロジェクトに追加しますか？', c.projects?.[0]?.name||''); const p=c.projects?.find(x=>x.name===pName); if(!p)return alert('プロジェクトが見つかりません'); const name=prompt('追加するタスク種類'); if(!name)return; p.types=p.types||[]; p.types.push({name,tasks:[]}); await persist(); };
  $('addCandidateBtn').onclick = async()=>{ const pName=prompt('プロジェクト名', c.projects?.[0]?.name||''); const p=c.projects?.find(x=>x.name===pName); if(!p)return alert('プロジェクトが見つかりません'); const tName=prompt('タスク種類', p.types?.[0]?.name||''); const ty=p.types?.find(x=>x.name===tName); if(!ty)return alert('タスク種類が見つかりません'); const name=prompt('追加するタスク名候補'); if(!name)return; ty.tasks=ty.tasks||[]; ty.tasks.push(name); await persist(); };

  box.querySelectorAll('[data-edit-project]').forEach(btn=>{
    btn.onclick = async()=>{
      const pi=Number(btn.dataset.editProject); const p=c.projects?.[pi]; if(!p)return;
      const name=prompt('プロジェクト名を修正', p.name); if(!name)return;
      p.name=name.trim()||p.name; await persist();
    };
  });
  box.querySelectorAll('[data-delete-project]').forEach(btn=>{
    btn.onclick = async()=>{
      const pi=Number(btn.dataset.deleteProject); const p=c.projects?.[pi]; if(!p)return;
      if(!confirm(`プロジェクト「${p.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return;
      c.projects.splice(pi,1); await persist();
    };
  });
  box.querySelectorAll('[data-edit-type]').forEach(btn=>{
    btn.onclick = async()=>{
      const [pi,ti]=btn.dataset.editType.split(':').map(Number); const ty=c.projects?.[pi]?.types?.[ti]; if(!ty)return;
      const name=prompt('タスク種類名を修正', ty.name); if(!name)return;
      ty.name=name.trim()||ty.name; await persist();
    };
  });
  box.querySelectorAll('[data-delete-type]').forEach(btn=>{
    btn.onclick = async()=>{
      const [pi,ti]=btn.dataset.deleteType.split(':').map(Number); const ty=c.projects?.[pi]?.types?.[ti]; if(!ty)return;
      if(!confirm(`タスク種類「${ty.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return;
      c.projects[pi].types.splice(ti,1); await persist();
    };
  });
  box.querySelectorAll('[data-edit-cand]').forEach(btn=>{
    btn.onclick = async()=>{
      const [pi,ti,ci] = btn.dataset.editCand.split(':').map(Number);
      const old = c.projects?.[pi]?.types?.[ti]?.tasks?.[ci];
      if(!old) return;
      const name=prompt('タスク名候補を修正', old); if(!name)return;
      c.projects[pi].types[ti].tasks[ci]=name.trim()||old; await persist();
    };
  });
  box.querySelectorAll('[data-del-cand]').forEach(btn=>{
    btn.onclick = async()=>{
      const [pi,ti,ci] = btn.dataset.delCand.split(':').map(Number);
      const name = c.projects?.[pi]?.types?.[ti]?.tasks?.[ci];
      if(!name) return;
      if(!confirm(`「${name}」を候補から削除しますか？`)) return;
      c.projects[pi].types[ti].tasks.splice(ci,1);
      await persist();
    };
  });
}

function taskDateLabel(t){
  return t.schedule_date || t.carryover_date || t.due_date || '';
}
function renderRegisteredTasks(){
  const box = $('registeredTasks');
  if(!box) return;
  const mine = editable();
  const arr = state.tasks
    .filter(t=>t.owner_id===state.selectedMemberId)
    .slice()
    .sort((a,b)=>String(taskDateLabel(b)).localeCompare(String(taskDateLabel(a))) || String(b.created_at||'').localeCompare(String(a.created_at||'')));

  if(!arr.length){
    box.innerHTML = '<div class="empty">登録済みタスクはまだありません。</div>';
    return;
  }

  box.innerHTML = arr.map(t=>`
    <article class="registeredTask ${t.done?'done':''}" data-task-card="${esc(t.id)}">
      <div class="registeredTaskHead">
        <div>
          <b>${esc(t.title)}</b>
          <div class="muted">${esc(t.category||'未分類')} / ${esc(t.project||'')} / ${esc(t.task_type||'')}</div>
        </div>
        <div class="taskDateBadge">${esc(taskDateLabel(t) || '日付なし')}</div>
      </div>
      <div class="badges">
        <span class="badge">${Math.round(Number(t.estimated_minutes||30))}分</span>
        <span class="badge">${esc(t.status||'')}</span>
        ${t.done?'<span class="badge">完了</span>':''}
      </div>
      ${t.memo?`<p class="taskMemo">${esc(t.memo)}</p>`:''}
      <details class="taskEditDetails">
        <summary>このタスクを修正する</summary>
        <div class="form taskEditForm">
          <label><small>タスク名</small><input data-field="title" value="${esc(t.title||'')}"></label>
          <label><small>カテゴリ</small><input data-field="category" value="${esc(t.category||'')}"></label>
          <label><small>プロジェクト</small><input data-field="project" value="${esc(t.project||'')}"></label>
          <label><small>タスク種類</small><input data-field="task_type" value="${esc(t.task_type||'')}"></label>
          <label><small>見積もり時間 分</small><input data-field="estimated_minutes" type="number" min="5" step="5" value="${esc(t.estimated_minutes||30)}"></label>
          <label><small>予定日</small><input data-field="schedule_date" type="date" value="${esc(t.schedule_date||'')}"></label>
          <label><small>持ち越し日</small><input data-field="carryover_date" type="date" value="${esc(t.carryover_date||'')}"></label>
          <label><small>期限</small><input data-field="due_date" type="date" value="${esc(t.due_date||'')}"></label>
          <label style="grid-column:1/-1"><small>メモ</small><textarea data-field="memo">${esc(t.memo||'')}</textarea></label>
        </div>
        <div class="actions">
          <button type="button" class="primary" data-save-task="${esc(t.id)}">保存</button>
          <button type="button" class="ghost" data-toggle-done="${esc(t.id)}">${t.done?'未完了に戻す':'完了にする'}</button>
          <button type="button" class="danger" data-delete-task="${esc(t.id)}">削除</button>
        </div>
      </details>
    </article>
  `).join('');

  box.querySelectorAll('[data-save-task]').forEach(btn=>{
    btn.onclick = async()=>{
      if(!mine) return alert('他メンバーのタスクは編集できません');
      const id=btn.dataset.saveTask;
      const card=box.querySelector(`[data-task-card="${id}"]`);
      const val=(name)=>card.querySelector(`[data-field="${name}"]`)?.value || '';
      const schedule = val('schedule_date') || null;
      const carry = val('carryover_date') || null;
      await updateTask(id, {
        title: val('title').trim() || '無題タスク',
        category: val('category').trim() || '未分類',
        project: val('project').trim() || '未分類',
        task_type: val('task_type').trim() || '未分類',
        estimated_minutes: Number(val('estimated_minutes') || 30),
        schedule_date: schedule,
        carryover_date: carry,
        due_date: val('due_date') || null,
        memo: val('memo') || '',
        status: carry ? 'carryover' : 'scheduled'
      });
      await refreshAll();
    };
  });
  box.querySelectorAll('[data-toggle-done]').forEach(btn=>{
    btn.onclick = async()=>{
      if(!mine) return alert('他メンバーのタスクは編集できません');
      const id=btn.dataset.toggleDone;
      const t=state.tasks.find(x=>String(x.id)===String(id));
      if(!t)return;
      await updateTask(id, { done: !t.done, status: !t.done ? 'done' : 'scheduled' });
      await refreshAll();
    };
  });
  box.querySelectorAll('[data-delete-task]').forEach(btn=>{
    btn.onclick = async()=>{
      if(!mine) return alert('他メンバーのタスクは編集できません');
      const id=btn.dataset.deleteTask;
      const t=state.tasks.find(x=>String(x.id)===String(id));
      if(!confirm(`タスク「${t?.title||''}」を削除しますか？`))return;
      await deleteTask(id);
      await refreshAll();
    };
  });
}

export function initSetupEvents(){
  $('backToBoardBtn')?.addEventListener('click', ()=>showView('board'));
  $('saveProfileBtn').addEventListener('click', async()=>{
    try{
      const updated = await updateMyProfile({
        display_name: $('profileName').value,
        display_emoji: $('profileEmoji').value,
        display_color: $('profileColor').value
      });
      state.profile = updated;
      state.members = await loadMembers(state.team.id);
      $('loginPill').textContent = `${updated.display_emoji || '🌙'} ${updated.display_name || '自分'}`;
      alert('自分設定を保存しました');
      renderProfilePage();
      refreshAll();
    }catch(e){ alert(e.message || '自分設定の保存に失敗しました'); }
  });
  ['profileName','profileEmoji','profileColor'].forEach(id=>$(id).addEventListener('input', renderProfilePreview));
  ['newCategory','newProject','newType'].forEach(id=>$(id).addEventListener('change',renderSelectors));
  $('newCandidate').addEventListener('change',()=>{ if($('newCandidate').value !== '候補から選ぶ') $('newTitle').value = $('newCandidate').value; });
  $('addMonthlyTaskBtn').addEventListener('click', async()=>{
    if(!editable()) return alert('他メンバーの棚卸しは編集できません');
    const title = $('newTitle').value.trim() || ($('newCandidate').value==='候補から選ぶ'?'':$('newCandidate').value);
    if(!title) return alert('タスク名を入れてください');
    const occurrence = document.querySelector('input[name="occurrence"]:checked')?.value || 'single';
    const start = $('newStart').value || new Date().toISOString().slice(0,10);
    await createTask({ team_id:state.team.id, owner_id:state.user.id, created_by:state.user.id, title,
      category:$('newCategory').value, project:$('newProject').value, task_type:$('newType').value,
      estimated_minutes:Number($('newMinutes').value||30), schedule_date:start, due_date:$('newDue').value||null,
      occurrence, status:'scheduled', memo:$('newMemo').value||'', sort_order:Date.now()*-1 });
    $('newTitle').value=''; $('newMinutes').value=''; $('newMemo').value='';
    await refreshAll();
  });
}
