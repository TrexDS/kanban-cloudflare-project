let state = { tasks: [], items: [], lastCheckin: null }; // tasks = Projects (legacy name kept for rollback), items = Tasks
let pipeline = { companies: [], contacts: [] };
let dailyLog = { entries: {} }; // entries[date] = { hours: {taskId: h}, note: '' }
let checkinQueue = [];
let checkinIndex = 0;

const seedTasks = [
  { title: "找工作：投简历 + 面试准备", notes: "目标：Finance Systems/Transformation Manager 岗位；每天早上1h看新岗位，面试出现时3-4h准备分两天。公司级进度见「求职明细」页。", column: "active" },
  { title: "告别视频（Mario 像素风）", notes: "目标完成日 9/9。每天3h深耕，40小时预算。", column: "active", budgetHours: 40, deadline: "2026-09-09" },
  { title: "在 Anthropic 生态学习 AI", notes: "持续学习 + 对外做 LLM / vibe coding 分享。", column: "active" },
  { title: "Renisa App 开发（塔罗）", notes: "已上线，产品迭代阶段；持续小步推进，给LinkedIn供素材。", column: "active" },
  { title: "Wealthbuildconstruction 大管家", notes: "周六审年报+签字发回；每周问一下tendering进度。", column: "active" },
  { title: "Corise 平台品牌建立与推广", notes: "暂无外部deadline，先搁置", column: "watch" },
  { title: "AI 短剧制作（职场规则怪谈）", notes: "TikTok 短剧系列，角色设定已定。先搁置", column: "watch" },
  { title: "Westfield 停车场撞车理赔", notes: "对接 Navi Brar；周一跟进邮件。", column: "active" },
  { title: "LinkedIn 活跃度维护", notes: "ANZCAA+个人号，持续到拿到offer为止。cold outreach进度见「求职明细」页。", column: "active" }
];

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayStr(offset){
  offset = offset || 0;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

async function kvGet(key){
  const res = await fetch('/api/storage/' + encodeURIComponent(key));
  if(!res.ok) throw new Error('kv get failed');
  const text = await res.text();
  kvRevs[key] = res.headers.get('ETag'); // 保存时带回这个版本号，云端已被别处改过就会被拒（409）
  return text === 'null' ? null : JSON.parse(text);
}
const kvRevs = {};
const kvChains = {};
// 同一个 key 的保存排队执行：上一次返回新版本号后再发下一次，否则同一页面连续两次保存会互相冲突。
// 返回 true（成功）/ false（可重试的失败）/ 'conflict'（云端已被其他设备或标签页改过）。
function kvSet(key, value){
  const run = async () => {
    const res = await fetch('/api/storage/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'If-Match': kvRevs[key] || '"0"' },
      body: JSON.stringify(value)
    });
    if(res.status === 409) return 'conflict';
    if(res.ok) kvRevs[key] = res.headers.get('ETag');
    return res.ok;
  };
  const p = (kvChains[key] || Promise.resolve()).then(run, run);
  kvChains[key] = p.catch(() => {});
  return p;
}

// 带重试的读取：网络抖动时不放弃，避免用空壳数据静默覆盖云端真实数据。
// 三次都失败时抛出异常，由调用方决定如何处理（而不是默默当成"没有数据"）。
async function kvGetWithRetry(key, attempts){
  attempts = attempts || 3;
  let lastErr;
  for(let i=0; i<attempts; i++){
    try{
      return await kvGet(key);
    }catch(e){
      lastErr = e;
      if(i < attempts-1) await sleep(600);
    }
  }
  throw lastErr;
}

let stateLoadFailed = false;
let dailyLoadFailed = false;
let pipelineLoadFailed = false;

let awaitingSeedConfirm = false; // KV 读到空时，先展示种子任务但不保存，等用户明确点确认

async function loadState(){
  try{
    const val = await kvGetWithRetry(STORAGE_KEY);
    if(val){
      state = val;
      state.items = state.items || []; // docs saved before the Project/Task split have no items
    } else {
      // KV 里确实没有数据（可能是首次使用，也可能是异常情况）。
      // 只在界面上先"展示"一份初始模板，绝不在这里自动 saveState()——
      // 避免任何读到空值的情况（哪怕只是短暂的）悄悄把真实数据冲掉。
      state.tasks = seedTasks.map(t => ({ id: uid(), ...t, updatedAt: Date.now() }));
      awaitingSeedConfirm = true;
      showSeedConfirmBanner();
    }
  }catch(e){
    console.error('kanban load failed after retries', e);
    showToast('加载看板数据失败，请检查网络后刷新重试');
    // 看板主数据都没读成功，求职明细/打卡记录这两个 key 根本不会走到下面的读取，
    // 但对应的 xxxLoadFailed 之前一直保持默认的 false——导致后续如果用户照样点了
    // "打卡"，saveDaily() 的守卫形同虚设，会直接拿本地还没同步的空壳数据覆盖云端。
    // 这里必须显式把两个守卫都标记为失败，堵住这个数据覆盖的口子。
    stateLoadFailed = true;
    pipelineLoadFailed = true;
    dailyLoadFailed = true;
    render(); renderPipeline(); renderDaily(); renderDashboard();
    return; // 不要用种子数据覆盖保存，直接停止，避免后续任何保存动作把云端数据冲掉
  }
  try{
    const val2 = await kvGetWithRetry(PIPELINE_KEY);
    if(val2){ pipeline = val2; }
  }catch(e){
    pipelineLoadFailed = true;
    console.error('pipeline load failed after retries', e);
    showToast('求职明细加载失败，请检查网络后刷新重试');
  }
  try{
    const val3 = await kvGetWithRetry(DAILY_KEY);
    if(val3){ dailyLog = val3; }
  }catch(e){
    dailyLoadFailed = true;
    console.error('daily log load failed after retries', e);
    showToast('打卡记录加载失败，请检查网络后刷新重试');
  }
  render();
  renderPipeline();
  renderDaily();
  renderDashboard();
}

function showSeedConfirmBanner(){
  const bar = document.createElement('div');
  bar.id = 'seedConfirmBanner';
  bar.style.cssText = 'position:sticky; top:0; z-index:50; background:var(--warn-bg); border-bottom:1px solid #efd3cf; padding:10px 14px; font-size:13.5px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;';
  bar.innerHTML = `<span>⚠️ 云端看板数据是空的——如果这不是你第一次用，先别急着操作，可能是数据异常，建议先联系确认原因。下面显示的是一套示例任务，尚未保存。</span>
    <button class="chip btn-sm" onclick="confirmUseSeedTasks()">确认用这套开始（会保存）</button>`;
  document.body.prepend(bar);
}
async function confirmUseSeedTasks(){
  awaitingSeedConfirm = false;
  const bar = document.getElementById('seedConfirmBanner');
  if(bar) bar.remove();
  await saveState();
  showToast('已保存');
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function trySave(key, dataObj, label){
  for(let attempt=0; attempt<3; attempt++){
    try{
      const ok = await kvSet(key, dataObj);
      if(ok === 'conflict'){
        // 不重试、不覆盖：刷新会拿到云端最新版本，本页这次的改动不会保存
        showToast('云端数据已在其他设备/标签页更新，这次修改没有保存，请刷新页面后再改');
        return false;
      }
      if(ok) return true;
    }catch(e){
      console.error(label+' save attempt '+(attempt+1)+' failed', e);
    }
    if(attempt<2) await sleep(600);
  }
  showToast('保存失败，请检查网络后重试');
  return false;
}

async function saveState(){
  // 主看板没加载成功时内存里是空的默认 state，保存会把云端整份看板覆盖成空壳
  if(stateLoadFailed){ showToast('看板还没加载成功，暂不保存，请先刷新页面'); return false; }
  return trySave(STORAGE_KEY, state, 'kanban');
}
async function savePipeline(){
  if(pipelineLoadFailed){ showToast('求职明细还没加载成功，暂不保存，请先刷新页面'); return false; }
  return trySave(PIPELINE_KEY, pipeline, 'pipeline');
}
async function saveDaily(date){
  if(dailyLoadFailed){ showToast('打卡记录还没加载成功，暂不保存，请先刷新页面'); return false; }
  const ok = await trySave(DAILY_KEY, dailyLog, 'daily');
  if(ok) syncDailyLogToSheet(date || todayStr(0)); // 不阻塞、不影响主流程；同步失败只在控制台报错，不打扰使用
  return ok;
}

// 把"今天"这一条打卡记录同步到 Google Sheet，任务ID换成可读的任务标题。
// 走同源的 /api/kanban/sync 代理（真正的 Apps Script URL/密钥只在 Cloudflare 那一侧），
// 用 keepalive 发送：页面切走/关闭也不会中断这次请求，不阻塞主流程。
function syncDailyLogToSheet(date){
  const entry = dailyLog.entries[date];
  if(!entry) return;
  const hoursByTitle = {};
  Object.keys(entry.hours).forEach(taskId => {
    const task = state.tasks.find(t => t.id === taskId);
    const label = task ? task.title : taskId;
    if(entry.hours[taskId] > 0) hoursByTitle[label] = entry.hours[taskId];
  });
  const payload = {
    date: date,
    hours: hoursByTitle,
    note: entry.note || '',
    syncedAt: new Date().toISOString()
  };
  fetch(KANBAN_SYNC_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(e => console.error('daily log sheet sync failed', e));
}

function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function switchTab(name){
  ['kanban','tasks','pipeline','daily','health','dash'].forEach(n => {
    document.getElementById('tab-'+n).classList.toggle('on', n===name);
    document.getElementById('view-'+n).classList.toggle('on', n===name);
  });
  if(name==='dash') renderDashboard();
  if(name==='daily') renderDaily();
  if(name==='health') renderHealthOverview();
}
