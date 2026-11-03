/* ---- Oura + AI analysis: now proxied through our own Pages Function (same-origin, no CORS/CSP issue) ---- */
const OURA_CSV_URL = '/api/oura/raw';
const OURA_ANALYSIS_CSV_URL = '/api/oura/analysis';

// 兜底快照：网页环境的 fetch() 被 robots.txt 挡住时使用。
// 每次你说"同步一下Oura"，我会用 Google Drive 直接读取最新数据，更新这里。
const OURA_SNAPSHOT = {
  'Date': '2026-08-21', 'Sleep Score': '85', 'Sleep Efficiency': '70', 'Readiness Score': '79', 'Activity Score': '66',
  'Steps': '6681', 'Active Calories': '199', 'Avg HRV': '17', 'Avg Resting HR': '78',
  'Stress High (min)': '165', 'Recovery High (min)': '30', 'Stress Contributor': '57.2',
  'Avg SpO2 %': '94.432', 'Resilience Level': 'solid'
};
const OURA_ANALYSIS_SNAPSHOT = [
  { 'Date': '2026-08-22', 'Period': 'day',
    'Summary': '你的睡眠评分不错，但睡眠效率偏低（70%），卧床时间较长且不安睡期较多，提示夜间觉醒或浅睡偏多；同时静息心率偏高（78）、HRV偏低（17），压力时段较长（165分钟），身体整体处于"高压力、恢复不足"的状态。建议今晚睡前做10分钟腹式呼吸或正念冥想，并提前30分钟远离屏幕，以降低压力水平、提升睡眠连续性和次日恢复力。' }
];

// Real CSV parser (handles quoted fields containing commas and embedded newlines,
// and "" as an escaped quote) — a naive split('\n')/split(',') breaks as soon as a
// cell (e.g. a multi-line AI summary) is quoted and spans multiple lines.
function parseCSV(text){
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if(c === '"'){
      inQuotes = true;
    } else if(c === ','){
      row.push(field); field = '';
    } else if(c === '\n'){
      row.push(field); rows.push(row); row = []; field = '';
    } else if(c === '\r'){
      // skip
    } else {
      field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  if(!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(cell => cell !== ''))
    .map(cols => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = (cols[i] !== undefined ? cols[i] : '').trim());
      return obj;
    });
}

function resilienceLabel(key){ return t('res' + key.charAt(0).toUpperCase() + key.slice(1)); }

function num(v){
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

let ouraRows = [];
function fetchWithTimeout(url, ms){
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

async function loadOuraRows(){
  try{
    const res = await fetchWithTimeout(OURA_CSV_URL, 6000);
    if(!res.ok) throw new Error('bad response');
    const rows = parseCSV(await res.text()).filter(r => r['Date']);
    // The sheet occasionally has the same Date synced twice (e.g. a retried Apps Script run);
    // keep only the last row per date so trend windows count each day once, not twice.
    const byDate = new Map();
    rows.forEach(r => byDate.set(r['Date'], r));
    const deduped = [...byDate.values()];
    ouraRows = deduped.length ? deduped : [OURA_SNAPSHOT];
  }catch(e){
    console.error('oura raw fetch failed', e);
    ouraRows = [OURA_SNAPSHOT];
  }
}

function latestRowWithFields(fields){
  for(let i = ouraRows.length - 1; i >= 0; i--){
    const r = ouraRows[i];
    if(fields.every(f => r[f] !== undefined && r[f] !== '')) return r;
  }
  return null;
}

// Oura's own published score bands, so a bare number doesn't leave the reader guessing "is 66 good?"
function scoreBand(v){
  if(v >= 85) return t('bandOptimal');
  if(v >= 70) return t('bandGood');
  if(v >= 60) return t('bandFair');
  return t('bandAttention');
}
function bandStyle(v){
  if(v >= 70) return 'background:var(--active-bg); color:var(--active); border-color:transparent; font-weight:600;';
  if(v >= 60) return 'background:var(--watch-bg); color:var(--watch); border-color:transparent; font-weight:600;';
  return 'background:#f7e3dd; color:var(--accent); border-color:transparent; font-weight:600;';
}
function average(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function stddev(arr){
  if(arr.length < 2) return 0;
  const m = average(arr);
  return Math.sqrt(arr.reduce((s,v) => s+(v-m)*(v-m), 0) / arr.length);
}
const md = d => `${+d.slice(5,7)}/${+d.slice(8,10)}`;
function fmtMin(m){
  m = Math.round(m || 0);
  const h = Math.floor(m / 60), r = m % 60;
  return LANG === 'en' ? (h ? `${h}h ${r}m` : `${r}m`) : (h ? `${h}小时${r ? r + '分' : ''}` : `${r}分`);
}

/* ---- Today: three concentric score rings (sleep / readiness / activity) ---- */
const RINGS = [['Sleep Score', 'ringSleep', '--ring-sleep'], ['Readiness Score', 'ringReady', '--ring-ready'], ['Activity Score', 'ringActivity', '--ring-activity']];
function renderOuraOverview(){
  const el = document.getElementById('ouraOverviewCard');
  const row = latestRowWithFields(RINGS.map(r => r[0]));
  if(!row){ el.innerHTML = `<div class="empty">${t('ouraLoadFailed')}</div>`; return; }
  const size = 150, c = size / 2, w = 13;
  const rings = RINGS.map(([field, key, color], i) => {
    const v = num(row[field]) ?? 0, r = c - w / 2 - 2 - i * (w + 3), len = 2 * Math.PI * r;
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(${color})" stroke-opacity="0.16" stroke-width="${w}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(${color})" stroke-width="${w}" stroke-linecap="round"
        stroke-dasharray="${len * Math.min(v, 100) / 100} ${len}" transform="rotate(-90 ${c} ${c})" data-tip="${t(key)} ${v}"/>`;
  }).join('');
  const ready = num(row['Readiness Score']) ?? 0;
  const verdict = ready >= 85 ? 'readyGreat' : ready >= 70 ? 'readyGood' : ready >= 60 ? 'readyFair' : 'readyLow';
  const resilience = (row['Resilience Level'] || '').trim().toLowerCase();
  const day = (row['Day Summary'] || '').trim().toLowerCase();
  const chips = [day && t('day_' + day) !== 'day_' + day ? t('daySummaryPrefix') + t('day_' + day) : '',
                 resilience ? t('resiliencePrefix') + (resilienceLabel(resilience) || resilience) : ''].filter(Boolean);
  el.innerHTML = `
    <div class="health-verdict">${t(verdict)}</div>
    <div class="ring-wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${RINGS.map(([f, k]) => `${t(k)} ${row[f]}`).join(', ')}">${rings}</svg>
      <div class="ring-legend">
        ${RINGS.map(([field, key, color]) => { const v = num(row[field]) ?? 0; return `<div class="ring-row">
          <i style="background:var(${color})"></i><span>${t(key)}<span class="sub">${t(key + 'Desc')}</span></span>
          <b>${v}</b><span class="chip btn-sm" style="${bandStyle(v)}">${scoreBand(v)}</span></div>`; }).join('')}
      </div>
    </div>
    ${chips.length ? `<div class="card-actions" style="margin-top:8px;">${chips.map(x => `<span class="chip btn-sm">${escapeHtml(x)}</span>`).join('')}</div>` : ''}`;
}

/* ---- Sleep: last night's stage donut + the last 7 nights stacked ---- */
// Ordered awake → deep (shallow to deep), the same order in the donut, the bars and the legend.
const STAGES = [['awake', null], ['rem', 'REM Sleep (min)'], ['light', 'Light Sleep (min)'], ['deep', 'Deep Sleep (min)']];
function stagesOf(r){
  const s = {}; STAGES.forEach(([k, f]) => { if(f) s[k] = num(r[f]) || 0; });
  const asleep = num(r['Total Sleep (min)']) || (s.rem + s.light + s.deep);
  s.awake = Math.max(0, (num(r['Time in Bed (min)']) || asleep) - asleep);
  return { s, asleep, bed: asleep + s.awake };
}
function renderOuraSleep(){
  const el = document.getElementById('ouraSleepCard');
  const nights = ouraRows.filter(r => num(r['Total Sleep (min)']) && num(r['Deep Sleep (min)']) !== null);
  if(!nights.length){ el.innerHTML = `<div class="empty">${t('ouraLoadFailed')}</div>`; return; }
  const last = nights[nights.length - 1], { s, asleep, bed } = stagesOf(last);
  const prev = nights.slice(-15, -1).map(r => stagesOf(r).asleep);
  const diff = prev.length >= 3 ? Math.round(asleep - average(prev)) : null;
  const diffTxt = diff === null ? '' : Math.abs(diff) < 10 ? t('sleepSameAsUsual') : t(diff > 0 ? 'sleepMoreThanUsual' : 'sleepLessThanUsual').replace('{m}', fmtMin(Math.abs(diff)));

  // donut: one circle per stage, offset along the ring, with a 2px surface gap between segments
  const size = 168, c = size / 2, r = 62, w = 20, len = 2 * Math.PI * r, gap = 2;
  let off = 0;
  const segs = STAGES.map(([k]) => {
    const part = len * s[k] / bed; const seg = part > gap ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--sleep-${k})" stroke-width="${w}"
      stroke-dasharray="${part - gap} ${len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})" tabindex="0"
      data-tip="${t('stage_' + k)} ${fmtMin(s[k])} · ${Math.round(s[k] / bed * 100)}%"/>` : '';
    off += part; return seg;
  }).join('');
  const legend = STAGES.map(([k]) => `<div class="ring-row"><i style="background:var(--sleep-${k})"></i>
      <span>${t('stage_' + k)}<span class="sub">${t('stage_' + k + 'Desc')}</span></span><b>${fmtMin(s[k])}</b><span class="sub">${Math.round(s[k] / bed * 100)}%</span></div>`).join('');

  // last 7 nights, stacked vertical bars in hours (time in bed), same stage order bottom = deep
  const week = nights.slice(-7).map(r => ({ r, ...stagesOf(r) }));
  const maxH = Math.max(9, Math.ceil(Math.max(...week.map(x => x.bed)) / 60));
  const H = 140, toPx = m => m / 60 / maxH * H;
  const avgWeek = average(week.map(x => x.asleep));
  const bars = week.map(x => {
    const tip = `${md(x.r['Date'])} · ${t('asleepLabel')} ${fmtMin(x.asleep)}` + STAGES.map(([k]) => `\n${t('stage_' + k)}  ${fmtMin(x.s[k])}`).join('');
    const stack = STAGES.map(([k]) => x.s[k] ? `<span style="height:${toPx(x.s[k]).toFixed(1)}px; background:var(--sleep-${k})"></span>` : '').join('');
    return `<div class="sl-col" tabindex="0" data-tip="${escapeHtml(tip)}"><div class="sl-val">${fmtMin(x.asleep)}</div><div class="sl-stack">${stack}</div></div>`;
  }).join('');
  const grid = [4, 8].map(h => `<div class="sl-grid" style="bottom:${(h / maxH * H).toFixed(1)}px"><span>${h}h</span></div>`).join('');

  el.innerHTML = `
    <div class="health-verdict">${t('sleepHeadline').replace('{d}', md(last['Date'])).replace('{t}', fmtMin(asleep))}${diffTxt ? `<span class="sub"> · ${diffTxt}</span>` : ''}</div>
    <div class="ring-wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${STAGES.map(([k]) => `${t('stage_' + k)} ${fmtMin(s[k])}`).join(', ')}">
        ${segs}
        <text x="${c}" y="${c - 4}" text-anchor="middle" font-size="19" font-weight="700" fill="#2b2b2b">${fmtMin(asleep)}</text>
        <text x="${c}" y="${c + 16}" text-anchor="middle" font-size="11" fill="#8a8578">${t('inBedLabel')} ${fmtMin(bed)}</text>
      </svg>
      <div class="ring-legend">${legend}
        <div class="sub" style="margin-top:6px;">${t('efficiencyLabel')} ${num(last['Sleep Efficiency']) ?? '–'}% · ${t('latencyLabel')} ${fmtMin(num(last['Sleep Latency (min)']))}</div>
      </div>
    </div>
    <div class="health-sub-title">${t('last7Nights')}<span class="sub"> · ${t('avgAsleep')} ${fmtMin(avgWeek)}</span></div>
    <div class="sl-chart" style="height:${H + 18}px">${grid}<div class="sl-cols">${bars}</div></div>
    <div class="sl-labels">${week.map(x => `<span>${md(x.r['Date'])}</span>`).join('')}</div>`;
}

/* ---- Vitals: last night vs. your own usual range (Apple Vitals style) ---- */
// good: which direction is better (+1 higher, -1 lower, 0 = neither; only stability matters)
const VITALS = [
  { f: 'Avg HRV', key: 'vHrv', unit: 'ms', good: 1, floor: 2, dp: 0 },
  { f: 'Avg Resting HR', key: 'vRhr', unit: 'bpm', good: -1, floor: 2, dp: 0 },
  { f: 'Avg SpO2 %', key: 'vSpo2', unit: '%', good: 1, floor: 0.5, dp: 1, zeroIsMissing: true },
  { f: 'Avg Breath Rate', key: 'vBreath', unit: t => t('perMin'), good: 0, floor: 0.5, dp: 1 },
  { f: 'Temperature Deviation', key: 'vTemp', unit: '°C', good: 0, floor: 0.2, dp: 2, signed: true }
];
function renderOuraVitals(){
  const el = document.getElementById('ouraVitalsCard');
  const rows = VITALS.map(v => {
    const vals = ouraRows.map(r => ({ d: r['Date'], x: num(r[v.f]) })).filter(p => p.x !== null && !(v.zeroIsMissing && p.x === 0));
    if(!vals.length) return '';
    const cur = vals[vals.length - 1], hist = vals.slice(-31, -1).map(p => p.x);
    const unit = typeof v.unit === 'function' ? v.unit(t) : v.unit;
    const fmt = x => (v.signed && x > 0 ? '+' : '') + x.toFixed(v.dp);
    if(hist.length < 5) return `<div class="vital"><div class="vital-head"><span>${t(v.key)}</span><b>${fmt(cur.x)} <small>${unit}</small></b></div><div class="sub">${t('vitalNoBaseline')}</div></div>`;
    // "usual range" = your own last 30 nights, mean ± 1 SD (with a floor so a very steady metric doesn't flag noise)
    const m = average(hist), sd = Math.max(stddev(hist), v.floor), lo = m - sd, hi = m + sd;
    const dir = cur.x > hi ? 1 : cur.x < lo ? -1 : 0;
    const worse = dir !== 0 && (v.good === 0 || dir !== v.good);
    const status = dir === 0 ? `✓ ${t('vitalInRange')}` : `${dir > 0 ? '↑' : '↓'} ${t(dir > 0 ? 'vitalHigh' : 'vitalLow')}`;
    const recent = vals.slice(-15, -1).map(p => p.x);
    const all = [...recent, cur.x, lo, hi], min = Math.min(...all), max = Math.max(...all), pad = (max - min) * 0.12 || 1;
    const pos = x => ((x - min + pad) / (max - min + 2 * pad) * 100).toFixed(1) + '%';
    return `<div class="vital">
      <div class="vital-head"><span>${t(v.key)}</span><b>${fmt(cur.x)} <small>${unit}</small></b></div>
      <div class="vital-track" data-tip="${t('usualRange')} ${fmt(lo)}–${fmt(hi)} ${unit}">
        <span class="vital-band" style="left:${pos(lo)}; width:calc(${pos(hi)} - ${pos(lo)})"></span>
        ${recent.map(x => `<span class="vital-dot past" style="left:${pos(x)}"></span>`).join('')}
        <span class="vital-dot now ${worse ? 'warn' : ''}" style="left:${pos(cur.x)}"></span>
      </div>
      <div class="vital-foot"><span class="${worse ? 'vital-warn' : 'vital-ok'}">${status}</span><span class="sub">${t('usualRange')} ${fmt(lo)}–${fmt(hi)}</span></div>
      <div class="sub" style="font-size:11.5px;">${t(v.key + 'Desc')}</div>
    </div>`;
  }).join('');
  el.innerHTML = rows ? `<div class="sub" style="margin-bottom:8px;">${t('vitalsIntro')}</div>${rows}
    <div class="vital-legend sub"><span><i class="vital-band-key"></i>${t('usualRange')}</span><span><i class="vital-dot-key past"></i>${t('last14Nights')}</span><span><i class="vital-dot-key"></i>${t('lastNight')}</span></div>`
    : `<div class="empty">${t('ouraLoadFailed')}</div>`;
}

/* ---- Activity: yesterday's step / calorie rings + 7-day steps ---- */
const STEP_GOAL = 8000;
const ACTIVE_CAL_GOAL = 350;
function ringSVG(pct, size, color, label){
  const r = size/2 - 8, circumference = 2*Math.PI*r;
  const dash = circumference * Math.max(0, Math.min(1, pct/100));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.16" stroke-width="10"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${dash} ${circumference}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="${size/2}" y="${size/2 - 4}" font-size="15" font-weight="700" fill="#2b2b2b" text-anchor="middle">${Math.round(pct)}%</text>
    <text x="${size/2}" y="${size/2 + 14}" font-size="10" fill="#8a8578" text-anchor="middle">${escapeHtml(label)}</text>
  </svg>`;
}
function renderOuraActivity(){
  const el = document.getElementById('ouraActivityCard');
  const days = ouraRows.filter(r => num(r['Steps']) !== null);
  if(!days.length){ el.innerHTML = `<div class="empty">${t('ouraLoadFailed')}</div>`; return; }
  const row = days[days.length - 1];
  const steps = num(row['Steps']) || 0, activeCal = num(row['Active Calories']) || 0;
  const week = days.slice(-7), maxS = Math.max(STEP_GOAL, ...week.map(r => num(r['Steps']) || 0)), H = 90;
  const hit = week.filter(r => (num(r['Steps']) || 0) >= STEP_GOAL).length;
  el.innerHTML = `
    <div class="sub" style="margin-bottom:6px;">${md(row['Date'])}</div>
    <div style="display:flex; align-items:center; justify-content:space-around; flex-wrap:wrap; gap:12px;">
      <div style="text-align:center;">${ringSVG(steps / STEP_GOAL * 100, 110, 'var(--ring-activity)', t('goalPrefix') + STEP_GOAL)}
        <div class="card-meta" style="margin-top:4px;">${steps.toLocaleString()}${t('stepsSuffix')}</div></div>
      <div style="text-align:center;">${ringSVG(activeCal / ACTIVE_CAL_GOAL * 100, 110, 'var(--ring-activity)', t('activeCalLabel'))}
        <div class="card-meta" style="margin-top:4px;">${activeCal} / ${ACTIVE_CAL_GOAL} kcal</div></div>
    </div>
    <div class="health-sub-title">${t('steps7d')}<span class="sub"> · ${t('goalHitDays').replace('{n}', hit).replace('{m}', week.length)}</span></div>
    <div class="sl-chart" style="height:${H + 18}px">
      <div class="sl-grid goal" style="bottom:${(STEP_GOAL / maxS * H).toFixed(1)}px"><span>${STEP_GOAL}</span></div>
      <div class="sl-cols">${week.map(r => { const v = num(r['Steps']) || 0; return `<div class="sl-col" tabindex="0" data-tip="${md(r['Date'])} · ${v.toLocaleString()}${t('stepsSuffix')}">
        <div class="sl-stack"><span style="height:${Math.max(2, v / maxS * H).toFixed(1)}px; background:var(--ring-activity)"></span></div></div>`; }).join('')}</div>
    </div>
    <div class="sl-labels">${week.map(r => `<span>${md(r['Date'])}</span>`).join('')}</div>`;
}

let ouraAnalysisRows = [];
async function loadOuraAnalysis(){
  if(!OURA_ANALYSIS_CSV_URL || OURA_ANALYSIS_CSV_URL.startsWith('PASTE_')){ ouraAnalysisRows = OURA_ANALYSIS_SNAPSHOT; renderOuraAnalysisCard('day'); return; }
  try{
    const res = await fetchWithTimeout(OURA_ANALYSIS_CSV_URL, 6000);
    if(!res.ok) throw new Error('bad response');
    ouraAnalysisRows = parseCSV(await res.text());
  }catch(e){ console.error('oura analysis fetch failed', e); ouraAnalysisRows = OURA_ANALYSIS_SNAPSHOT; }
  renderOuraAnalysisCard('day');
}
// Robust to how the model actually phrases headings: with/without "评级"/"维度",
// with/without markdown ** bold, with/without a "今日/下阶段" prefix on the action heading.
function parseAiSummary(text){
  if(!text) return null;
  const clean = text.replace(/\*\*/g, '');
  const headingRe = /(核心状态(?:评级)?|(?:异常(?:维度)?)?预警|(?:今日\/?下阶段)?高优(?:先级)?行动|行动建议|行动)\s*[：:]/g;
  const matches = [];
  let m;
  while((m = headingRe.exec(clean)) !== null){
    matches.push({ heading: m[1], index: m.index, contentStart: m.index + m[0].length });
  }
  if(!matches.length) return null;
  const sections = {};
  for(let i=0;i<matches.length;i++){
    const end = i+1 < matches.length ? matches[i+1].index : clean.length;
    let content = clean.slice(matches[i].contentStart, end);
    content = content.replace(/\s*-\s*$/, '').trim(); // strip a trailing bullet dash belonging to the next heading
    const h = matches[i].heading;
    if(h.indexOf('核心状态') === 0) sections.rating = content;
    else if(h.indexOf('预警') !== -1) sections.warnings = content;
    else sections.actions = content;
  }
  if(!sections.rating && !sections.warnings && !sections.actions) return null;
  return { rating: sections.rating || '', warnings: sections.warnings || '', actions: sections.actions || '' };
}

function renderOuraAnalysisCard(period){
  period = period || 'day';
  const el = document.getElementById('ouraAnalysisCard');
  const periodKeys = { day:'periodDay', week:'periodWeek', month:'periodMonth' };
  const tabsHtml = `<div class="log-btns" style="margin-bottom:10px;">` +
    Object.keys(periodKeys).map(p =>
      `<button class="chip btn-sm${p===period?' hours':''}" onclick="renderOuraAnalysisCard('${p}')">${t(periodKeys[p])}</button>`
    ).join('') + `</div>`;
  const matches = ouraAnalysisRows.filter(r => r['Period'] === period)
    .slice()
    .sort((a, b) => new Date(a['Date']) - new Date(b['Date']));
  const latest = matches[matches.length - 1];
  if(!latest){ el.innerHTML = tabsHtml + `<div class="empty">${t('aiNoData')}</div>`; return; }
  const parsed = parseAiSummary(latest['Summary']);
  const bodyHtml = parsed ? `
      ${parsed.rating ? `<span class="stage-badge stage-interview" style="margin-bottom:8px;">${escapeHtml(parsed.rating)}</span>` : ''}
      ${parsed.warnings ? `<div style="margin:8px 0;"><div style="font-weight:600; font-size:12.5px; margin-bottom:4px;">${t('aiWarnings')}</div><p class="card-notes" style="font-size:13px;">${escapeHtml(parsed.warnings)}</p></div>` : ''}
      ${parsed.actions ? `<div style="margin:8px 0;"><div style="font-weight:600; font-size:12.5px; margin-bottom:4px;">${t('aiActions')}</div><p class="card-notes" style="font-size:13px;">${escapeHtml(parsed.actions)}</p></div>` : ''}
    ` : `<p class="card-notes" style="font-size:13.5px;">${escapeHtml(latest['Summary'] || '')}</p>`;
  el.innerHTML = tabsHtml +
    `<details open>
      <summary style="cursor:pointer; font-weight:600; font-size:13px; margin-bottom:6px;">${t('aiDetailsSummary')}</summary>
      ${bodyHtml}
    </details>
     <p class="card-meta">${escapeHtml(latest['Date'] || '')}</p>`;
}
