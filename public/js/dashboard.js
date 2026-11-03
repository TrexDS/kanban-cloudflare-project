/* ---- Dashboard ---- */
function last7Days(){
  const days = [];
  for(let i=6;i>=0;i--) days.push(todayStr(-i));
  return days;
}
function sumHoursForTask(taskId, days){
  let sum = 0;
  days.forEach(d => { const e = dailyLog.entries[d]; if(e && e.hours[taskId]) sum += e.hours[taskId]; });
  return sum;
}
function allTimeHoursForTask(taskId){
  let sum = 0;
  Object.keys(dailyLog.entries).forEach(d => { const e = dailyLog.entries[d]; if(e.hours[taskId]) sum += e.hours[taskId]; });
  return sum;
}
function lastActiveDate(taskId){
  let latest = null;
  Object.keys(dailyLog.entries).forEach(d => {
    const e = dailyLog.entries[d];
    if(e.hours[taskId] && e.hours[taskId] > 0){ if(!latest || d > latest) latest = d; }
  });
  return latest;
}
function daysBetween(dateStr){
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date(todayStr(0) + 'T00:00:00');
  return Math.round((target - now) / 86400000);
}

async function renderHealthOverview(){
  await loadOuraRows();
  renderHealthStatus(); renderHealthAlerts();
  renderOuraOverview(); renderOuraSleep(); renderOuraVitals();
  renderStressRecovery(); renderWorkRecovery(); renderOuraActivity();
  loadOuraAnalysis();
}

function fmtMonthDay(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function daysUntilText(daysLeft, mmdd){
  return LANG === 'zh' ? ` · 距 ${mmdd} 还剩 ${daysLeft} 天` : ` · ${daysLeft} days until ${mmdd}`;
}

// Dashboard = weekly review: where the time went, which projects are moving or stuck, what got finished.
function renderDashboard(){
  // Budget progress for any live project that has an hour budget
  document.getElementById('budgetCards').innerHTML = state.tasks.filter(p => p.budgetHours && p.column !== 'archived').map(p => {
    const done = allTimeHoursForTask(p.id);
    const pct = Math.min(100, Math.round((done / p.budgetHours) * 100));
    const daysLeft = p.deadline ? daysBetween(p.deadline) : null;
    return `<div class="progress-card">
      <div style="font-weight:700; font-size:14.5px; margin-bottom:6px;">${escapeHtml(p.title)}${t('farewellProgressSuffix')}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div style="font-size:12.5px; color:var(--sub);">${t('investedLabel')} ${done}h / ${t('budgetLabel')} ${p.budgetHours}h（${pct}%）${daysLeft !== null ? daysUntilText(daysLeft, fmtMonthDay(p.deadline)) : ''}</div>
    </div>`;
  }).join('');

  const days = last7Days();
  const projTitle = id => (state.tasks.find(p => p.id === id) || {}).title || '';
  const archTag = p => p.column === 'archived' ? t('tagArchived') : '';
  const esc = x => escapeHtml(String(x));

  // Series slots: top 4 projects by all-time hours keep their own color; the rest share "other".
  const totals = state.tasks.map(p => ({ p, h: allTimeHoursForTask(p.id) })).filter(x => x.h > 0).sort((a,b) => b.h - a.h);
  const slotOf = {}; totals.slice(0, 4).forEach((x, i) => slotOf[x.p.id] = 's' + (i + 1));
  const colorOf = k => `var(--${slotOf[k] || 's-other'})`;

  // Weekly stacked columns, last 12 weeks (Mon–Sun); empty weeks stay as zero so gaps show.
  const monday = d => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
  const weeks = [];
  for(let i = 11; i >= 0; i--){ const m = monday(todayStr(0)); m.setDate(m.getDate() - 7 * i); weeks.push(m); }
  const weekData = weeks.map(m => {
    const ds = []; for(let k = 0; k < 7; k++){ const d = new Date(m); d.setDate(d.getDate() + k); ds.push(fmtDate(d.getTime())); }
    const byKey = {};
    const parts = state.tasks.map(p => [p, sumHoursForTask(p.id, ds)]).filter(x => x[1] > 0).sort((a,b) => b[1] - a[1]);
    parts.forEach(([p, h]) => { const k = slotOf[p.id] ? p.id : 'other'; byKey[k] = (byKey[k] || 0) + h; });
    return { m, byKey, parts, total: parts.reduce((a, x) => a + x[1], 0) };
  });
  const maxW = Math.max(1, ...weekData.map(w => w.total));
  const order = [...totals.slice(0, 4).map(x => x.p.id), ...(totals.length > 4 ? ['other'] : [])];
  document.getElementById('weeksLegend').innerHTML = order
    .map(k => `<span><i style="background:${colorOf(k)}"></i>${k === 'other' ? t('otherProjects') : esc(projTitle(k))}</span>`).join('');
  const md = m => `${m.getMonth() + 1}/${m.getDate()}`;
  document.getElementById('weeksChart').innerHTML = weekData.map(w => {
    const tip = `${t('weekOf')} ${md(w.m)} · ${w.total}h` + w.parts.map(([p, h]) => `\n${p.title}  ${h}h`).join('');
    return `<div class="wk-col" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}">
      ${w.total ? `<div class="wk-total">${w.total}</div>` : ''}
      <div class="wk-stack">${order.filter(k => w.byKey[k]).map(k => `<span style="height:${w.byKey[k] / maxW * 150}px; background:${colorOf(k)}"></span>`).join('')}</div>
    </div>`;
  }).join('');
  document.getElementById('weeksLabels').innerHTML = weekData.map(w => `<span>${md(w.m)}</span>`).join('');

  renderAccumulated(totals, order, colorOf);

  // All-time hours per project (ranked, one hue); expand a project for its per-task split.
  const hbar = (label, tipLabel, h, max, color, extra) => `<div class="hbar ${extra || ''}" data-tip="${esc(tipLabel)}  ${h}h">
      <span>${label}</span><span class="hbar-val">${h}h</span>
      <div class="hbar-track"><span style="width:${h / max * 100}%; background:${color}"></span></div>
    </div>`;
  const maxP = Math.max(1, ...totals.map(x => x.h));
  document.getElementById('projTotals').innerHTML = totals.length ? totals.map(({ p, h }) => {
    const items = state.items.filter(x => x.projectId === p.id).map(x => ({ x, h: taskTotalHours(x.id) })).filter(y => y.h > 0).sort((a,b) => b.h - a.h);
    const un = Math.round((h - items.reduce((a, y) => a + y.h, 0)) * 10) / 10;
    const rows = [...items.map(y => [esc(y.x.title), y.x.title, y.h]), ...(un > 0 ? [[`<span class="sub">${t('unassignedTask')}</span>`, t('unassignedTask'), un]] : [])];
    return `<details class="proj-total"><summary>${hbar(`▸ ${esc(p.title)}${archTag(p)}`, p.title, h, maxP, 'var(--active)')}</summary>
      ${rows.map(([n, tn, v]) => hbar(n, tn, v, h, 'var(--seg-doing)', 'sub-bar')).join('')}
    </details>`;
  }).join('') : `<div class="empty">${t('weeklyEmpty')}</div>`;

  // Most time-consuming tasks across all projects.
  const topT = state.items.map(x => ({ x, h: taskTotalHours(x.id) })).filter(y => y.h > 0).sort((a,b) => b.h - a.h).slice(0, 10);
  const maxT = Math.max(1, ...topT.map(y => y.h));
  document.getElementById('topTasks').innerHTML = topT.length ? `<div class="card active" style="padding:8px 14px;">` +
    topT.map(y => hbar(`${esc(y.x.title)} <span class="sub">· ${esc(projTitle(y.x.projectId))}</span>`, y.x.title, y.h, maxT, 'var(--active)')).join('') + `</div>`
    : `<div class="empty">${t('topTasksEmpty')}</div>`;

  // KPI row: the four numbers a weekly review starts from.
  const cutoff7 = new Date(days[0] + 'T00:00:00').getTime();
  const doneWeek = state.items.filter(x => x.status === 'done' && (x.updatedAt || 0) >= cutoff7);
  const weekHours = state.tasks.reduce((sum, p) => sum + sumHoursForTask(p.id, days), 0);
  const nWaiting = state.items.filter(x => x.status === 'waiting').length;
  const kpi = (label, value, unit) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  document.getElementById('kpiRow').innerHTML =
    kpi(t('kpiHours'), Math.round(weekHours * 10) / 10, 'h') +
    kpi(t('kpiDoing'), state.items.filter(x => x.status === 'doing').length) +
    kpi(t('kpiWaiting'), nWaiting ? `⚠️ ${nWaiting}` : 0) +
    kpi(t('kpiDone'), doneWeek.length) +
    kpi(t('kpiReady'), (() => { // today's readiness from Oura, so planning the day can take recovery into account
      if(ouraStatus === 'failed') return `<span class="kpi-warn" onclick="switchTab('health')">⚠️ ${t('ouraReadFailedShort')}</span>`;
      const r = latestRowWithFields(['Readiness Score']);
      if(!r) return '–';
      return `<span onclick="switchTab('health')" style="cursor:pointer">${r['Readiness Score']}</span>${ouraAge() >= 2 ? `<small>⚠️ ${mdStr(r["Date"])}</small>` : `<small>${scoreBand(+r['Readiness Score'])}</small>`}`;
    })());

  // Task status split per project: todo (inbox/backlog/ready) → doing → waiting → done.
  // Project progress, split into "needs attention" (with a direct action) and a collapsed "on track" list.
  // Stale = neither a logged hour nor a task change in 14 days (editing the project itself doesn't count).
  const DAY = 86400000, daysAgo = ts => Math.floor((Date.now() - ts) / DAY);
  const live = state.tasks.filter(p => ['exploring','active','maintaining'].includes(lifecycleOf(p)));
  const taskLine = (st, list) => list.length ? `<div class="sub" style="margin-top:4px;">${t(TS_LABEL[st])}：${list.map(x => escapeHtml(x.title)).join('、')}</div>` : '';
  const btn = (fn, label) => `<button class="chip btn-sm" onclick="${fn}">${label}</button>`;
  const rows = live.map(p => {
    const items = state.items.filter(x => x.projectId === p.id);
    const open = items.filter(x => x.status !== 'done');
    const lastLog = lastActiveDate(p.id);
    const lastTouch = Math.max(lastLog ? new Date(lastLog + 'T00:00:00').getTime() : 0, ...items.map(x => x.updatedAt || 0));
    const issues = [];
    if(daysAgo(lastTouch) >= 14) issues.push({ w: daysAgo(lastTouch), text: lastTouch ? t('issueStale')(daysAgo(lastTouch)) : t('issueNever'),
      acts: btn(`goTasks('${p.id}')`, t('actAddTask')) + btn(`setLifecycle('${p.id}','on_hold')`, t('actHold')) });
    // a task's updatedAt is set on every status change, so for a waiting task it's when it started waiting
    open.filter(x => x.status === 'waiting' && daysAgo(x.updatedAt || 0) >= 7).forEach(x =>
      issues.push({ w: daysAgo(x.updatedAt), text: t('issueWaiting')(escapeHtml(x.title), daysAgo(x.updatedAt)), acts: btn(`goTasks('${p.id}')`, t('actOpenTasks')) }));
    if(lifecycleOf(p) !== 'maintaining' && open.length && !open.some(x => x.status === 'doing'))
      issues.push({ w: 0, text: t('issueNoDoing'), acts: btn(`goTasks('${p.id}')`, t('actOpenTasks')) });
    return { p, items, open, issues, w: Math.max(-1, ...issues.map(x => x.w)) };
  });
  const SEG = [['todo', t('segTodo'), ['inbox','backlog','ready']], ['doing', t('tsDoing'), ['doing']], ['waiting', t('tsWaiting'), ['waiting']], ['done', t('tsDone'), ['done']]];
  const progressCard = ({ p, items, open }) => {
    const segs = SEG.map(([k, label, sts]) => [k, label, items.filter(x => sts.includes(x.status)).length]).filter(x => x[2] > 0);
    const summary = segs.map(([, label, n]) => `${label} ${n}`).join(' · ');
    return `<div class="card ${p.column}" style="padding:10px 14px;">
      <div class="streak-row"><span style="font-weight:600;">${escapeHtml(p.title)} <span class="sub" style="font-weight:400;">· ${t(LC_LABEL[lifecycleOf(p)])}</span></span><span class="seg-counts">${items.length ? summary : t('noTasksYet')}</span></div>
      ${items.length ? `<div class="seg-bar" role="img" aria-label="${escapeHtml(summary)}">${segs.map(([k, label, n]) => `<span style="flex:${n}; background:var(--seg-${k})" title="${label}：${n}"></span>`).join('')}</div>` : ''}
      ${taskLine('doing', open.filter(x => x.status === 'doing'))}
      ${taskLine('waiting', open.filter(x => x.status === 'waiting'))}
    </div>`;
  };
  const bad = rows.filter(r => r.issues.length).sort((a,b) => b.w - a.w), ok = rows.filter(r => !r.issues.length);
  document.getElementById('projectProgress').innerHTML = !live.length ? `<div class="empty">${t('progressEmpty')}</div>` :
    (bad.length ? `<div class="attn-head">${t('needAttn')} (${bad.length})</div>` + bad.map(r => `<div class="stale-item">
        <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(r.p.title)} <span class="sub" style="font-weight:400;">· ${t(LC_LABEL[lifecycleOf(r.p)])}</span></div>
        ${r.issues.map(x => `<div class="attn-row"><span>${x.text}</span><span class="card-actions">${x.acts}</span></div>`).join('')}
      </div>`).join('') : `<div class="empty">${t('allOnTrack')}</div>`) +
    (ok.length ? `<details class="card-tasks" style="margin-top:10px;"><summary>${t('onTrack')} (${ok.length})</summary>
      <div class="seg-legend" style="margin:8px 0;">${SEG.map(([k, label]) => `<span><i style="background:var(--seg-${k})"></i>${label}</span>`).join('')}</div>
      ${ok.map(progressCard).join('')}</details>` : '');

  // Done this week. shortcut: uses the task's updatedAt (set on every status change) as the finish time; add a doneAt field if tasks become editable after Done.
  const done = doneWeek.sort((a,b) => b.updatedAt - a.updatedAt);
  document.getElementById('doneList').innerHTML = done.length ? `<div class="card active" style="padding:6px 14px;">` +
    done.map(x => `<div class="streak-row"><span>${escapeHtml(x.title)}</span><span class="sub">${escapeHtml(projTitle(x.projectId))}</span></div>`).join('') +
    `</div>` : `<div class="empty">${t('doneEmpty')}</div>`;
}

// Accumulated hours since the first log: one area (total) or one line per top project.
// One y-axis (hours); a crosshair + tooltip reads every series on the hovered day.
let accMode = 'total';
function renderAccumulated(totals, order, colorOf){
  const el = document.getElementById('accChart');
  document.getElementById('accToggle').innerHTML = ['total','project'].map(m =>
    `<button class="chip btn-sm ${accMode===m?'on':''}" aria-pressed="${accMode===m}" onclick="accMode='${m}'; renderDashboard()">${t(m==='total'?'accTotal':'accByProject')}</button>`).join('');
  const dates = Object.keys(dailyLog.entries).filter(d => Object.values(dailyLog.entries[d].hours || {}).some(h => h > 0)).sort();
  if(!dates.length){ el.innerHTML = `<div class="empty">${t('weeklyEmpty')}</div>`; document.getElementById('accLegend').innerHTML = ''; return; }
  const days = []; for(let d = new Date(dates[0] + 'T00:00:00'); fmtDate(d.getTime()) <= todayStr(0); d.setDate(d.getDate() + 1)) days.push(fmtDate(d.getTime()));
  const keys = accMode === 'total' ? ['total'] : order;
  const keyOf = pid => accMode === 'total' ? 'total' : (order.includes(pid) ? pid : 'other');
  const run = Object.fromEntries(keys.map(k => [k, 0]));
  const series = Object.fromEntries(keys.map(k => [k, []]));
  days.forEach(d => {
    const e = dailyLog.entries[d];
    if(e) Object.entries(e.hours || {}).forEach(([pid, h]) => { const k = keyOf(pid); if(k in run) run[k] += h || 0; });
    keys.forEach(k => series[k].push(run[k]));
  });
  const name = k => k === 'total' ? t('accTotal') : k === 'other' ? t('otherProjects') : ((state.tasks.find(p => p.id === k) || {}).title || '');
  const color = k => k === 'total' ? 'var(--active)' : colorOf(k);
  document.getElementById('accLegend').innerHTML = accMode === 'total' ? '' : keys.map(k => `<span><i style="background:${color(k)}"></i>${escapeHtml(name(k))}</span>`).join('');

  const W = el.clientWidth || 600, H = 220, L = 34, R = 10, T = 10, B = 22;
  const maxY = Math.max(1, ...keys.map(k => series[k][series[k].length - 1]));
  const step = [1,2,5,10,20,25,50,100,200,500].find(s => maxY / s <= 4) || 1000;
  const top = Math.ceil(maxY / step) * step;
  const x = i => L + (days.length === 1 ? 0 : i / (days.length - 1) * (W - L - R));
  const y = v => T + (1 - v / top) * (H - T - B);
  const ticks = []; for(let v = 0; v <= top; v += step) ticks.push(v);
  const path = k => series[k].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const xIdx = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('accTitle')}: ${keys.map(k => `${name(k)} ${series[k][series[k].length-1]}h`).join(', ')}">
    ${ticks.map(v => `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${v}h</text>`).join('')}
    ${xIdx.map(i => `<text x="${x(i)}" y="${H-6}" text-anchor="${i===0?'start':i===days.length-1?'end':'middle'}">${days[i].slice(5).replace('-','/')}</text>`).join('')}
    ${accMode === 'total' ? `<path d="${path('total')}L${x(days.length-1)},${y(0)}L${x(0)},${y(0)}Z" fill="var(--active)" opacity="0.14"/>` : ''}
    ${keys.map(k => `<path d="${path(k)}" fill="none" stroke="${color(k)}" stroke-width="2" stroke-linejoin="round"/>`).join('')}
    <line id="accCross" y1="${T}" y2="${H-B}" stroke="#7f8a92" stroke-dasharray="3 3" style="display:none"/>
    ${keys.map(k => `<circle class="acc-dot" data-k="${k}" r="4" fill="${color(k)}" stroke="#fff" stroke-width="2" style="display:none"/>`).join('')}
    <rect x="${L}" y="0" width="${W-L-R}" height="${H}" fill="transparent" id="accHit"/>
  </svg>`;
  const hit = el.querySelector('#accHit'), cross = el.querySelector('#accCross'), tip = document.getElementById('vizTip');
  const hide = () => { cross.style.display = 'none'; el.querySelectorAll('.acc-dot').forEach(c => c.style.display = 'none'); tip.style.display = 'none'; };
  hit.addEventListener('mousemove', ev => {
    const r = el.querySelector('svg').getBoundingClientRect();
    const px = (ev.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(days.length - 1, Math.round((px - L) / (W - L - R) * (days.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    el.querySelectorAll('.acc-dot').forEach(c => { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(series[c.dataset.k][i])); c.style.display = ''; });
    tip.textContent = `${t('accUntil')} ${days[i]}` + keys.map(k => `\n${name(k)}  ${Math.round(series[k][i] * 10) / 10}h`).join('');
    tip.style.display = 'block';
    tip.style.left = Math.max(8, Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight - 10) + 'px';
    ev.stopPropagation();
  });
  hit.addEventListener('mouseleave', hide);
}
let accResizeTimer;
addEventListener('resize', () => { clearTimeout(accResizeTimer); accResizeTimer = setTimeout(() => { if(document.getElementById('view-dash').classList.contains('on')) renderDashboard(); }, 150); });
