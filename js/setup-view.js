import { $, esc, occurrenceLabel, addDays, diffDays, fmtDate, minutesFromTime, fullClock } from './utils.js?v=88';
import { state } from './state.js?v=88';
import { saveTree } from './setup.js?v=88';
import { updateMyProfile, loadMembers } from './auth.js?v=88';
import { createTask, updateTask, deleteTask } from './tasks.js?v=88';
import { refreshAll, showView } from './app.js?v=88';
import { renderUnavailableList, isUnavailableTask } from './calendar.js?v=88';

let draggingCategoryIndex = null;
const ACHIEVEMENT_EXCLUDE = '[[achievement_excluded]]';
function achievementExcluded(t){ return String(t?.memo||'').includes(ACHIEVEMENT_EXCLUDE); }
function stripAchievementMarker(memo){ return String(memo||'').replace(ACHIEVEMENT_EXCLUDE,'').trim(); }
function categoryColor(name){ const c=(state.tree||[]).find(x=>x.name===name); return c?.color || (name==='仕事'?'#5d9cec':name==='プライベート'?'#63b978':'#9aa4b6'); }

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
    // v16以前の「カテゴリ直下の候補」は、最初のグループへ退避させます。
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
  renderUnavailableList();
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
  $('profileSleepStart').value = String(profile.sleep_start_time || '02:00').slice(0,5);
  $('profileSleepEnd').value = String(profile.sleep_end_time || '09:00').slice(0,5);
  if($('profileWorkEnabled')) $('profileWorkEnabled').checked = !!profile.work_enabled;
  if($('profileWorkStart')) $('profileWorkStart').value = String(profile.work_start_time || '10:00').slice(0,5);
  if($('profileWorkEnd')) $('profileWorkEnd').value = String(profile.work_end_time || '19:00').slice(0,5);
  if($('profileWorkCategory')) $('profileWorkCategory').value = profile.work_category || '仕事';
  const workDays = Array.isArray(profile.work_days) ? profile.work_days.map(Number) : [1,2,3,4,5];
  document.querySelectorAll('.profileWorkDay').forEach(ch=>{ ch.checked = workDays.includes(Number(ch.value)); });
  renderProfilePreview();
}
function renderProfilePreview(){
  const name = $('profileName').value || '自分';
  const emoji = $('profileEmoji').value || '🌙';
  const color = $('profileColor').value || '#5d9cec';
  const sleepStart = $('profileSleepStart')?.value || '02:00';
  const sleepEnd = $('profileSleepEnd')?.value || '09:00';
  const workOn = $('profileWorkEnabled')?.checked;
  const workStart = $('profileWorkStart')?.value || '10:00';
  const workEnd = $('profileWorkEnd')?.value || '19:00';
  const workText = workOn ? ` / 仕事 ${esc(workStart)}〜${esc(workEnd)}` : ' / 仕事時間なし';
  $('profilePreview').innerHTML = `<div class="profileChip" style="--profile-color:${esc(color)}"><span>${esc(emoji)}</span><b>${esc(name)}</b><small>睡眠 ${esc(sleepStart)}〜${esc(sleepEnd)}${workText}</small></div>`;
}

function renderAchievementArchive(memberId = state.user?.id){
  const box = $('achievementArchive');
  if(!box) return;
  const member = state.members.find(m=>m.id===memberId) || state.profile || {};
  const name = member.name || '自分';
  const emoji = member.emoji || '🌙';
  const color = member.color || '#5d9cec';
  const doneTasks = state.tasks
    .filter(t=>t.owner_id===memberId && t.done && !achievementExcluded(t))
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
            <div class="doneTaskPill"><span class="doneMark">✓</span><span class="doneTitle">${esc(t.title || '無題タスク')}</span><small>${esc(t.project || '')}</small>${memberId===state.user?.id ? `<button type="button" class="ghost tiny excludeAchievementBtn" data-exclude-ach="${esc(t.id)}">ログから外す</button>` : ''}</div>
          `).join('')}
          ${arr.length>8 ? `<div class="doneMore">ほか ${arr.length-8}個</div>` : ''}
        </div>
      </section>`).join('')}</div>` : '<div class="empty">完了にしたタスクがここに積み上がります。</div>'}
  `;
  box.querySelectorAll('[data-exclude-ach]').forEach(btn=>btn.addEventListener('click', async()=>{
    const t = state.tasks.find(x=>String(x.id)===String(btn.dataset.excludeAch));
    if(!t) return;
    if(!confirm('このタスクをできたことログの集計から外しますか？\nタスク自体は削除されません。')) return;
    const memo = String(t.memo || '');
    await updateTask(t.id, { memo: memo.includes(ACHIEVEMENT_EXCLUDE) ? memo : `${memo}${memo ? '\n' : ''}${ACHIEVEMENT_EXCLUDE}` });
    await refreshAll();
    renderProfilePage();
  }));
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
        <p>${esc(c.memo||'')}<br>グループ ${c.projects?.length||0} / タスク名称候補 ${projectCandidateCount(c)}</p>
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
            <div><b>${esc(p.name)}</b><span>タスク名称候補 ${p.candidates?.length||0}件</span></div>
            <div class="boxItemActions"><button type="button" class="ghost tiny" data-edit-project="${pi}">グループ名を修正</button><button type="button" class="danger tiny" data-delete-project="${pi}">×</button></div>
          </div>
          <p class="muted">このグループで使うタスク名称候補です。</p>
          <div class="candidateChips bigCandidates">
            ${(p.candidates||[]).length ? p.candidates.map((name,ci)=>`
              <span class="candidateChip editableCandidate">${esc(name)}
                <button type="button" class="chipEdit" data-edit-cand="${pi}:${ci}" title="修正">修正</button>
                <button type="button" class="chipDelete" data-del-cand="${pi}:${ci}" title="削除">×</button>
              </span>
            `).join('') : '<span class="muted">タスク名称候補はまだありません。</span>'}
          </div>
          <div class="minirow candidateAddRow">
            <input data-candidate-input="${pi}" placeholder="このグループに候補を追加">
            <button type="button" class="ghost" data-add-cand-to-project="${pi}">追加</button>
          </div>
        </section>`).join('') : '<div class="empty">グループを追加すると、その中にタスク名称候補を入れられます。</div>'}
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
    <details class="softDetails adminDetails"><summary>棚の追加・削除など</summary><div class="actions"><button id="addCategoryBtn" class="ghost">カテゴリ追加</button><button id="addProjectBtn" class="ghost">グループ追加</button><button id="deleteCategoryBtn" class="danger">カテゴリ削除</button></div></details>`;

  $('saveCatBtn').onclick = async()=>{
    c.name=$('editCatName').value.trim()||c.name; c.color=$('editCatColor').value; c.memo=$('editCatMemo').value;
    c.sharedWith = [...box.querySelectorAll('.shareMemberCheck:checked')].map(input=>input.value); await persist();
  };
  box.querySelectorAll('.shareMemberCheck').forEach(input=>input.addEventListener('change', async()=>{ c.sharedWith=[...box.querySelectorAll('.shareMemberCheck:checked')].map(input=>input.value); await saveTree(state.treeRowId,state.tree); renderCategories(); }));
  $('addCategoryBtn').onclick = async()=>{ const name=prompt('追加するカテゴリ名'); if(!name)return; state.tree.push({name, memo:'', color:'#9aa4b6', projects:[], sharedWith:[]}); state.selectedCategoryIndex=state.tree.length-1; await persist(); };
  $('deleteCategoryBtn').onclick = async()=>{ if(!confirm(`カテゴリ「${c.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return; state.tree.splice(state.selectedCategoryIndex,1); state.selectedCategoryIndex=Math.max(0,state.selectedCategoryIndex-1); await persist(); };
  $('addProjectBtn').onclick = async()=>{ const name=prompt('追加するグループ名'); if(!name)return; c.projects=c.projects||[]; c.projects.push({name:name.trim(), candidates:[]}); await persist(); };
  box.querySelectorAll('[data-edit-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.editProject); const p=c.projects?.[pi]; if(!p)return; const name=prompt('グループ名を修正', p.name); if(!name)return; p.name=name.trim()||p.name; await persist(); });
  box.querySelectorAll('[data-delete-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.deleteProject); const p=c.projects?.[pi]; if(!p)return; if(!confirm(`グループ「${p.name}」を削除しますか？\n登録済みタスク自体は消えません。`))return; c.projects.splice(pi,1); await persist(); });
  box.querySelectorAll('[data-add-cand-to-project]').forEach(btn=>btn.onclick=async()=>{ const pi=Number(btn.dataset.addCandToProject); const p=c.projects?.[pi]; if(!p)return; const input=box.querySelector(`[data-candidate-input="${pi}"]`); const name=input?.value?.trim(); if(!name)return alert('追加するタスク名称候補を入力してください'); p.candidates=uniq([...(p.candidates||[]), name]); input.value=''; await persist(); });
  box.querySelectorAll('[data-edit-cand]').forEach(btn=>btn.onclick=async()=>{ const [pi,ci]=String(btn.dataset.editCand).split(':').map(Number); const p=c.projects?.[pi]; const old=p?.candidates?.[ci]; if(!old)return; const name=prompt('タスク名称候補を修正', old); if(!name)return; p.candidates[ci]=name.trim()||old; p.candidates=uniq(p.candidates); await persist(); });
  box.querySelectorAll('[data-del-cand]').forEach(btn=>btn.onclick=async()=>{ const [pi,ci]=String(btn.dataset.delCand).split(':').map(Number); const p=c.projects?.[pi]; const name=p?.candidates?.[ci]; if(!name)return; if(!confirm(`「${name}」を候補から削除しますか？`)) return; p.candidates.splice(ci,1); await persist(); });
}

function taskDateLabel(t){ return t.schedule_date || t.carryover_date || t.due_date || ''; }
function renderRegisteredTasks(){
  const box = $('registeredTasks'); if(!box) return;
  const mine = editable();
  const arr = state.tasks
    .filter(t=>t.owner_id===state.selectedMemberId && !isUnavailableTask(t))
    .slice()
    .sort((a,b)=>String(a.category||'未分類').localeCompare(String(b.category||'未分類')) || String(taskDateLabel(b)).localeCompare(String(taskDateLabel(a))) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  if(!arr.length){ box.innerHTML = '<div class="empty">登録済みタスクはまだありません。</div>'; return; }

  const byCategory = new Map();
  arr.forEach(t=>{
    const key = t.category || '未分類';
    if(!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(t);
  });

  box.innerHTML = [...byCategory.entries()].map(([category, list])=>{
    const done = list.filter(t=>t.done).length;
    const color = categoryColor(category);
    return `<section class="registeredCategoryGroup" style="--c:${esc(color)}">
      <div class="registeredCategoryHead">
        <h3>${esc(category)}</h3>
        <span>${list.length}件 / 完了 ${done}件</span>
      </div>
      <div class="registeredCompactList">
      ${list.map(t=>`
        <article class="registeredTask compact ${t.done?'done':''} ${achievementExcluded(t)?'achievementExcluded':''}" style="--c:${esc(color)}" data-task-card="${esc(t.id)}">
          <div class="registeredTaskHead compact">
            <label class="taskSelectLine"><input type="checkbox" class="registeredTaskCheck" value="${esc(t.id)}"><span></span></label>
            <div class="registeredTaskMain"><b>${esc(t.title)}</b><div class="muted">${esc(t.project||'未分類')} ・ ${esc(t.start_time || '09:00')} ・ ${Math.round(Number(t.estimated_minutes||30))}分</div></div>
            <div class="taskDateBadge">${esc(taskDateLabel(t) || '日付なし')}</div>
          </div>
          <details class="taskEditDetails compact"><summary>修正</summary>
            <div class="form taskEditForm">
              <label><small>タスク名</small><input data-field="title" value="${esc(t.title||'')}"></label>
              <label><small>カテゴリ</small><input data-field="category" value="${esc(t.category||'')}"></label>
              <label><small>グループ</small><input data-field="project" value="${esc(t.project||'')}"></label>
              <label><small>見積もり時間 分</small><input data-field="estimated_minutes" type="number" min="15" step="15" value="${esc(t.estimated_minutes||30)}"></label>
              <label><small>開始時間</small><input data-field="start_time" type="time" step="900" value="${esc(t.start_time||'09:00')}"></label>
              <label><small>予定日</small><input data-field="schedule_date" type="date" value="${esc(t.schedule_date||'')}"></label>
              <label><small>持ち越し日</small><input data-field="carryover_date" type="date" value="${esc(t.carryover_date||'')}"></label>
              <label><small>期限</small><input data-field="due_date" type="date" value="${esc(t.due_date||'')}"></label>
              <label><small>発生タイプ</small><select data-field="occurrence">
                <option value="single" ${t.occurrence==='single'||!t.occurrence?'selected':''}>単発</option>
                <option value="daily" ${t.occurrence==='daily'?'selected':''}>毎日</option>
                <option value="weekly" ${t.occurrence==='weekly'?'selected':''}>毎週</option>
                <option value="monthly" ${t.occurrence==='monthly'?'selected':''}>毎月</option>
              </select></label>
              <label style="grid-column:1/-1"><small>メモ</small><textarea data-field="memo">${esc(stripAchievementMarker(t.memo))}</textarea></label>
            </div>
            <div class="actions"><button type="button" class="primary" data-save-task="${esc(t.id)}">保存</button><button type="button" class="ghost" data-toggle-done="${esc(t.id)}">${t.done?'未完了に戻す':'完了にする'}</button><button type="button" class="ghost" data-toggle-achievement="${esc(t.id)}">${achievementExcluded(t)?'ログに戻す':'ログに入れない'}</button><button type="button" class="ghost" data-convert-to-unavailable="${esc(t.id)}">稼働不可にする</button><button type="button" class="danger" data-delete-task="${esc(t.id)}">削除</button></div>
          </details>
        </article>`).join('')}
      </div>
    </section>`;
  }).join('');

  box.querySelectorAll('[data-save-task]').forEach(btn=>btn.onclick=async()=>{
    if(!mine) return alert('他メンバーのタスクは編集できません');
    const id=btn.dataset.saveTask; const card=box.querySelector(`[data-task-card="${id}"]`); const val=(name)=>card.querySelector(`[data-field="${name}"]`)?.value || '';
    const schedule=val('schedule_date')||null; const carry=val('carryover_date')||null;
    await updateTask(id,{ title:val('title').trim()||'無題タスク', category:val('category').trim()||'未分類', project:val('project').trim()||'未分類', task_type:'', estimated_minutes:Math.max(15, Math.round(Number(val('estimated_minutes')||30)/15)*15), start_time:val('start_time')||'09:00', schedule_date:schedule, carryover_date:carry, due_date:val('due_date')||null, occurrence:val('occurrence')||'single', memo:(val('memo')||'') + (achievementExcluded(state.tasks.find(x=>String(x.id)===String(id))) ? `\n${ACHIEVEMENT_EXCLUDE}` : ''), status:carry?'carryover':'scheduled' });
    await refreshAll();
  });
  box.querySelectorAll('[data-toggle-done]').forEach(btn=>btn.onclick=async()=>{ if(!mine)return alert('他メンバーのタスクは編集できません'); const id=btn.dataset.toggleDone; const t=state.tasks.find(x=>String(x.id)===String(id)); if(!t)return; await updateTask(id,{ done:!t.done, status:!t.done?'done':'scheduled' }); await refreshAll(); });
  box.querySelectorAll('[data-toggle-achievement]').forEach(btn=>btn.onclick=async()=>{ if(!mine)return alert('他メンバーのタスクは編集できません'); const id=btn.dataset.toggleAchievement; const t=state.tasks.find(x=>String(x.id)===String(id)); if(!t)return; const memo=String(t.memo||''); const next=achievementExcluded(t) ? stripAchievementMarker(memo) : `${memo}${memo ? '\n' : ''}${ACHIEVEMENT_EXCLUDE}`; await updateTask(id,{ memo:next }); await refreshAll(); });

  box.querySelectorAll('[data-convert-to-unavailable]').forEach(btn=>btn.onclick=async()=>{
    if(!mine) return alert('他メンバーのタスクは編集できません');
    const id = btn.dataset.convertToUnavailable;
    const t = state.tasks.find(x=>String(x.id)===String(id));
    if(!t) return;
    if(!confirm(`タスク「${t.title||''}」を稼働不可予定に変更しますか？`)) return;
    const date = t.schedule_date || t.carryover_date || t.due_date || new Date().toISOString().slice(0,10);
    await updateTask(id, { category:'稼働不可', project:'予定', task_type:'', schedule_date:date, carryover_date:null, due_date:date, occurrence:'single', done:false, status:'scheduled', memo:`${t.memo||''}${t.memo?'\n':''}タスクから稼働不可予定へ変更` });
    await refreshAll();
  });
  box.querySelectorAll('[data-delete-task]').forEach(btn=>btn.onclick=async()=>{ if(!mine)return alert('他メンバーのタスクは編集できません'); const id=btn.dataset.deleteTask; const t=state.tasks.find(x=>String(x.id)===String(id)); if(!confirm(`タスク「${t?.title||''}」を削除しますか？`))return; await deleteTask(id); await refreshAll(); });
}

const DAY_MINUTES = 24 * 60;
function isUnavailableTaskLocal(t){ return t?.status === 'unavailable' || t?.category === '稼働不可'; }
function snap15(min){ return Math.max(15, Math.ceil(Number(min || 0) / 15) * 15); }
function snapStart(min){ return Math.max(0, Math.min(DAY_MINUTES-15, Math.round(Number(min||0)/15)*15)); }
function splitInterval(start, duration){
  start = snapStart(start); duration = Number(duration || 0);
  if(duration <= 0 || duration >= DAY_MINUTES) return [{start:0,end:DAY_MINUTES}];
  const end = start + duration;
  if(end <= DAY_MINUTES) return [{start,end}];
  return [{start,end:DAY_MINUTES},{start:0,end:end-DAY_MINUTES}];
}
function sleepIntervalsForMe(){
  const profile = state.profile || {};
  const startText = String(profile.sleep_start_time || '02:00').slice(0,5);
  const endText = String(profile.sleep_end_time || '09:00').slice(0,5);
  const start = minutesFromTime(startText);
  let duration = minutesFromTime(endText) - start;
  if(duration <= 0) duration += DAY_MINUTES;
  return splitInterval(start, duration);
}
function unavailableDuration(t){
  const n = Number(t.estimated_minutes || 0);
  if(n <= 0 || n >= DAY_MINUTES) return DAY_MINUTES;
  return n;
}
function unavailableBlocksForMe(date){
  return state.tasks
    .filter(t=>t.owner_id===state.user?.id && isUnavailableTaskLocal(t) && (t.schedule_date || t.due_date || t.carryover_date) === date)
    .flatMap(t=>splitInterval(minutesFromTime(t.start_time||'00:00'), unavailableDuration(t)));
}
function isAllDayUnavailableForMe(date){
  return state.tasks.some(t=>t.owner_id===state.user?.id && isUnavailableTaskLocal(t) && (t.schedule_date || t.due_date || t.carryover_date) === date && unavailableDuration(t) >= DAY_MINUTES);
}
function intervalsOverlap(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd; }
function taskIntervalsForMe(date){
  return state.tasks
    .filter(t=>t.owner_id===state.user?.id && !t.done && !isUnavailableTaskLocal(t) && (t.schedule_date===date || t.carryover_date===date))
    .map(t=>({ start:minutesFromTime(t.start_time||'09:00'), end:minutesFromTime(t.start_time||'09:00') + snap15(Number(t.estimated_minutes||30)) }));
}
function busyIntervalsForMe(date){ return [...sleepIntervalsForMe(), ...unavailableBlocksForMe(date), ...taskIntervalsForMe(date)].sort((a,b)=>a.start-b.start); }
function fitsAt(date, start, duration){
  const end = start + duration;
  if(start < 0 || end > DAY_MINUTES) return false;
  return !busyIntervalsForMe(date).some(b=>intervalsOverlap(start, end, b.start, b.end));
}
function findAvailableStartForMe(date, duration, preferredText='09:00'){
  duration = snap15(duration);
  const preferred = snapStart(minutesFromTime(preferredText || '09:00'));
  const candidates=[];
  for(let m=preferred; m<=DAY_MINUTES-duration; m+=15) candidates.push(m);
  for(let m=0; m<preferred; m+=15) candidates.push(m);
  return candidates.find(m=>fitsAt(date,m,duration)) ?? preferred;
}
function workingDatesBetween(start, due){
  const totalDays = diffDays(due, start) + 1;
  const dates = [];
  const skipped = [];
  for(let i=0; i<totalDays; i++){
    const date = addDays(start, i);
    if(isAllDayUnavailableForMe(date)) skipped.push(date); else dates.push(date);
  }
  return { dates, skipped, totalDays };
}
function currentNewTaskTitle(){ return $('newTitle').value.trim() || ($('newCandidate').value==='候補から選ぶ'?'':$('newCandidate').value); }
function getReversePlan(){
  const title = currentNewTaskTitle();
  const total = snap15(Number($('newMinutes').value || 0));
  const start = $('newStart').value || new Date().toISOString().slice(0,10);
  const due = $('newDue').value;
  if(!title) return { ok:false, message:'タスク名を入れると逆算できます。' };
  if(!total) return { ok:false, message:'見積もり時間を入れると逆算できます。例：合計360分' };
  if(!due) return { ok:false, message:'期限を入れると逆算できます。' };
  const { dates, skipped, totalDays } = workingDatesBetween(start, due);
  if(totalDays <= 0) return { ok:false, message:'期限は開始日以降にしてください。' };
  if(!dates.length) return { ok:false, message:'開始日〜期限の間がすべて稼働不可日です。カレンダーで稼働できる日を1日以上残してください。' };
  const days = dates.length;
  const daily = snap15(total / days);
  const actualTotal = daily * days;
  const skipText = skipped.length ? `（稼働不可 ${skipped.length}日を避けます）` : '';
  return { ok:true, title, total, start, due, days, daily, actualTotal, dates, skipped, totalDays,
    message:`${fmtDate(start)}〜${fmtDate(due)}を1本のガンチャ予定として作ります。タイムラインでは稼働できる日に1日 ${daily}分（約${Math.round(daily/60*10)/10}時間）ずつ自動配置できます。${skipText}` };
}
function renderReversePreview(){
  const el = $('reversePlanPreview');
  if(!el) return;
  const plan = getReversePlan();
  el.textContent = plan.message;
  el.classList.toggle('warnText', !plan.ok);
}
async function addReversePlanTasks(){
  if(!editable()) return alert('他メンバーの棚卸しは編集できません');
  const plan = getReversePlan();
  if(!plan.ok) return alert(plan.message);
  const memoBase = $('newMemo').value || '';
  const preferredStart = $('newStartTime')?.value || '09:00';
  await createTask({
    team_id:state.team.id,
    owner_id:state.user.id,
    created_by:state.user.id,
    title:plan.title,
    category:$('newCategory').value,
    project:$('newProject').value,
    task_type:'gantt_span',
    estimated_minutes:plan.daily,
    start_time:preferredStart,
    schedule_date:plan.start,
    due_date:plan.due,
    occurrence:'single',
    status:'scheduled',
    memo:`${memoBase}${memoBase ? '\n' : ''}#gantt-span\n納期から逆算：総見積もり${plan.total}分 / 稼働${plan.days}日（期間${plan.totalDays}日・稼働不可${plan.skipped.length}日を除外） / 1日${plan.daily}分`,
    sort_order:Date.now()*-1
  });
  $('newTitle').value=''; $('newMinutes').value=''; $('newMemo').value='';
  alert('ガンチャ予定を1件追加しました。今日以降のガンチャに表示され、対象期間の各日でタイムラインへ自動配置できます。');
  await refreshAll();
}


export function initSetupEvents(){
  $('backToBoardBtn')?.addEventListener('click', ()=>showView('board'));
  $('saveProfileBtn').addEventListener('click', async()=>{
    try{
      const updated = await updateMyProfile({ display_name:$('profileName').value, display_emoji:$('profileEmoji').value, display_color:$('profileColor').value, sleep_start_time:$('profileSleepStart').value || '02:00', sleep_end_time:$('profileSleepEnd').value || '09:00', work_enabled: $('profileWorkEnabled')?.checked || false, work_start_time:$('profileWorkStart')?.value || '10:00', work_end_time:$('profileWorkEnd')?.value || '19:00', work_category:$('profileWorkCategory')?.value || '仕事', work_days:[...document.querySelectorAll('.profileWorkDay:checked')].map(ch=>Number(ch.value)) });
      state.profile = updated; state.members = await loadMembers(state.team.id); $('loginPill').textContent = `${updated.display_emoji || '🌙'} ${updated.display_name || '自分'}`; alert('自分設定を保存しました'); renderProfilePage(); refreshAll();
    }catch(e){ alert(e.message || '自分設定の保存に失敗しました'); }
  });
  ['profileName','profileEmoji','profileColor','profileSleepStart','profileSleepEnd','profileWorkStart','profileWorkEnd','profileWorkCategory'].forEach(id=>$(id)?.addEventListener('input', renderProfilePreview));
  $('profileWorkEnabled')?.addEventListener('change', renderProfilePreview);
  document.querySelectorAll('.profileWorkDay').forEach(ch=>ch.addEventListener('change', renderProfilePreview));
  ['newCategory','newProject'].forEach(id=>$(id).addEventListener('change',renderSelectors));
  $('newCandidate').addEventListener('change',()=>{ if($('newCandidate').value !== '候補から選ぶ') $('newTitle').value = $('newCandidate').value; renderReversePreview(); });
  ['newTitle','newMinutes','newStart','newDue','newStartTime','newMemo'].forEach(id=>$(id)?.addEventListener('input', renderReversePreview));
  $('calcReversePlanBtn')?.addEventListener('click', renderReversePreview);
  $('addReversePlanBtn')?.addEventListener('click', addReversePlanTasks);
  $('selectAllRegisteredTasks')?.addEventListener('click',()=>document.querySelectorAll('#registeredTasks .registeredTaskCheck').forEach(ch=>ch.checked=true));
  $('clearRegisteredTaskSelection')?.addEventListener('click',()=>document.querySelectorAll('#registeredTasks .registeredTaskCheck').forEach(ch=>ch.checked=false));
  $('deleteSelectedTasks')?.addEventListener('click',async()=>{
    if(!editable()) return alert('他メンバーのタスクは編集できません');
    const ids=[...document.querySelectorAll('#registeredTasks .registeredTaskCheck:checked')].map(ch=>ch.value);
    if(!ids.length) return alert('削除するタスクを選んでください');
    if(!confirm(`${ids.length}件のタスクを削除しますか？`)) return;
    for(const id of ids) await deleteTask(id);
    await refreshAll();
  });
  $('addMonthlyTaskBtn').addEventListener('click', async()=>{
    if(!editable()) return alert('他メンバーの棚卸しは編集できません');
    const title = $('newTitle').value.trim() || ($('newCandidate').value==='候補から選ぶ'?'':$('newCandidate').value);
    if(!title) return alert('タスク名を入れてください');
    const occurrence = document.querySelector('input[name="occurrence"]:checked')?.value || 'single';
    const start = $('newStart').value || new Date().toISOString().slice(0,10);
    const minutes = snap15(Number($('newMinutes').value||30));
    const startTime = fullClock(findAvailableStartForMe(start, minutes, $('newStartTime')?.value||'09:00'));
    const due = $('newDue').value || null;
    const isSpan = occurrence === 'single' && due && diffDays(due, start) > 0;
    const memo = $('newMemo').value || '';
    await createTask({ team_id:state.team.id, owner_id:state.user.id, created_by:state.user.id, title, category:$('newCategory').value, project:$('newProject').value, task_type:isSpan?'gantt_span':'', estimated_minutes:minutes, start_time:startTime, schedule_date:start, due_date:due, occurrence, status:'scheduled', memo:isSpan && !memo.includes('#gantt-span') ? `${memo}${memo?'\n':''}#gantt-span` : memo, sort_order:Date.now()*-1 });
    $('newTitle').value=''; $('newMinutes').value=''; $('newMemo').value=''; await refreshAll();
  });
}
