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

const STEP_GOAL = 8000;
const ACTIVE_CAL_GOAL = 350;
function resilienceLabel(key){ return t('res' + key.charAt(0).toUpperCase() + key.slice(1)); }

// SpO2 是 90%~100% 的窄区间指标，不能直接当 0-100 分画雷达图（会把血氧轴撑爆）。
// 按临床参考区间分段映射：98%+ 视为满分，94% 左右是及格线，90% 以下视为 0 分。
function spo2ToScore(spo2){
  const points = [[90,0],[93,50],[95,80],[97,95],[100,100]];
  if(spo2 <= points[0][0]) return 0;
  if(spo2 >= points[points.length-1][0]) return 100;
  for(let i=0;i<points.length-1;i++){
    const [x0,y0] = points[i], [x1,y1] = points[i+1];
    if(spo2 >= x0 && spo2 <= x1) return y0 + (spo2-x0)/(x1-x0)*(y1-y0);
  }
  return 50;
}

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

function radarChartSVG(dims, size){
  const n = dims.length;
  const margin = 66; // extra room around the circle so long axis labels (esp. English) don't clip
  const vb = size + margin*2;
  const cx = vb/2, cy = vb/2, r = size/2 - 10;
  const angle = i => -Math.PI/2 + i * (2*Math.PI/n);
  const ringPolys = [0.25, 0.5, 0.75, 1].map(f => {
    const pts = dims.map((d,i) => { const a = angle(i); return `${cx + Math.cos(a)*r*f},${cy + Math.sin(a)*r*f}`; }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#e5e2da" stroke-width="1"/>`;
  }).join('');
  // 80分参考线（虚线），方便一眼看出哪些维度达标
  const refPts = dims.map((d,i) => { const a = angle(i); return `${cx + Math.cos(a)*r*0.8},${cy + Math.sin(a)*r*0.8}`; }).join(' ');
  const refRing = `<polygon points="${refPts}" fill="none" stroke="#c1573f" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.55"/>`;
  const axisLines = dims.map((d,i) => {
    const a = angle(i);
    return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a)*r}" y2="${cy + Math.sin(a)*r}" stroke="#e5e2da" stroke-width="1"/>`;
  }).join('');
  const dataPts = dims.map((d,i) => {
    const a = angle(i);
    const v = Math.max(0, Math.min(100, d.value)) / 100 * r;
    return `${cx + Math.cos(a)*v},${cy + Math.sin(a)*v}`;
  }).join(' ');
  const labels = dims.map((d,i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a)*(r+22), ly = cy + Math.sin(a)*(r+22);
    const nameLines = d.label.includes(' ') ? d.label.split(' ') : [d.label];
    const lineH = 11;
    const nameStartY = ly - ((nameLines.length-1) * lineH)/2 - 6;
    const nameHtml = nameLines.map((w,li) =>
      `<text x="${lx}" y="${nameStartY + li*lineH}" font-size="10.5" fill="#8a8578" text-anchor="middle" dominant-baseline="middle">${escapeHtml(w)}</text>`
    ).join('');
    const valueY = nameStartY + nameLines.length*lineH + 5;
    return nameHtml + `<text x="${lx}" y="${valueY}" font-size="11" font-weight="700" fill="#2b2b2b" text-anchor="middle" dominant-baseline="middle">${escapeHtml(d.display)}</text>`;
  }).join('');
  return `<svg width="${vb}" height="${vb}" viewBox="0 0 ${vb} ${vb}">
    ${ringPolys}${refRing}${axisLines}
    <polygon points="${dataPts}" fill="#3d6b5c" fill-opacity="0.28" stroke="#3d6b5c" stroke-width="2"/>
    ${labels}
  </svg>`;
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

function renderOuraOverview(){
  const el = document.getElementById('ouraOverviewCard');
  const row = latestRowWithFields(['Sleep Score','Readiness Score','Activity Score']);
  if(!row){ el.innerHTML = `<div class="empty">${t('ouraLoadFailed')}</div>`; return; }
  const spo2Raw = num(row['Avg SpO2 %']);
  const spo2 = spo2Raw ? spo2Raw : null; // Oura returns 0 (not blank) when SpO2 wasn't measured that night — treat as no-data, not a real 0% score
  const stressContributor = num(row['Stress Contributor']);
  const resilience = (row['Resilience Level'] || '').trim().toLowerCase();
  const sleepScore = num(row['Sleep Score']) ?? 0;
  const readinessScore = num(row['Readiness Score']) ?? 0;
  const activityScore = num(row['Activity Score']) ?? 0;
  const spo2Score = spo2 !== null ? spo2ToScore(spo2) : null;
  const dims = [
    { label:t('dimSleep'), value: sleepScore, display: `${sleepScore}` },
    { label:t('dimReadiness'), value: readinessScore, display: `${readinessScore}` },
    { label:t('dimActivity'), value: activityScore, display: `${activityScore}` },
    { label:t('dimStress'), value: stressContributor ?? 50, display: stressContributor !== null ? `${Math.round(stressContributor)}` : '–' },
    { label:t('dimSpo2'), value: spo2Score ?? 50, display: spo2Score !== null ? `${Math.round(spo2Score)}` : '–' }
  ];
  const tag = resilience ? `<span class="stage-badge stage-offer" style="margin-left:8px;">${t('statePrefix')}${resilienceLabel(resilience) || row['Resilience Level']}</span>` : '';
  const detailChips = [
    [t('dimSleep'), sleepScore],
    [t('dimReadiness'), readinessScore],
    [t('dimActivity'), activityScore],
    [t('dimStress'), stressContributor !== null ? Math.round(stressContributor) : null],
    [t('dimSpo2'), spo2Score !== null ? Math.round(spo2Score) : null]
  ];
  el.innerHTML = `
    <div style="font-weight:700; font-size:14.5px; margin-bottom:4px;">${escapeHtml(row['Date'])}${tag}</div>
    <div style="display:flex; justify-content:center;">${radarChartSVG(dims, 260)}</div>
    <div style="font-size:11px; color:var(--sub); text-align:center; margin:2px 0 10px;">${t('radarRefNote')}</div>
    <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:6px;">
      ${detailChips.map(([k,v]) => `<span class="chip" style="font-size:11.5px; ${v !== null ? bandStyle(v) : ''}">${escapeHtml(k)} · ${v !== null ? escapeHtml(scoreBand(v)) : t('noDataShort')}</span>`).join('')}
    </div>
  `;
}

function smoothPath(points){
  if(points.length < 2) return `M ${points[0][0]},${points[0][1]}`;
  let d = `M ${points[0][0]},${points[0][1]}`;
  for(let i=0;i<points.length-1;i++){
    const p0 = points[i===0?0:i-1], p1 = points[i], p2 = points[i+1];
    const p3 = points[Math.min(i+2,points.length-1)];
    const cp1x = p1[0] + (p2[0]-p0[0])/6, cp1y = p1[1] + (p2[1]-p0[1])/6;
    const cp2x = p2[0] - (p3[0]-p1[0])/6, cp2y = p2[1] - (p3[1]-p1[1])/6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function average(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function stddev(arr){
  if(arr.length < 2) return 0;
  const m = average(arr);
  return Math.sqrt(arr.reduce((s,v) => s+(v-m)*(v-m), 0) / arr.length);
}

// Single composite "net recovery" score (0-100, 50=baseline) instead of two diverging raw lines:
// HRV z-score (higher=better) minus RHR z-score (lower=better), averaged and rescaled.
// Avoids forcing the reader to mentally flip the polarity of two opposite-direction metrics.
// Discrete per-day energy bars instead of a line: each day is one bar, colored
// green/gray/red against a labeled 0/50/100 scale. Bars read as "state per day"
// at a glance, without asking the reader to track a wavy line's slope.
function batteryColor(v){ return v >= 60 ? '#3d6b5c' : v < 40 ? '#c1573f' : '#8a8578'; }
function batteryBarsSVG(labels, scores){
  const w = 300, h = 100, padX = 20, padY = 6, labelY = h + 12;
  const toY = v => h - padY - (v/100)*(h-padY*2);
  const baseline = toY(50);
  const stepX = (w - padX*2) / labels.length;
  const barW = Math.min(18, stepX * 0.62);
  const fontSize = labels.length > 10 ? 7 : 8.5;
  const trackTop = toY(100), trackBottom = toY(0);
  const minBarH = 3; // floor so a near-zero score still shows a visible sliver instead of looking like missing data
  const bars = scores.map((v,i) => {
    const cx = padX + stepX*i + stepX/2;
    const barH = Math.max(minBarH, h - padY - toY(v));
    const y = (h - padY) - barH;
    return `<rect x="${(cx-barW/2).toFixed(1)}" y="${trackTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${(trackBottom-trackTop).toFixed(1)}" rx="2" fill="#8a8578" opacity="0.07"/>
      <rect x="${(cx-barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${batteryColor(v)}"/>`;
  }).join('');
  const labelEls = labels.map((l,i) => {
    const cx = padX + stepX*i + stepX/2;
    return `<text x="${cx}" y="${labelY}" font-size="${fontSize}" fill="#8a8578" text-anchor="middle">${escapeHtml(l)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${labelY+4}" style="width:100%; height:auto; display:block;">
    <line x1="${padX}" y1="${toY(100)}" x2="${w-padX}" y2="${toY(100)}" stroke="#e5e2da" stroke-width="1"/>
    <line x1="${padX}" y1="${baseline}" x2="${w-padX}" y2="${baseline}" stroke="#8a8578" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
    <line x1="${padX}" y1="${toY(0)}" x2="${w-padX}" y2="${toY(0)}" stroke="#e5e2da" stroke-width="1"/>
    <text x="2" y="${toY(100)+3}" font-size="7.5" fill="#8a8578">100</text>
    <text x="2" y="${baseline+3}" font-size="7.5" fill="#8a8578">${t('avgLabel')}</text>
    <text x="6" y="${toY(0)+3}" font-size="7.5" fill="#8a8578">0</text>
    ${bars}
    ${labelEls}
  </svg>`;
}

function dualLineChartSVG(labels, seriesA, seriesB, baselineA, baselineB){
  const w = 300, h = 92, padX = 10, padY = 8, labelY = h + 12;
  const scaleFor = (arr, base) => {
    const all = (base !== null && base !== undefined) ? [...arr, base] : arr;
    const min = Math.min(...all), max = Math.max(...all), range = (max - min) || 1;
    return v => h - padY - ((v - min) / range) * (h - padY*2);
  };
  const toY1 = scaleFor(seriesA, baselineA);
  const toY2 = scaleFor(seriesB, baselineB);
  const stepX = labels.length > 1 ? (w - padX*2) / (labels.length - 1) : 0;
  const pts1 = seriesA.map((v,i) => [padX + i*stepX, toY1(v)]);
  const pts2 = seriesB.map((v,i) => [padX + i*stepX, toY2(v)]);
  const base1 = (baselineA !== null && baselineA !== undefined)
    ? `<line x1="${padX}" y1="${toY1(baselineA)}" x2="${w-padX}" y2="${toY1(baselineA)}" stroke="#3d6b5c" stroke-width="1" stroke-dasharray="4 3" opacity="0.55"/>` : '';
  const base2 = (baselineB !== null && baselineB !== undefined)
    ? `<line x1="${padX}" y1="${toY2(baselineB)}" x2="${w-padX}" y2="${toY2(baselineB)}" stroke="#c1573f" stroke-width="1" stroke-dasharray="4 3" opacity="0.55"/>` : '';
  const fontSize = labels.length > 10 ? 7 : 8.5;
  const labelEls = labels.map((l,i) =>
    `<text x="${padX+i*stepX}" y="${labelY}" font-size="${fontSize}" fill="#8a8578" text-anchor="middle">${escapeHtml(l)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${labelY+4}" style="width:100%; height:auto; display:block;">
    ${base1}${base2}
    <path d="${smoothPath(pts1)}" fill="none" stroke="#3d6b5c" stroke-width="2"/>
    <path d="${smoothPath(pts2)}" fill="none" stroke="#c1573f" stroke-width="2"/>
    ${labelEls}
  </svg>`;
}

let trendRange = 7;
function renderOuraTrend(range){
  if(range) trendRange = range;
  const el = document.getElementById('ouraTrendCard');
  const validRows = ouraRows.filter(r => num(r['Avg HRV']) !== null && num(r['Avg Resting HR']) !== null);
  // Window by actual calendar days from the latest available date, not just "last N rows with
  // data" — otherwise a long gap in HRV/RHR readings would let a "7天" tab silently pull in rows
  // from weeks ago while still labeled as a 7-day window.
  const latestDate = validRows.length ? validRows[validRows.length - 1]['Date'] : null;
  const rows = latestDate
    ? validRows.filter(r => (new Date(latestDate) - new Date(r['Date'])) / 86400000 < trendRange)
    : [];
  const tabsHtml = `<div class="log-btns" style="margin-bottom:10px;">
    <button class="chip btn-sm${trendRange===7?' hours':''}" onclick="renderOuraTrend(7)">${t('trend7d')}</button>
    <button class="chip btn-sm${trendRange===14?' hours':''}" onclick="renderOuraTrend(14)">${t('trend14d')}</button>
  </div>`;
  if(rows.length < 2){ el.innerHTML = tabsHtml + `<div class="empty">${t('trendInsufficientData')}</div>`; return; }
  const hrv = rows.map(r => num(r['Avg HRV']));
  const rhr = rows.map(r => num(r['Avg Resting HR']));
  const dates = rows.map(r => r['Date'].slice(8));
  const allHrv = ouraRows.map(r => num(r['Avg HRV'])).filter(v => v !== null);
  const allRhr = ouraRows.map(r => num(r['Avg Resting HR'])).filter(v => v !== null);
  const meanHrv = average(allHrv), stdHrv = stddev(allHrv) || 1;
  const meanRhr = average(allRhr), stdRhr = stddev(allRhr) || 1;
  const scores = rows.map(r => {
    const h = num(r['Avg HRV']), b = num(r['Avg Resting HR']);
    const hrvZ = (h - meanHrv) / stdHrv, rhrZ = (meanRhr - b) / stdRhr;
    return Math.max(0, Math.min(100, 50 + ((hrvZ + rhrZ) / 2) * 25));
  });
  const latest = scores[scores.length - 1];
  const statusKey = latest >= 60 ? 'batteryHigh' : latest < 40 ? 'batteryLow' : 'batteryMid';
  const descKey = latest >= 60 ? 'batteryHighDesc' : latest < 40 ? 'batteryLowDesc' : 'batteryMidDesc';
  const statusColor = batteryColor(latest);
  const emoji = latest >= 60 ? '🟢' : latest < 40 ? '🔴' : '🟡';
  el.innerHTML = tabsHtml +
    `<div style="margin-bottom:10px;">
      <div style="font-weight:700; font-size:16px; color:${statusColor};">${emoji} ${t('todayStatusPrefix')}${t(statusKey)}（${Math.round(latest)}/100）</div>
      <div style="font-size:12.5px; color:var(--sub); margin-top:4px;">${t(descKey)}</div>
    </div>` +
    batteryBarsSVG(dates, scores) +
    `<details style="margin-top:10px;">
      <summary style="cursor:pointer; font-size:12px; color:var(--sub);">${t('viewRawData')}</summary>
      ${dualLineChartSVG(dates, hrv, rhr, meanHrv, meanRhr)}
      <div style="display:flex; gap:16px; margin-top:6px; font-size:12px; color:var(--sub);">
        <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#3d6b5c; margin-right:4px;"></span>${t('legendHrv')} ${hrv[hrv.length-1]}ms</span>
        <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#c1573f; margin-right:4px;"></span>${t('legendRhr')} ${rhr[rhr.length-1]}bpm</span>
      </div>
      <div style="font-size:11px; color:var(--sub); margin-top:4px;">${t('trendBaselineNote')}</div>
    </details>`;
}

function ringSVG(pct, size, color, label){
  const r = size/2 - 8, circumference = 2*Math.PI*r;
  const dash = circumference * Math.max(0, Math.min(1, pct/100));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#efefec" stroke-width="10"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${dash} ${circumference}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="${size/2}" y="${size/2 - 4}" font-size="15" font-weight="700" fill="#2b2b2b" text-anchor="middle">${Math.round(pct)}%</text>
    <text x="${size/2}" y="${size/2 + 14}" font-size="10" fill="#8a8578" text-anchor="middle">${escapeHtml(label)}</text>
  </svg>`;
}

function renderOuraActivity(){
  const el = document.getElementById('ouraActivityCard');
  const row = latestRowWithFields(['Steps']);
  if(!row){ el.innerHTML = `<div class="empty">${t('ouraLoadFailed')}</div>`; return; }
  const steps = num(row['Steps']) || 0;
  const activeCal = num(row['Active Calories']) || 0;
  const stepPct = Math.min(100, steps / STEP_GOAL * 100);
  const calPct = Math.min(100, activeCal / ACTIVE_CAL_GOAL * 100);
  el.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-around; flex-wrap:wrap; gap:12px;">
      <div style="text-align:center;">
        ${ringSVG(stepPct, 110, 'var(--active)', t('goalPrefix') + STEP_GOAL)}
        <div style="font-size:13px; font-weight:600; margin-top:2px;">${steps}${t('stepsSuffix')}</div>
      </div>
      <div style="flex:1; min-width:140px;">
        <div class="bar-label"><span>${t('activeCalLabel')}</span><span>${activeCal} kcal</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${calPct}%; background:var(--accent);"></div></div>
        <div class="card-meta" style="margin-top:4px;">${t('goalKcalPrefix')} ${ACTIVE_CAL_GOAL} kcal</div>
      </div>
    </div>
    <p class="card-meta" style="margin-top:10px;">${escapeHtml(row['Date'])}</p>
  `;
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
