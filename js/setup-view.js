import { $, esc } from './utils.js';
import { state } from './state.js';
import { saveTree } from './setup.js';
import { updateMyProfile, loadMembers } from './auth.js';
import { createTask } from './tasks.js';
import { refreshAll } from './app.js';

function editable(){ return state.selectedMemberId === state.user.id; }
function cat(){ return state.tree[state.selectedCategoryIndex] || state.tree[0]; }
function proj(){ const c=cat(); return c?.projects?.find(p=>p.name===$('newProject').value) || c?.projects?.[0]; }
function typ(){ const p=proj(); return p?.types?.find(t=>t.name===$('newType').value) || p?.types?.[0]; }
function fill(sel, arr, cur){ sel.innerHTML=(arr||[]).map(v=>`<option ${v===cur?'selected':''}>${esc(v)}</option>`).join(''); }
export function renderSetup(){
  $('setupNotice').textContent = editable() ? '自分の棚卸しです。編集できます。' : '他メンバーの棚卸しは閲覧中心です。';
  renderProfileSettings();
  renderCategories(); renderSelectors(); renderCategoryEditor();
  document.querySelectorAll('#setup input,#setup select,#setup textarea,#setup button').forEach(el=>{ if(!el.closest('.tabs')) el.disabled = !editable(); });
}

function renderProfileSettings(){
  const panel = $('profileSettingsPanel');
  if(!panel) return;
  const isMine = state.selectedMemberId === state.user.id;
  panel.classList.toggle('hidden', !isMine);
  if(!isMine) return;
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

function renderCategories(){
  const grid=$('categoryGrid'); grid.innerHTML='';
  state.tree.forEach((c,i)=>{
    const card=document.createElement('article'); card.className='cat'; card.style.setProperty('--c', c.color || '#9aa4b6');
    card.innerHTML=`<h3>${esc(c.name)}</h3><p>${esc(c.memo||'')}<br>プロジェクト ${c.projects?.length||0}</p>`;
    card.addEventListener('click',()=>{ state.selectedCategoryIndex=i; renderSetup(); });
    grid.appendChild(card);
  });
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
      <div class="treeTypeList">
        ${(p.types||[]).map((ty,ti)=>`
          <div class="treeType">
            <div class="treeTypeHead">
              <span>タスク種類</span>
              <b>${esc(ty.name)}</b>
            </div>
            <div class="candidateChips">
              ${(ty.tasks||[]).length ? (ty.tasks||[]).map((name,ci)=>`
                <span class="candidateChip">${esc(name)}<button type="button" class="chipDelete" data-del-cand="${pi}:${ti}:${ci}" title="削除">×</button></span>
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
  if(!c){ box.innerHTML='<div class="empty">カテゴリがありません。</div>'; return; }
  box.innerHTML = `
    <div class="editorgrid">
      <label><small>カテゴリ名</small><input id="editCatName" value="${esc(c.name)}"></label>
      <label><small>色</small><input id="editCatColor" type="color" value="${esc(c.color||'#9aa4b6')}"></label>
      <label style="grid-column:1/-1"><small>メモ</small><input id="editCatMemo" value="${esc(c.memo||'')}"></label>
    </div>
    <div class="actions"><button id="saveCatBtn" class="primary">カテゴリを保存</button><button id="addProjectBtn" class="ghost">プロジェクト追加</button><button id="addTypeBtn" class="ghost">タスク種類追加</button><button id="addCandidateBtn" class="ghost">タスク名候補追加</button></div>
    <div class="sectionline"><b>登録されている棚</b>${renderProjectTree(c)}</div>`;
  $('saveCatBtn').onclick = async()=>{ c.name=$('editCatName').value.trim()||c.name; c.color=$('editCatColor').value; c.memo=$('editCatMemo').value; await persist(); };
  $('addProjectBtn').onclick = async()=>{ const name=prompt('追加するプロジェクト名'); if(!name)return; c.projects=c.projects||[]; c.projects.push({name, types:[{name:'未分類',tasks:[]}]}); await persist(); };
  $('addTypeBtn').onclick = async()=>{ const pName=prompt('どのプロジェクトに追加しますか？', c.projects?.[0]?.name||''); const p=c.projects?.find(x=>x.name===pName); if(!p)return alert('プロジェクトが見つかりません'); const name=prompt('追加するタスク種類'); if(!name)return; p.types=p.types||[]; p.types.push({name,tasks:[]}); await persist(); };
  $('addCandidateBtn').onclick = async()=>{ const pName=prompt('プロジェクト名', c.projects?.[0]?.name||''); const p=c.projects?.find(x=>x.name===pName); if(!p)return alert('プロジェクトが見つかりません'); const tName=prompt('タスク種類', p.types?.[0]?.name||''); const ty=p.types?.find(x=>x.name===tName); if(!ty)return alert('タスク種類が見つかりません'); const name=prompt('追加するタスク名候補'); if(!name)return; ty.tasks=ty.tasks||[]; ty.tasks.push(name); await persist(); };
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
export function initSetupEvents(){
  $('saveProfileBtn').addEventListener('click', async()=>{
    try{
      const updated = await updateMyProfile({
        display_name: $('profileName').value,
        display_emoji: $('profileEmoji').value,
        display_color: $('profileColor').value
      });
      state.profile = updated;
      state.members = await loadMembers(state.team.id);
      alert('自分設定を保存しました');
      renderSetup();
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
