function render(){
  // One board column per lifecycle state (LIFECYCLE key order = column order).
  document.getElementById('board').innerHTML = Object.keys(LIFECYCLE).map(lc => {
    const list = state.tasks.filter(p => lifecycleOf(p) === lc);
    return `<div class="col" ondragover="dragOver(event)" ondrop="dropOn(event,'lc','${lc}')">
      <div class="col-head"><span class="dot ${LIFECYCLE[lc]}"></span><span class="col-title">${t(LC_LABEL[lc])}</span><span class="col-count">${list.length ? `(${list.length})` : ''}</span></div>
      <p class="col-desc">${t(LC_LABEL[lc] + 'Desc')}</p>
      ${list.length ? list.map(cardHtml).join('') : `<div class="empty">${t('emptyNone')}</div>`}
    </div>`;
  }).join('');
  renderTasks(); renderPipeline();
  document.getElementById('lastCheckin').textContent = state.lastCheckin
    ? `${t('lastCheckinPrefix')}${fmtDate(state.lastCheckin)}` : t('neverCheckedIn');
}

// Project lifecycle: `column` stays the source of truth (other views and old builds read it);
// `phase` only refines it, and is ignored once it no longer matches the column.
const LIFECYCLE = { exploring:'active', active:'active', maintaining:'watch', on_hold:'watch', archived:'archived' };
const LC_LABEL = { exploring:'lcExploring', active:'lcActive', on_hold:'lcOnHold', maintaining:'lcMaintaining', archived:'lcArchived' };
function lifecycleOf(p){
  if(p.phase && LIFECYCLE[p.phase] === p.column) return p.phase;
  return { active:'active', watch:'on_hold', archived:'archived' }[p.column];
}
async function setLifecycle(id, lc){
  const p = state.tasks.find(x => x.id === id);
  if(!p || !LIFECYCLE[lc]) return;
  p.column = LIFECYCLE[lc];
  if(lc === 'exploring' || lc === 'maintaining') p.phase = lc; else delete p.phase;
  p.updatedAt = Date.now();
  if(!await saveState()) return; render(); renderDaily(); renderDashboard(); showToast(t('toastUpdated'));
}

const TASK_STATUS = ['inbox','backlog','ready','doing','waiting','done'];
const TS_LABEL = { inbox:'tsInbox', backlog:'tsBacklog', ready:'tsReady', doing:'tsDoing', waiting:'tsWaiting', done:'tsDone' };
const openProjects = new Set(); // keeps a project's task list expanded across re-renders
function taskRowHtml(it){
  return `<div class="task-row ${it.status}">
      <select class="stage-select" onchange="setTaskStatus('${it.id}',this.value)">${TASK_STATUS.map(s => `<option value="${s}" ${s===it.status?'selected':''}>${t(TS_LABEL[s])}</option>`).join('')}</select>
      <span>${escapeHtml(it.title)}</span>
      <button class="chip" onclick="deleteItem('${it.id}')" aria-label="${t('chipDelete')}">×</button>
    </div>`;
}
function tasksHtml(p){
  const items = state.items.filter(x => x.projectId === p.id)
    .sort((a,b) => TASK_STATUS.indexOf(a.status) - TASK_STATUS.indexOf(b.status));
  const open = items.filter(x => x.status !== 'done').length;
  const rows = items.map(taskRowHtml).join('');
  return `<details class="card-tasks" ${openProjects.has(p.id)?'open':''} ontoggle="this.open ? openProjects.add('${p.id}') : openProjects.delete('${p.id}')">
      <summary>${t('tasksSummary')} (${open}/${items.length})</summary>
      ${rows}
      <form class="task-add" onsubmit="addItem(event,'${p.id}')">
        <input name="title" placeholder="${t('placeholderNewTask')}" aria-label="${t('placeholderNewTask')}">
        <button class="chip">${t('btnAdd')}</button>
      </form>
    </details>`;
}
async function addItem(e, projectId, applicationId){
  e.preventDefault();
  const title = e.target.elements.title.value.trim(); // form.title is the attribute, not the input
  projectId = projectId || e.target.elements.project.value; // tasks tab picks the project in the form
  if(!title || !state.tasks.some(p => p.id === projectId)) return;
  const item = { id: uid(), projectId, title, status: 'inbox', updatedAt: Date.now() };
  if(applicationId) item.applicationId = applicationId; // Application lives in the pipeline doc; the link is kept on the task
  state.items.push(item);
  e.target.elements.title.value = '';
  openProjects.add(projectId);
  if(!await saveState()) return; render(); showToast(t('toastAdded'));
}
let taskFilter = '';
function taskTotalHours(taskId){ return Object.values(dailyLog.entries).reduce((sum, e) => sum + taskHoursOf(e, taskId), 0); }
function taskLogHtml(it){
  const p = state.tasks.find(x => x.id === it.projectId);
  const today = taskHoursOf(getEntryIfAny(todayStr(0)), it.id), total = taskTotalHours(it.id);
  const btns = p && canLogProject(p) ? `<button class="chip btn-sm" onclick="logHours('${p.id}','${it.id}',0.5,todayStr(0))">+0.5h</button>
      <button class="chip btn-sm" onclick="logHours('${p.id}','${it.id}',1,todayStr(0))">+1h</button>` : '';
  return `<div class="card-actions" style="margin-bottom:6px;">${btns}<span class="sub" style="font-size:11.5px;">${t('todayShort')} ${today}h · ${t('totalShort')} ${total}h</span></div>`;
}
function goTasks(projectId){
  taskFilter = projectId; switchTab('tasks'); renderTasks();
  document.getElementById('taskAddTitle').focus();
}
function renderTasks(){
  const live = state.tasks.filter(p => p.column !== 'archived');
  const opt = (p, sel) => `<option value="${p.id}" ${p.id===sel?'selected':''}>${escapeHtml(p.title)}${p.column==='archived' ? t('tagArchived') : ''}</option>`;
  if(taskFilter && !state.tasks.some(p => p.id === taskFilter)) taskFilter = '';
  document.getElementById('taskFilter').innerHTML = `<option value="">${t('allProjects')}</option>` + state.tasks.map(p => opt(p, taskFilter)).join('');
  const addSel = document.getElementById('taskAddProject');
  addSel.innerHTML = live.map(p => opt(p, taskFilter || addSel.value)).join('');
  document.getElementById('taskAddTitle').placeholder = t('placeholderNewTask');
  document.getElementById('taskAddBtn').textContent = t('btnAdd');
  const items = state.items.filter(x => !taskFilter || x.projectId === taskFilter);
  const title = id => (state.tasks.find(p => p.id === id) || {}).title || '';
  document.getElementById('taskBoard').innerHTML = TASK_STATUS.map(st => {
    const list = items.filter(x => x.status === st);
    return `<div class="col" ondragover="dragOver(event)" ondrop="dropOn(event,'ts','${st}')">
      <div class="col-head"><span class="col-title">${t(TS_LABEL[st])}</span><span class="col-count">${list.length ? `(${list.length})` : ''}</span></div>
      ${list.length ? list.map(it => it.id === editingItemId ? taskEditHtml(it) : `<div class="card ts-${st}">
          <p class="card-title" draggable="true" ondragstart="dragStart(event,'ts','${it.id}')" ondragend="dragging=null">${escapeHtml(it.title)}</p>
          <p class="task-project">${escapeHtml(title(it.projectId))}${appName(it.applicationId) ? ` · ${escapeHtml(appName(it.applicationId))}` : ''}</p>
          ${it.note ? `<p class="card-notes">${escapeHtml(it.note)}</p>` : ''}
          ${taskLogHtml(it)}
          <div class="card-actions">
            <select class="stage-select" onchange="setTaskStatus('${it.id}',this.value)">${TASK_STATUS.map(s => `<option value="${s}" ${s===it.status?'selected':''}>${t(TS_LABEL[s])}</option>`).join('')}</select>
            <button class="chip" onclick="editingItemId='${it.id}'; renderTasks()">${t('chipEdit')}</button>
            <button class="chip" onclick="deleteItem('${it.id}')">${t('chipDelete')}</button>
          </div>
        </div>`).join('') : `<div class="empty">${t('emptyNone')}</div>`}
    </div>`;
  }).join('');
}
async function setTaskStatus(id, status){
  const it = state.items.find(x => x.id === id);
  if(!it || !TASK_STATUS.includes(status)) return;
  it.status = status; it.updatedAt = Date.now();
  if(!await saveState()) return; render(); showToast(t('toastUpdated'));
}
async function deleteItem(id){
  const it = state.items.find(x => x.id === id);
  if(!it || !confirm(t('confirmDelete').replace('{name}', it.title))) return;
  state.items = state.items.filter(x => x.id !== id);
  if(!await saveState()) return;
  render(); showToast(t('toastDeleted'));
}

let editingItemId = null;
function taskEditHtml(it){
  // Hours are booked per project in the daily log; moving a task with hours would split its history across projects.
  const locked = taskTotalHours(it.id) > 0;
  const projects = state.tasks.filter(p => p.column !== 'archived' || p.id === it.projectId);
  return `<form class="card task-edit" onsubmit="saveItemEdit(event,'${it.id}')">
      <input name="title" value="${escapeHtml(it.title)}" aria-label="${t('placeholderNewTask')}">
      <select class="stage-select" name="project" aria-label="Project" ${locked ? 'disabled' : ''}>${projects.map(p => `<option value="${p.id}" ${p.id===it.projectId?'selected':''}>${escapeHtml(p.title)}</option>`).join('')}</select>
      ${locked ? `<p class="sub" style="font-size:11.5px; margin:0;">${t('taskMoveHasHours')}</p>` : ''}
      <select class="stage-select" name="application" aria-label="Application"><option value="">${t('taskNoApp')}</option>${pipeline.companies.map(a => `<option value="${a.id}" ${a.id===it.applicationId?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}</select>
      <input name="note" value="${escapeHtml(it.note || '')}" placeholder="${t('placeholderTaskNote')}" aria-label="${t('placeholderTaskNote')}">
      <div class="card-actions"><button class="chip">${t('btnSave')}</button><button type="button" class="chip" onclick="editingItemId=null; renderTasks()">${t('btnCancel')}</button></div>
    </form>`;
}
async function saveItemEdit(e, id){
  e.preventDefault();
  const it = state.items.find(x => x.id === id), f = e.target.elements;
  const title = f.title.value.trim(), note = f.note.value.trim();
  if(!it || !title) return;
  it.title = title;
  if(taskTotalHours(id) === 0 && state.tasks.some(p => p.id === f.project.value)) it.projectId = f.project.value;
  if(f.application.value) it.applicationId = f.application.value; else delete it.applicationId;
  if(note) it.note = note; else delete it.note;
  if(it.status !== 'done') it.updatedAt = Date.now(); // a done task's updatedAt = when it finished (Done this week reads it)
  editingItemId = null;
  if(!await saveState()) return;
  render(); renderDaily(); showToast(t('toastSaved'));
}

// Drag a card by its title onto another column. Native HTML5 drag: no touch support, the dropdowns stay for phones.
let dragging = null;
function dragStart(e, kind, id){ dragging = { kind, id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }
function dragOver(e){ if(dragging) e.preventDefault(); }
function dropOn(e, kind, value){
  e.preventDefault();
  const d = dragging; dragging = null;
  if(!d || d.kind !== kind) return;
  if(kind === 'lc'){
    const p = state.tasks.find(x => x.id === d.id);
    if(p && lifecycleOf(p) !== value) setLifecycle(d.id, value);
  } else {
    const it = state.items.find(x => x.id === d.id);
    if(it && it.status !== value) setTaskStatus(d.id, value);
  }
}

function cardHtml(task){
  const actions = [];
  const lc = lifecycleOf(task);
  actions.push(`<select class="stage-select" onchange="setLifecycle('${task.id}',this.value)">${Object.keys(LIFECYCLE).map(k => `<option value="${k}" ${k===lc?'selected':''}>${t(LC_LABEL[k])}</option>`).join('')}</select>`);
  actions.push(`<button class="chip" onclick="editTask('${task.id}')">${t('chipEdit')}</button>`);
  actions.push(`<button class="chip" onclick="deleteTask('${task.id}')">${t('chipDelete')}</button>`);
  return `<div class="card ${task.column}">
      <p class="card-title" draggable="true" ondragstart="dragStart(event,'lc','${task.id}')" ondragend="dragging=null">${escapeHtml(task.title)}</p>
      ${task.notes ? `<p class="card-notes">${escapeHtml(task.notes)}</p>` : ''}
      <p class="card-meta">${t('metaUpdatedPrefix')}${fmtDate(task.updatedAt)}</p>
      ${tasksHtml(task)}
      <div class="card-actions">${actions.join('')}</div>
    </div>`;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function deleteTask(id){
  const p = state.tasks.find(x => x.id === id);
  const n = state.items.filter(x => x.projectId === id).length;
  if(!p || !confirm(t(n ? 'confirmDeleteProject' : 'confirmDelete').replace('{name}', p.title).replace('{n}', n))) return;
  state.tasks = state.tasks.filter(x => x.id !== id);
  state.items = state.items.filter(x => x.projectId !== id);
  if(!await saveState()) return;
  render(); renderDaily(); showToast(t('toastDeleted'));
}
let editingTaskId = null;
function toggleAddForm(){
  const el = document.getElementById('addForm');
  if(el.classList.contains('show')){
    el.classList.remove('show'); editingTaskId = null;
  } else {
    editingTaskId = null;
    document.getElementById('newTitle').value = ''; document.getElementById('newNotes').value = '';
    document.getElementById('addFormTitle').textContent = t('formTitleAdd');
    el.classList.add('show');
  }
}
function editTask(id){
  const task = state.tasks.find(x => x.id === id);
  if(!task) return;
  editingTaskId = id;
  document.getElementById('newTitle').value = task.title;
  document.getElementById('newNotes').value = task.notes || '';
  document.getElementById('addFormTitle').textContent = t('formTitleEdit');
  document.getElementById('addForm').classList.add('show');
  document.getElementById('addForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function addTask(){
  const title = document.getElementById('newTitle').value.trim();
  const notes = document.getElementById('newNotes').value.trim();
  if(!title){ showToast(t('toastNeedThreadName')); return; }
  if(editingTaskId){
    const task = state.tasks.find(x => x.id === editingTaskId);
    if(task){ task.title = title; task.notes = notes; task.updatedAt = Date.now(); }
    editingTaskId = null;
  } else {
    state.tasks.push({ id: uid(), title, notes, column: 'active', updatedAt: Date.now() });
  }
  document.getElementById('newTitle').value = ''; document.getElementById('newNotes').value = '';
  document.getElementById('addForm').classList.remove('show');
  if(!await saveState()) return;
  render(); renderDaily(); showToast(t('toastSaved'));
}

function checkinProgressText(i, n){
  return LANG === 'zh' ? `第 ${i} / ${n} 条` : `Item ${i} of ${n}`;
}

function startCheckin(){
  checkinQueue = state.tasks.filter(task => task.column !== 'archived');
  checkinIndex = 0;
  if(checkinQueue.length === 0){ showToast(t('toastNoThreadsToCheck')); return; }
  document.getElementById('overlay').classList.add('show');
  showCheckinCard();
}
function showCheckinCard(){
  const task = checkinQueue[checkinIndex];
  document.getElementById('ciProgress').textContent = checkinProgressText(checkinIndex+1, checkinQueue.length);
  document.getElementById('ciTitle').textContent = task.title;
  document.getElementById('ciNotes').textContent = task.notes || '';
  document.getElementById('ciNote').value = '';
}
async function ciAction(col){
  const task = checkinQueue[checkinIndex];
  const note = document.getElementById('ciNote').value.trim();
  const target = state.tasks.find(x => x.id === task.id);
  if(target){
    target.column = col; target.updatedAt = Date.now();
    if(note){ target.notes = (target.notes ? target.notes + '\n' : '') + note; }
  }
  await saveState(); advanceCheckin();
}
function ciSkip(){ advanceCheckin(); }
async function advanceCheckin(){
  checkinIndex++;
  if(checkinIndex >= checkinQueue.length){
    document.getElementById('overlay').classList.remove('show');
    state.lastCheckin = Date.now(); await saveState(); render();
    showToast(t('toastCheckinDone')); return;
  }
  render(); showCheckinCard();
}

let toastTimer;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
