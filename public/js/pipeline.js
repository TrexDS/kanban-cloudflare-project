/* ---- Pipeline ---- */
let editingPipeline = null; // { kind, id } while the company/contact form edits an existing entry
function toggleForm(id){
  const el = document.getElementById(id), f = id === 'companyForm' ? 'co' : 'ct';
  editingPipeline = null;
  if(!el.classList.contains('show')){ document.getElementById(f+'Name').value = ''; document.getElementById(f+'Notes').value = ''; }
  el.classList.toggle('show');
}
function editPipelineItem(kind, id){
  const item = (kind === 'company' ? pipeline.companies : pipeline.contacts).find(x => x.id === id);
  if(!item) return;
  const f = kind === 'company' ? 'co' : 'ct', form = document.getElementById(kind + 'Form');
  editingPipeline = { kind, id };
  document.getElementById(f+'Name').value = item.name;
  document.getElementById(f+'Stage').value = item.stage;
  document.getElementById(f+'Notes').value = item.notes || '';
  form.classList.add('show');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// Add a new entry, or update the one being edited.
function upsertPipeline(kind, list, name, stage, notes){
  const item = editingPipeline && editingPipeline.kind === kind && list.find(x => x.id === editingPipeline.id);
  if(item) Object.assign(item, { name, stage, notes, updatedAt: Date.now() });
  else list.push({ id: uid(), name, stage, notes, updatedAt: Date.now() });
  return item ? 'toastSaved' : 'toastAdded';
}
function stageLabel(s){ return t('stage' + s.charAt(0).toUpperCase() + s.slice(1)); }
const stageClass = {
  applied:'stage-applied', screen:'stage-screen', interview:'stage-interview', final:'stage-final',
  offer:'stage-offer', rejected:'stage-rejected', contacted:'stage-contacted', replied:'stage-replied',
  meeting:'stage-meeting', noresponse:'stage-noresponse'
};
const companyStageOptions = ['applied','screen','interview','final','offer','rejected'];
const contactStageOptions = ['contacted','replied','meeting','noresponse'];

async function addCompany(){
  const name = document.getElementById('coName').value.trim();
  const stage = document.getElementById('coStage').value;
  const notes = document.getElementById('coNotes').value.trim();
  if(!name){ showToast(t('toastNeedCompanyName')); return; }
  const msg = upsertPipeline('company', pipeline.companies, name, stage, notes);
  document.getElementById('coName').value=''; document.getElementById('coNotes').value='';
  toggleForm('companyForm');
  if(!await savePipeline()) return;
  renderPipeline(); renderDashboard(); showToast(t(msg));
}
async function addContact(){
  const name = document.getElementById('ctName').value.trim();
  const stage = document.getElementById('ctStage').value;
  const notes = document.getElementById('ctNotes').value.trim();
  if(!name){ showToast(t('toastNeedContactInfo')); return; }
  const msg = upsertPipeline('contact', pipeline.contacts, name, stage, notes);
  document.getElementById('ctName').value=''; document.getElementById('ctNotes').value='';
  toggleForm('contactForm');
  if(!await savePipeline()) return;
  renderPipeline(); showToast(t(msg));
}
async function updateStage(kind, id, newStage){
  const list = kind === 'company' ? pipeline.companies : pipeline.contacts;
  const item = list.find(x => x.id === id);
  if(item){ item.stage = newStage; item.updatedAt = Date.now(); if(!await savePipeline()) return; renderPipeline(); renderDashboard(); showToast(t('toastUpdated')); }
}
async function deletePipelineItem(kind, id){
  const item = (kind === 'company' ? pipeline.companies : pipeline.contacts).find(x => x.id === id);
  if(!item || !confirm(t('confirmDelete').replace('{name}', item.name))) return;
  if(kind === 'company'){ pipeline.companies = pipeline.companies.filter(x => x.id !== id); }
  else { pipeline.contacts = pipeline.contacts.filter(x => x.id !== id); }
  if(!await savePipeline()) return;
  renderPipeline(); renderDashboard(); showToast(t('toastDeleted'));
}
function pipelineCardHtml(item, kind, options){
  const opts = options.map(s => `<option value="${s}" ${s===item.stage?'selected':''}>${stageLabel(s)}</option>`).join('');
  return `<div class="card active">
    <span class="stage-badge ${stageClass[item.stage]}">${stageLabel(item.stage)}</span>
    <p class="card-title">${escapeHtml(item.name)}</p>
    ${item.notes ? `<p class="card-notes">${escapeHtml(item.notes)}</p>` : ''}
    <p class="card-meta">${t('metaUpdatedPrefix')}${fmtDate(item.updatedAt)}</p>
    ${kind === 'company' ? appTasksHtml(item) : ''}
    <div class="card-actions">
      <select class="stage-select" onchange="updateStage('${kind}','${item.id}',this.value)">${opts}</select>
      <button class="chip" onclick="editPipelineItem('${kind}','${item.id}')">${t('chipEdit')}</button>
      <button class="chip" onclick="deletePipelineItem('${kind}','${item.id}')">${t('chipDelete')}</button>
    </div>
  </div>`;
}
function appName(id){ return id ? (pipeline.companies.find(a => a.id === id) || {}).name || '' : ''; }
const openApps = new Set();
// An Application (pipeline.companies entry) links to one Project and many Tasks (task.applicationId).
function appTasksHtml(app){
  const proj = state.tasks.find(p => p.id === app.projectId);
  const items = state.items.filter(x => x.applicationId === app.id)
    .sort((a,b) => TASK_STATUS.indexOf(a.status) - TASK_STATUS.indexOf(b.status));
  const open = items.filter(x => x.status !== 'done').length;
  const projSel = `<select class="stage-select" onchange="setAppProject('${app.id}',this.value)" aria-label="Project">
      <option value="">${t('appNoProject')}</option>
      ${state.tasks.filter(p => p.column !== 'archived' || p.id === app.projectId).map(p => `<option value="${p.id}" ${p.id===app.projectId?'selected':''}>${escapeHtml(p.title)}</option>`).join('')}
    </select>`;
  return `<details class="card-tasks" ${openApps.has(app.id)?'open':''} ontoggle="this.open ? openApps.add('${app.id}') : openApps.delete('${app.id}')">
      <summary>${t('tasksSummary')} (${open}/${items.length})${proj ? ` · ${escapeHtml(proj.title)}` : ''}</summary>
      <div class="card-actions" style="margin:6px 0;">${projSel}</div>
      ${items.map(taskRowHtml).join('')}
      ${proj ? `<form class="task-add" onsubmit="addItem(event,'${proj.id}','${app.id}')">
        <input name="title" placeholder="${t('placeholderNewTask')}" aria-label="${t('placeholderNewTask')}">
        <button class="chip">${t('btnAdd')}</button>
      </form>` : `<p class="sub" style="font-size:12px;">${t('appPickProject')}</p>`}
    </details>`;
}
async function setAppProject(id, projectId){
  const app = pipeline.companies.find(a => a.id === id);
  if(!app) return;
  app.projectId = projectId || undefined; app.updatedAt = Date.now();
  openApps.add(id);
  if(!await savePipeline()) return;
  renderPipeline(); showToast(t('toastUpdated'));
}
function renderPipeline(){
  renderFunnel();
  const coList = document.getElementById('list-companies');
  coList.innerHTML = pipeline.companies.length
    ? pipeline.companies.map(c => pipelineCardHtml(c,'company',companyStageOptions)).join('')
    : `<div class="empty">${t('emptyNone')}</div>`;
  const ctList = document.getElementById('list-contacts');
  ctList.innerHTML = pipeline.contacts.length
    ? pipeline.contacts.map(c => pipelineCardHtml(c,'contact',contactStageOptions)).join('')
    : `<div class="empty">${t('emptyNone')}</div>`;
}

// Job funnel lives on the pipeline page (it's only about job hunting).
function renderFunnel(){
  const stages = ['applied','screen','interview','final','offer','rejected'];
  const counts = {};
  stages.forEach(s => counts[s] = 0);
  pipeline.companies.forEach(c => { if(counts[c.stage] !== undefined) counts[c.stage]++; });
  document.getElementById('funnelStats').innerHTML = `<div class="card active" style="padding:12px 14px;">` +
    stages.map(s => `<div class="streak-row"><span>${stageLabel(s)}</span><span>${counts[s]}</span></div>`).join('') +
    `</div>`;
}
