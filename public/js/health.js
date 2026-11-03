/* ---- Oura + AI analysis: now proxied through our own Pages Function (same-origin, no CORS/CSP issue) ---- */
const OURA_CSV_URL = '/api/oura/raw';
const OURA_ANALYSIS_CSV_URL = '/api/oura/analysis';

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
let ouraStatus = 'idle'; // idle | ok | failed
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
    ouraRows = [...byDate.values()].sort((a, b) => a['Date'] < b['Date'] ? -1 : 1);
    ouraStatus = ouraRows.length ? 'ok' : 'failed';
  }catch(e){
    console.error('oura raw fetch failed', e);
    ouraRows = []; ouraStatus = 'failed'; // no stale fallback: a failed read must say so
  }
  updateHealthBadge();
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
const mdStr = d => `${+d.slice(5,7)}/${+d.slice(8,10)}`;
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
  if(!row){ el.innerHTML = `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`; return; }
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
  if(!nights.length){ el.innerHTML = `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`; return; }
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
  const week = nights.slice(-healthRange).map(r => ({ r, ...stagesOf(r) })), dense = week.length > 10;
  const every = Math.ceil(week.length / 8); // date labels: at most ~8 under the bars
  const maxH = Math.max(9, Math.ceil(Math.max(...week.map(x => x.asleep)) / 60)); // bars = time asleep (awake only in the tooltip), so height matches the label
  const H = 140, toPx = m => m / 60 / maxH * H;
  const avgWeek = average(week.map(x => x.asleep));
  const bars = week.map(x => {
    const tip = `${mdStr(x.r['Date'])} · ${t('asleepLabel')} ${fmtMin(x.asleep)}` + STAGES.map(([k]) => `\n${t('stage_' + k)}  ${fmtMin(x.s[k])}`).join('');
    const stack = STAGES.filter(([k]) => k !== 'awake').map(([k]) => x.s[k] ? `<span style="height:${toPx(x.s[k]).toFixed(1)}px; background:var(--sleep-${k})"></span>` : '').join('');
    return `<div class="sl-col" tabindex="0" data-tip="${escapeHtml(tip)}">${dense ? '' : `<div class="sl-val">${fmtMin(x.asleep)}</div>`}<div class="sl-stack">${stack}</div></div>`;
  }).join('');
  const grid = [4, 8].map(h => `<div class="sl-grid" style="bottom:${(h / maxH * H).toFixed(1)}px"><span>${h}h</span></div>`).join('');

  el.innerHTML = `
    <div class="health-verdict">${t('sleepHeadline').replace('{d}', mdStr(last['Date'])).replace('{t}', fmtMin(asleep))}${diffTxt ? `<span class="sub"> · ${diffTxt}</span>` : ''}</div>
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
    <div class="health-sub-title">${t('lastNNights').replace('{n}', week.length)}<span class="sub"> · ${t('avgAsleep')} ${fmtMin(avgWeek)}</span></div>
    ${trendLine(nights.map(r => stagesOf(r).asleep), fmtMin)}
    <div class="sl-chart" style="height:${H + 18}px">${grid}<div class="sl-cols${dense ? ' dense' : ''}">${bars}</div></div>
    <div class="sl-labels${dense ? ' dense' : ''}">${week.map((x, i) => `<span>${(week.length - 1 - i) % every ? '' : mdStr(x.r['Date'])}</span>`).join('')}</div>`;
}

/* ---- Vitals: last night vs. your own usual range (Apple Vitals style) ---- */
// good: which direction is better (+1 higher, -1 lower, 0 = neither; only stability matters)
// ref = general healthy-adult benchmark (fixed, sourced — not AI):
//   HRV: women aged 40–49, heart-rate-corrected RMSSD 10th–90th percentile 18.6–71.5 ms, median 35.8
//        (van den Berg et al. 2018, Front Physiol, corrigendum Table S5: https://pmc.ncbi.nlm.nih.gov/articles/PMC6839701/;
//        10-second ECG, not a nightly ring average — a rough benchmark only)
//   Resting HR: 60–100 bpm for adults (Mayo Clinic: https://www.mayoclinic.org/heart-rate/expert-answers/faq-20057979)
//   SpO2: nightly average 95–100% (Oura: https://support.ouraring.com/hc/en-us/articles/7328398760851)
//   Breathing rate: 12–20 /min for healthy adults (Oura: https://support.ouraring.com/hc/en-us/articles/360025443174)
//   Temperature deviation is relative to your own baseline by definition, so it has no population benchmark.
const VITALS = [
  { f: 'Avg HRV', key: 'vHrv', unit: 'ms', good: 1, floor: 2, dp: 0, ref: [18.6, 71.5] },
  { f: 'Avg Resting HR', key: 'vRhr', unit: 'bpm', good: -1, floor: 2, dp: 0, ref: [60, 100] },
  { f: 'Avg SpO2 %', key: 'vSpo2', unit: '%', good: 1, floor: 0.5, dp: 1, zeroIsMissing: true, ref: [95, 100] },
  { f: 'Avg Breath Rate', key: 'vBreath', unit: t => t('perMin'), good: 0, floor: 0.5, dp: 1, ref: [12, 20] },
  { f: 'Temperature Deviation', key: 'vTemp', unit: '°C', good: 0, floor: 0.2, dp: 2, signed: true }
];
// Usual range for night i = that metric's previous 30 nights, mean ± 1 SD (floored so a very steady metric doesn't flag noise).
function usualRange(xs, i, floor){
  const hist = xs.slice(Math.max(0, i - 30), i);
  if(hist.length < 5) return null;
  const m = average(hist), sd = Math.max(stddev(hist), floor);
  return { m, lo: m - sd, hi: m + sd };
}
function vitalSeries(v){
  return ouraRows.map(r => ({ d: r['Date'], x: num(r[v.f]) })).filter(p => p.x !== null && !(v.zeroIsMissing && p.x === 0));
}
// "+1 above / -1 below / 0 inside" the usual range for every night (null when there's no range yet)
function vitalFlags(v){
  const vals = vitalSeries(v), xs = vals.map(p => p.x);
  return vals.map((p, i) => { const u = usualRange(xs, i, v.floor); return { d: p.d, x: p.x, u, dir: !u ? null : p.x > u.hi ? 1 : p.x < u.lo ? -1 : 0 }; });
}
function sparkSVG(vals, u, worse, fmt){
  const W = 300, H = 46, xs = vals.map(p => p.x), all = [...xs, u.lo, u.hi];
  const min = Math.min(...all), max = Math.max(...all), pad = (max - min) * 0.12 || 1;
  const X = i => vals.length > 1 ? 4 + i / (vals.length - 1) * (W - 8) : W / 2, Y = x => H - 4 - (x - min + pad) / (max - min + 2 * pad) * (H - 8);
  const pts = vals.map((p, i) => `${X(i).toFixed(1)},${Y(p.x).toFixed(1)}`).join(' ');
  const last = vals[vals.length - 1];
  return `<svg class="vital-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${vals.length}">
    <rect x="0" y="${Y(u.hi).toFixed(1)}" width="${W}" height="${(Y(u.lo) - Y(u.hi)).toFixed(1)}" fill="var(--active-bg)"/>
    <polyline points="${pts}" fill="none" stroke="#9c978b" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${vals.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.x).toFixed(1)}" r="9" fill="transparent" data-tip="${mdStr(p.d)} · ${fmt(p.x)}"/>`).join('')}
    <line x1="${X(vals.length - 1).toFixed(1)}" y1="${Y(last.x).toFixed(1)}" x2="${X(vals.length - 1).toFixed(1)}" y2="${Y(last.x).toFixed(1)}" stroke="#fff" stroke-width="12" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line x1="${X(vals.length - 1).toFixed(1)}" y1="${Y(last.x).toFixed(1)}" x2="${X(vals.length - 1).toFixed(1)}" y2="${Y(last.x).toFixed(1)}" stroke="${worse ? 'var(--watch)' : 'var(--active)'}" stroke-width="9" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}
// Where last night sits against the general benchmark: a bar with the benchmark zone and your value.
function refStatus(v, x){ return !v.ref ? null : x < v.ref[0] ? -1 : x > v.ref[1] ? 1 : 0; }
const refText = v => v.ref.map(y => +y.toFixed(v.dp)).join('–'); // 95–100, not 95.0–100.0
function refHtml(v, x, fmt, unit){
  if(!v.ref) return `<div class="ref-row sub">${t('refNone')}</div>`;
  const [lo, hi] = v.ref, dir = refStatus(v, x), worse = dir !== 0 && (v.good === 0 || dir !== v.good);
  const span = hi - lo, min = Math.min(lo - span * 0.25, x), max = Math.max(hi + span * 0.25, x), pos = y => ((y - min) / (max - min) * 100).toFixed(1) + '%';
  const label = dir === 0 ? t('refIn') : t(dir < 0 ? 'refBelow' : 'refAbove');
  return `<div class="ref-row"><span class="ref-label">${t('refRange')} ${refText(v)} ${unit}</span>
    <span class="ref-track" data-tip="${t('refRange')} ${refText(v)} ${unit} · ${fmt(x)}"><span class="ref-band" style="left:${pos(lo)}; width:calc(${pos(hi)} - ${pos(lo)})"></span><span class="ref-dot${worse ? ' warn' : ''}" style="left:${pos(x)}"></span></span>
    <span class="${worse ? 'vital-warn' : 'vital-ok'}">${label}</span></div>`;
}
function renderOuraVitals(){
  const el = document.getElementById('ouraVitalsCard');
  const rows = VITALS.map(v => {
    const flags = vitalFlags(v);
    if(!flags.length) return '';
    const cur = flags[flags.length - 1], u = cur.u;
    const unit = typeof v.unit === 'function' ? v.unit(t) : v.unit;
    const fmt = x => (v.signed && x > 0 ? '+' : '') + x.toFixed(v.dp);
    const head = `<div class="vital-head"><span>${t(v.key)}</span><b>${fmt(cur.x)} <small>${unit}</small></b></div>`;
    if(!u) return `<div class="vital">${head}<div class="sub">${t('vitalNoBaseline')}</div></div>`;
    const dir = cur.dir, worse = dir !== 0 && (v.good === 0 || dir !== v.good);
    const status = dir === 0 ? `✓ ${t('vitalInRange')}` : `${dir > 0 ? '↑' : '↓'} ${t(dir > 0 ? 'vitalHigh' : 'vitalLow')}`;
    return `<div class="vital">${head}
      ${sparkSVG(flags.slice(-healthRange), u, worse, x => fmt(x) + ' ' + unit)}
      <div class="vital-foot"><span class="${worse ? 'vital-warn' : 'vital-ok'}">${status}</span><span class="sub">${t('usualRange')} ${fmt(u.lo)}–${fmt(u.hi)}</span></div>
      ${refHtml(v, cur.x, fmt, unit)}
      ${trendLine(flags.map(f => f.x), x => x.toFixed(v.dp) + ' ' + unit)}
      <div class="sub" style="font-size:11.5px;">${t(v.key + 'Desc')}</div>
    </div>`;
  }).join('');
  el.innerHTML = rows ? `<div class="sub" style="margin-bottom:8px;">${t('vitalsIntro')}</div>${rows}
    <div class="vital-legend sub"><span><i class="vital-band-key"></i>${t('usualRange')}</span><span><i class="ref-band-key"></i>${t('refRange')}</span><span><i class="vital-dot-key"></i>${t('lastNight')}</span></div>
    <div class="sub" style="font-size:11px; margin-top:6px;">${t('refSources')}</div>`
    : `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`;
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
  if(!days.length){ el.innerHTML = `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`; return; }
  const row = days[days.length - 1];
  const steps = num(row['Steps']) || 0, activeCal = num(row['Active Calories']) || 0;
  const week = days.slice(-7), maxS = Math.max(STEP_GOAL, ...week.map(r => num(r['Steps']) || 0)), H = 90;
  const hit = week.filter(r => (num(r['Steps']) || 0) >= STEP_GOAL).length;
  el.innerHTML = `
    <div class="sub" style="margin-bottom:6px;">${mdStr(row['Date'])}</div>
    <div style="display:flex; align-items:center; justify-content:space-around; flex-wrap:wrap; gap:12px;">
      <div style="text-align:center;">${ringSVG(steps / STEP_GOAL * 100, 110, 'var(--ring-activity)', t('goalPrefix') + STEP_GOAL)}
        <div class="card-meta" style="margin-top:4px;">${steps.toLocaleString()}${t('stepsSuffix')}</div></div>
      <div style="text-align:center;">${ringSVG(activeCal / ACTIVE_CAL_GOAL * 100, 110, 'var(--ring-activity)', t('activeCalLabel'))}
        <div class="card-meta" style="margin-top:4px;">${activeCal} / ${ACTIVE_CAL_GOAL} kcal</div></div>
    </div>
    <div class="health-sub-title">${t('steps7d')}<span class="sub"> · ${t('goalHitDays').replace('{n}', hit).replace('{m}', week.length)}</span></div>
    <div class="sl-chart" style="height:${H + 18}px">
      <div class="sl-grid goal" style="bottom:${(STEP_GOAL / maxS * H).toFixed(1)}px"><span>${STEP_GOAL}</span></div>
      <div class="sl-cols">${week.map(r => { const v = num(r['Steps']) || 0; return `<div class="sl-col" tabindex="0" data-tip="${mdStr(r['Date'])} · ${v.toLocaleString()}${t('stepsSuffix')}">
        <div class="sl-stack"><span style="height:${Math.max(2, v / maxS * H).toFixed(1)}px; background:var(--ring-activity)"></span></div></div>`; }).join('')}</div>
    </div>
    <div class="sl-labels">${week.map(r => `<span>${mdStr(r['Date'])}</span>`).join('')}</div>`;
}

/* ---- Page status: read failure / data freshness, range switch, tab badge ---- */
let healthRange = (() => { try{ return +localStorage.getItem('health-range') || 7; }catch(e){ return 7; } })();
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function ouraAge(){ return ouraRows.length ? dayDiff(ouraRows[ouraRows.length - 1]['Date'], todayStr(0)) : null; }
function healthNeedsAttention(){ return ouraStatus === 'failed' || (ouraStatus === 'ok' && ouraAge() >= 2); }
function updateHealthBadge(){
  const el = document.getElementById('tab-health');
  if(el) el.textContent = t('tabHealth') + (healthNeedsAttention() ? ' ⚠️' : '');
}
function renderHealthStatus(){
  const el = document.getElementById('healthStatus'), age = ouraAge();
  el.innerHTML = ouraStatus === 'failed'
    ? `<div class="health-status bad">${t('ouraReadFailed')} <button class="chip btn-sm" onclick="renderHealthOverview()">${t('retry')}</button></div>`
    : age >= 2 ? `<div class="health-status warn">${t('dataStale').replace('{n}', age).replace('{d}', mdStr(ouraRows[ouraRows.length - 1]['Date']))}</div>`
    : ouraRows.length ? `<span class="sub">${t('dataAsOf').replace('{d}', mdStr(ouraRows[ouraRows.length - 1]['Date']))}</span>` : '';
  document.getElementById('healthRange').innerHTML = [7, 30, 90].map(n =>
    `<button class="chip btn-sm${n === healthRange ? ' on' : ''}" onclick="setHealthRange(${n})">${t('rangeN').replace('{n}', n)}</button>`).join('');
  updateHealthBadge();
}
function setHealthRange(n){
  healthRange = n; try{ localStorage.setItem('health-range', n); }catch(e){}
  renderHealthStatus(); renderOuraSleep(); renderOuraVitals(); renderStressRecovery();
}
// "Last N vs the N before" — only when the earlier window is at least half full, otherwise say nothing.
function trendLine(xs, fmt){
  const n = healthRange, cur = xs.slice(-n), prev = xs.slice(-2 * n, -n);
  if(cur.length < n / 2 || prev.length < n / 2) return '';
  const a = average(cur), b = average(prev), d = a - b;
  const txt = Math.abs(d) <= Math.abs(b) * 0.02 ? t('trendSame').replace('{n}', n)
    : t('trendVs').replace('{n}', n).replace('{v}', `${d > 0 ? '↑' : '↓'} ${fmt(Math.abs(d))}`);
  return `<div class="trend-line">${txt}</div>`;
}

/* ---- Alerts: patterns over several nights, by fixed rules (no AI) ---- */
function streakOf(flags, want){ let n = 0; for(let i = flags.length - 1; i >= 0 && flags[i].dir === want; i--) n++; return n; }
function healthAlerts(){
  const out = [], F = {}; VITALS.forEach(v => F[v.key] = vitalFlags(v));
  const latest = ouraRows.length ? ouraRows[ouraRows.length - 1]['Date'] : null;
  const off = [['vHrv', -1], ['vRhr', 1], ['vTemp', 1], ['vBreath', 1]].filter(([k, d]) => { const f = F[k][F[k].length - 1]; return f && f.d === latest && f.dir === d; });
  if(off.length >= 2) out.push(['bad', t('alertCombo').replace('{list}', off.map(([k]) => t(k)).join(t('listSep')))]);
  [['vHrv', -1, 3, 'alertHrvLow'], ['vRhr', 1, 3, 'alertRhrHigh'], ['vTemp', 1, 2, 'alertTempHigh']].forEach(([k, d, min, key]) => {
    const n = streakOf(F[k], d); if(n >= min) out.push(['warn', t(key).replace('{n}', n)]);
  });
  VITALS.filter(v => v.ref).forEach(v => {
    const xs = F[v.key].slice(-7).map(f => f.x); if(xs.length < 5) return;
    const a = average(xs), dir = refStatus(v, a);
    const unit = typeof v.unit === 'function' ? v.unit(t) : v.unit;
    if(dir !== 0 && (v.good === 0 || dir !== v.good)) out.push(['warn', t(dir < 0 ? 'alertRefLow' : 'alertRefHigh').replace('{m}', t(v.key)).replace('{v}', `${a.toFixed(v.dp)} ${unit}`)
      .replace('{r}', `${refText(v)} ${unit}`)]);
  });
  const nights = ouraRows.filter(r => num(r['Total Sleep (min)'])).slice(-5), short = nights.filter(r => num(r['Total Sleep (min)']) < 360).length;
  if(nights.length >= 3 && short >= 3) out.push(['warn', t('alertShortSleep').replace('{n}', short).replace('{m}', nights.length)]);
  const sr = stressRows(); let sn = 0;
  for(let i = sr.length - 1; i >= 0 && sr[i].st >= 60 && sr[i].st >= 2 * sr[i].rc; i--) sn++;
  if(sn >= 3) out.push(['warn', t('alertStress').replace('{n}', sn)]);
  return out;
}
function renderHealthAlerts(){
  const list = ouraStatus === 'ok' ? healthAlerts() : [];
  document.getElementById('healthAlerts').innerHTML = list.length ? `<div class="health-alerts">
    <div class="attn-head">${t('alertsTitle')} (${list.length})</div>
    ${list.map(([lvl, txt]) => `<div class="health-alert ${lvl}">${lvl === 'bad' ? '🔴' : '🟠'} ${escapeHtml(txt)}</div>`).join('')}</div>` : '';
}

/* ---- Stress vs recovery (Oura daytime stress) ---- */
function stressRows(){
  return ouraRows.filter(r => (r['Stress High (min)'] || '') !== '').map(r => ({ d: r['Date'], st: num(r['Stress High (min)']) || 0, rc: num(r['Recovery High (min)']) || 0 }));
}
function renderStressRecovery(){
  const el = document.getElementById('ouraStressCard'), rows = stressRows();
  if(!rows.length){ el.innerHTML = `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`; return; }
  const last = rows[rows.length - 1], tot = last.st + last.rc || 1;
  const verdict = last.st >= 2 * last.rc && last.st >= 60 ? 'stressHeavy' : last.rc >= last.st ? 'stressBalanced' : 'stressMild';
  const win = rows.slice(-healthRange), dense = win.length > 10, every = Math.ceil(win.length / 8);
  const max = Math.max(60, ...win.map(x => Math.max(x.st, x.rc))), H = 54;
  const sum = k => win.reduce((a, x) => a + x[k], 0);
  el.innerHTML = `
    <div class="health-verdict">${t(verdict)}</div>
    <div class="sr-split"><span style="flex:${last.st || 0.001}; background:var(--stress)"></span><span style="flex:${last.rc || 0.001}; background:var(--recovery)"></span></div>
    <div class="sr-legend"><span><i style="background:var(--stress)"></i>${t('stressLabel')} <b>${fmtMin(last.st)}</b></span><span><i style="background:var(--recovery)"></i>${t('recoveryLabel')} <b>${fmtMin(last.rc)}</b></span><span class="sub">${mdStr(last.d)}</span></div>
    <div class="health-sub-title">${t('lastNDays').replace('{n}', win.length)}<span class="sub"> · ${t('stressTotals').replace('{s}', fmtMin(sum('st'))).replace('{r}', fmtMin(sum('rc')))}</span></div>
    <div class="sr-chart${dense ? ' dense' : ''}">${win.map(x => `<div class="sr-col" tabindex="0" data-tip="${mdStr(x.d)}\n${t('stressLabel')} ${fmtMin(x.st)}\n${t('recoveryLabel')} ${fmtMin(x.rc)}">
      <div class="sr-up"><span style="height:${(x.st / max * H).toFixed(1)}px"></span></div><div class="sr-down"><span style="height:${(x.rc / max * H).toFixed(1)}px"></span></div></div>`).join('')}</div>
    <div class="sl-labels${dense ? ' dense' : ''}">${win.map((x, i) => `<span>${(win.length - 1 - i) % every ? '' : mdStr(x.d)}</span>`).join('')}</div>
    <div class="sub" style="font-size:11.5px; margin-top:6px;">${t('stressDesc')}</div>`;
}

/* ---- Work hours (daily log) vs next-morning readiness ---- */
// shortcut: plain bucket averages, no control for sleep/weekday etc.; upgrade to a regression once there are months of paired days.
const WORK_BUCKETS = [[0, 3, 'workLess3'], [3, 6, 'work3to6'], [6, Infinity, 'work6plus']];
function renderWorkRecovery(){
  const el = document.getElementById('ouraWorkCard');
  if(ouraStatus !== 'ok'){ el.innerHTML = `<div class="empty">${t(ouraStatus === 'failed' ? 'ouraCardFailed' : 'ouraNoData')}</div>`; return; }
  const pairs = ouraRows.map(r => {
    const ready = num(r['Readiness Score']); if(ready === null) return null;
    const prev = new Date(r['Date'] + 'T00:00:00'); prev.setDate(prev.getDate() - 1);
    const e = dailyLog.entries[fmtDate(prev.getTime())], h = e ? Object.values(e.hours || {}).reduce((a, b) => a + b, 0) : 0;
    return h > 0 ? { h, ready } : null; // days with nothing logged are unknown, not "zero work"
  }).filter(Boolean);
  if(pairs.length < 6){ el.innerHTML = `<div class="sub">${t('workNotEnough').replace('{n}', pairs.length)}</div>`; return; }
  const groups = WORK_BUCKETS.map(([lo, hi, key]) => { const g = pairs.filter(p => p.h >= lo && p.h < hi); return { key, n: g.length, avg: g.length ? average(g.map(p => p.ready)) : null }; });
  const light = groups[0], heavy = groups[2];
  const result = light.n >= 3 && heavy.n >= 3
    ? t('workResult').replace('{h}', Math.round(heavy.avg)).replace('{d}', Math.abs(Math.round(light.avg - heavy.avg))).replace('{dir}', t(heavy.avg <= light.avg ? 'lower' : 'higher'))
    : t('workNeedMore');
  el.innerHTML = `<div class="health-verdict">${result}</div>
    ${groups.map(g => `<div class="hbar" data-tip="${t(g.key)} · ${t('workDays').replace('{n}', g.n)} · ${t('ringReady')} ${g.avg === null ? '–' : Math.round(g.avg)}">
      <span>${t(g.key)} <span class="sub">· ${t('workDays').replace('{n}', g.n)}</span></span><span class="hbar-val">${g.avg === null ? '–' : Math.round(g.avg)}</span>
      <div class="hbar-track"><span style="width:${g.avg ?? 0}%; background:var(--ring-ready)"></span></div></div>`).join('')}
    <div class="sub" style="font-size:11.5px; margin-top:6px;">${t('workDesc').replace('{n}', pairs.length)}</div>`;
}

let ouraAnalysisRows = [];
let ouraAnalysisFailed = false;
async function loadOuraAnalysis(){
  try{
    const res = await fetchWithTimeout(OURA_ANALYSIS_CSV_URL, 6000);
    if(!res.ok) throw new Error('bad response');
    ouraAnalysisRows = parseCSV(await res.text());
    ouraAnalysisFailed = false;
  }catch(e){ console.error('oura analysis fetch failed', e); ouraAnalysisRows = []; ouraAnalysisFailed = true; }
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
  if(!latest){ el.innerHTML = tabsHtml + `<div class="empty">${t(ouraAnalysisFailed ? 'aiReadFailed' : 'aiNoData')}</div>`; return; }
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
