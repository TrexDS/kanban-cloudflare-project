/* ---- Daily log ---- */
let selectedDailyDate = null; // 惰性初始化成今天，避免在 todayStr 定义之前就调用它
function getEntryIfAny(date){ return dailyLog.entries[date] || { hours: {} }; } // read-only: doesn't create a day
function getEntry(date){
  if(!dailyLog.entries[date]) dailyLog.entries[date] = { hours: {}, note: '' };
  return dailyLog.entries[date];
}
function changeDailyDate(date){
  if(!date) return;
  selectedDailyDate = date;
  document.getElementById('dailyDatePicker').value = date;
  renderDaily();
}
// Hours stay per project in entry.hours (history, Sheet sync and project charts read it);
// entry.taskHours says which task that time went to. Logging on a task moves both by the same delta,
// so a project's hours = its tasks' hours + whatever was logged without a task ("unassigned").
function canLogProject(p){ return ['exploring','active','maintaining'].includes(lifecycleOf(p)); }
function taskHoursOf(entry, taskId){ return (entry.taskHours && entry.taskHours[taskId]) || 0; }
function unassignedHours(entry, projectId){
  const onTasks = state.items.filter(x => x.projectId === projectId).reduce((sum, x) => sum + taskHoursOf(entry, x.id), 0);
  return Math.max(0, (entry.hours[projectId] || 0) - onTasks);
}
async function logHours(projectId, taskId, amount, date){
  date = date || selectedDailyDate || todayStr(0);
  const entry = getEntry(date);
  let delta;
  if(taskId){
    entry.taskHours = entry.taskHours || {};
    const cur = taskHoursOf(entry, taskId);
    delta = Math.max(0, cur + amount) - cur;
    entry.taskHours[taskId] = cur + delta;
  } else {
    delta = Math.max(-unassignedHours(entry, projectId), amount);
  }
  entry.hours[projectId] = Math.max(0, (entry.hours[projectId] || 0) + delta);
  await saveDaily(date);
  renderDaily(); renderTasks();
}
async function saveDailyNote(){
  const date = selectedDailyDate || todayStr(0);
  const entry = getEntry(date);
  entry.note = document.getElementById('dailyNoteInput').value.trim();
  await saveDaily(date);
}
const CLEAR_LABEL = { zh: '清零', en: 'Clear' };
function renderDaily(){
  if(!selectedDailyDate) selectedDailyDate = todayStr(0);
  const date = selectedDailyDate;
  const entry = getEntry(date);
  const picker = document.getElementById('dailyDatePicker');
  picker.max = todayStr(0); // 不能补未来的卡
  if(picker.value !== date) picker.value = date;
  const isToday = date === todayStr(0);
  document.getElementById('dailyDateLabel').textContent = isToday ? `📅 ${date}` : `📅 补打卡：${date}`;
  const projects = state.tasks.filter(p => canLogProject(p) || (entry.hours[p.id] || 0) > 0);
  const btns = (pid, tid, h) => `<div class="log-btns">
      <button class="chip btn-sm" onclick="logHours('${pid}',${tid ? `'${tid}'` : 'null'},0.5)">+0.5h</button>
      <button class="chip btn-sm" onclick="logHours('${pid}',${tid ? `'${tid}'` : 'null'},1)">+1h</button>
      <button class="chip btn-sm" onclick="logHours('${pid}',${tid ? `'${tid}'` : 'null'},2)">+2h</button>
      ${h > 0 ? `<button class="chip btn-sm" onclick="logHours('${pid}',${tid ? `'${tid}'` : 'null'},-${h})">${CLEAR_LABEL[LANG]}</button>` : ''}
    </div>`;
  const row = (label, sub, h, buttons) => `<div class="log-task">
      <div class="log-task-name">${label}${sub ? ` <span class="sub" style="font-size:11.5px;">${sub}</span>` : ''}</div>
      <span class="log-today-total">${h > 0 ? h + 'h' : ''}</span>${buttons}
    </div>`;
  const listEl = document.getElementById('list-dailylog');
  listEl.innerHTML = projects.length ? projects.map(p => {
    const total = entry.hours[p.id] || 0;
    const canLog = canLogProject(p);
    const tasks = state.items.filter(x => x.projectId === p.id && (x.status !== 'done' || taskHoursOf(entry, x.id) > 0));
    const un = unassignedHours(entry, p.id);
    const tag = canLog ? '' : ` <span class="sub" style="font-weight:400; font-size:11.5px;">${p.column === 'archived' ? t('tagArchived') : t('tagWatch')}</span>`;
    return `<div class="log-row">
      <div class="log-row-title"><span>${escapeHtml(p.title)}${tag}</span><span class="log-today-total">${total > 0 ? total + 'h' : ''}</span></div>
      ${tasks.map(x => row(escapeHtml(x.title), t(TS_LABEL[x.status]), taskHoursOf(entry, x.id), canLog ? btns(p.id, x.id, taskHoursOf(entry, x.id)) : '')).join('')}
      ${canLog || un > 0 ? row(`<span class="sub">${t('logUnassigned')}</span>`, '', un, canLog ? btns(p.id, null, un) : '') : ''}
    </div>`;
  }).join('') : `<div class="empty">${t('dailyEmptyActive')}</div>`;
  document.getElementById('dailyNoteInput').value = entry.note || '';
}
