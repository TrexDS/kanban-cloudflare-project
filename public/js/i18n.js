const STORAGE_KEY = 'thread-kanban-data';
const PIPELINE_KEY = 'job-pipeline-data';
const DAILY_KEY = 'daily-log-data';

// 实时同步打卡记录到 Google Sheet：走同源的 /api/kanban/sync 代理，
// 真正的 Apps Script URL 和密钥只存在 Cloudflare Pages 的环境变量里，不会出现在这份客户端 JS 里。
const KANBAN_SYNC_PROXY_URL = '/api/kanban/sync';

/* ---- i18n ---- */
let LANG = (function(){ try{ return localStorage.getItem('kanban-lang') || 'zh'; }catch(e){ return 'zh'; } })();
const I18N = {
  zh: {
    appTitle: '🗂️ 多线程任务看板', pageTitle: '多线程任务看板',
    loading: '加载中…',
    lastCheckinPrefix: '上次确认：', neverCheckedIn: '还没有做过每周确认',
    tabKanban: '宏观看板', tabTasks: '任务', allProjects: '全部 Project', tabPipeline: '求职明细', tabDaily: '今日打卡', tabHealth: '健康总览', tabDash: 'Dashboard',
    btnStartCheckin: '开始每周确认', btnAddThread: '+ 新增线程',
    formTitleAdd: '新增线程', formTitleEdit: '编辑线程',
    placeholderThreadName: '线程名称，例如：面签复审', placeholderNotesOptional: '备注（可选）',
    btnSave: '保存', btnCancel: '取消',
    chipEdit: '编辑', chipDelete: '删除',
    emptyNone: '— 暂无 —',
    metaUpdatedPrefix: '更新于 ',
    toastUpdated: '已更新', toastDeleted: '已删除', toastAdded: '已新增', toastSaved: '已保存',
    toastNeedThreadName: '请输入线程名称', toastNeedCompanyName: '请输入公司名称', toastNeedContactInfo: '请输入联系人信息',
    toastSaveFailed: '保存失败，请检查网络后重试', toastNoThreadsToCheck: '没有需要确认的线程', toastCheckinDone: '本周确认完成 ✅',
    pipelineIntro: '这里是随时更新的执行细节，不进每周确认流程。',
    pipelineCompaniesTitle: '📋 求职申请 / 面试进度', btnAddCompany: '+ 新增申请',
    placeholderCompanyName: '公司名称', placeholderCompanyNotes: '备注，例如下一步动作/截止日期',
    pipelineContactsTitle: '🤝 Cold Outreach / 人脉联系', btnAddContact: '+ 新增联系人',
    placeholderContactName: '姓名 / 公司 / 职位', placeholderNotes: '备注',
    stageApplied: '已投递', stageScreen: '初筛/电话面', stageInterview: '面试中', stageFinal: '终面', stageOffer: 'Offer', stageRejected: '已拒 / 结束',
    stageContacted: '已发送消息', stageReplied: '已回复', stageMeeting: '已约见 / 通话', stageNoresponse: '无回应',
    dailyIntro: '把今天的时间记到具体任务上；没有对应任务的记到「其他」。项目时间 = 各任务时间之和。',
    dailyNoteTitle: '📝 今日备注', placeholderDailyNote: '今天大概做了什么（可选）',
    dailyEmptyActive: '目前没有可打卡的项目（探索中 / 推进中 / 维护中）',
    tagArchived: '（已归档）', tagWatch: '（已搁置）',
    healthOverviewTitle: '💍 健康总览（Oura）', healthTrendTitle: '📈 关键趋势（HRV / 静息心率）',
    healthActivityTitle: '🏃 昨日活动', healthAiTitle: '🧠 AI 健康解读',
    ouraLoadFailed: '加载失败，或还未配置 Oura 数据源',
    radarRefNote: '虚线圈 = 80分参考线',
    dimSleep: '离线充能', dimReadiness: '基础回血', dimActivity: '物理输出', dimStress: '抗造血条', dimSpo2: '进气效率',
    statePrefix: '状态：',
    resLimited: '濒危', resAdequate: '凑合', resSolid: '耐刷', resStrong: '强化', resExceptional: '满状态',
    noDataShort: '暂无数据', scoreSuffix: '分',
    bandOptimal: '优秀', bandGood: '良好', bandFair: '一般', bandAttention: '需关注',
    trend7d: '7天', trend14d: '14天', trendInsufficientData: '数据不足，暂无法绘制趋势',
    legendHrv: '平均HRV', legendRhr: '静息心率', trendBaselineNote: '虚线 = 个人历史均值基准',
    batteryHigh: '电量充沛', batteryMid: '电量持平', batteryLow: '电量偏低',
    batteryHighDesc: '恢复充分，今天可以安排更高强度的投入。',
    batteryMidDesc: '身体状态平稳，维持日常节奏即可。',
    batteryLowDesc: '交感神经仍有负荷，建议放慢节奏、避免高强度消耗。',
    avgLabel: '均值', todayStatusPrefix: '今日状态：',
    viewRawData: '查看原始 HRV / 心率曲线',
    stepsSuffix: '步', goalPrefix: '目标', activeCalLabel: '活动消耗', goalKcalPrefix: '目标',
    aiDetailsSummary: '诊断详情', aiWarnings: '⚠️ 异常预警', aiActions: '✅ 行动建议',
    periodDay: '昨日', periodWeek: '本周', periodMonth: '本月', aiNoData: '暂无数据，或还未配置数据源',
    farewellProgressSuffix: ' 进度', investedLabel: '已投入', budgetLabel: '预算',
    weeklyEmpty: '还没有打卡记录',
    funnelTitle: '🎯 求职漏斗',
    logUnassigned: '其他（不指定任务）', todayShort: '今天', totalShort: '累计',
    weeksTitle: '📊 每周投入（近 12 周）', accTitle: '📈 累计投入', accTotal: '总计', accByProject: '按项目', accUntil: '截至', otherProjects: '其他项目', weekOf: '周',
    projTotalTitle: '⏱️ 项目累计投入', unassignedTask: '未指定任务', topTasksTitle: '🔥 最费时的任务', topTasksEmpty: '还没有记到任务上的时间',
    kpiHours: '本周投入', kpiDoing: '进行中任务', kpiWaiting: '等待 / 受阻', kpiDone: '本周完成', segTodo: '待办',
    progressTitle: '🧭 项目推进', progressEmpty: '没有进行中的项目', noTasksYet: '还没有任务',
    needAttn: '⚠️ 需要处理', onTrack: '✅ 正常推进', allOnTrack: '所有项目都在推进 👍',
    issueStale: n => `${n} 天没动静`, issueNever: '还没有任何记录', issueWaiting: (x, n) => `「${x}」等待了 ${n} 天`, issueNoDoing: '没有进行中的任务',
    actAddTask: '加任务', actHold: '改为搁置', actOpenTasks: '去任务',
    doneTitle: '✅ 本周完成', doneEmpty: '这周还没有完成的任务',
    modalTitle: '每周确认', modalContinue: '继续推进', modalHold: '先搁置', modalDone: '已完成 / 归档', modalSkip: '跳过这条',
    modalNotePlaceholder: '这周的进展 / 备注（可选，会追加到这条线程）',
    lcExploring: '探索中', lcActive: '推进中', lcOnHold: '搁置', lcMaintaining: '维护中', lcArchived: '已归档',
    lcExploringDesc: '还在试水，没决定要不要投入', lcActiveDesc: '当前主力投入', lcMaintainingDesc: '已成型，定期少量投入', lcOnHoldDesc: '暂停，以后可能恢复', lcArchivedDesc: '已结束',
    tsInbox: '收件箱', tsBacklog: '待排', tsReady: '可开始', tsDoing: '进行中', tsWaiting: '等待 / 受阻', tsDone: '完成',
    tasksSummary: '任务', placeholderNewTask: '新任务…', btnAdd: '添加',
    appNoProject: '未关联 Project', appPickProject: '先关联一个 Project 再添加任务'
  },
  en: {
    appTitle: '🗂️ Multi-Thread Task Board', pageTitle: 'Multi-Thread Task Board',
    loading: 'Loading…',
    lastCheckinPrefix: 'Last check-in: ', neverCheckedIn: 'No weekly check-in yet',
    tabKanban: 'Board', tabTasks: 'Tasks', allProjects: 'All projects', tabPipeline: 'Job Pipeline', tabDaily: 'Daily Log', tabHealth: 'Health Overview', tabDash: 'Dashboard',
    btnStartCheckin: 'Start Weekly Check-in', btnAddThread: '+ Add Thread',
    formTitleAdd: 'Add Thread', formTitleEdit: 'Edit Thread',
    placeholderThreadName: 'Thread name, e.g. Visa interview follow-up', placeholderNotesOptional: 'Notes (optional)',
    btnSave: 'Save', btnCancel: 'Cancel',
    chipEdit: 'Edit', chipDelete: 'Delete',
    emptyNone: '— None —',
    metaUpdatedPrefix: 'Updated ',
    toastUpdated: 'Updated', toastDeleted: 'Deleted', toastAdded: 'Added', toastSaved: 'Saved',
    toastNeedThreadName: 'Please enter a thread name', toastNeedCompanyName: 'Please enter a company name', toastNeedContactInfo: 'Please enter contact info',
    toastSaveFailed: 'Save failed, please check your connection', toastNoThreadsToCheck: 'No threads to check in on', toastCheckinDone: 'Weekly check-in complete ✅',
    pipelineIntro: 'Fine-grained progress you update anytime — not part of the weekly check-in flow.',
    pipelineCompaniesTitle: '📋 Applications / Interview Progress', btnAddCompany: '+ Add Application',
    placeholderCompanyName: 'Company name', placeholderCompanyNotes: 'Notes, e.g. next step / deadline',
    pipelineContactsTitle: '🤝 Cold Outreach / Contacts', btnAddContact: '+ Add Contact',
    placeholderContactName: 'Name / company / role', placeholderNotes: 'Notes',
    stageApplied: 'Applied', stageScreen: 'Screening / Phone', stageInterview: 'Interviewing', stageFinal: 'Final Round', stageOffer: 'Offer', stageRejected: 'Rejected / Closed',
    stageContacted: 'Message Sent', stageReplied: 'Replied', stageMeeting: 'Meeting Scheduled', stageNoresponse: 'No Response',
    dailyIntro: 'Log today’s time on specific tasks; anything else goes to “Other”. Project time = sum of its tasks.',
    dailyNoteTitle: '📝 Today’s Notes', placeholderDailyNote: 'What did you work on today (optional)',
    dailyEmptyActive: 'No projects to log (Exploring / Active / Maintaining)',
    tagArchived: ' (archived)', tagWatch: ' (on hold)',
    healthOverviewTitle: '💍 Health Overview (Oura)', healthTrendTitle: '📈 Trends (HRV / Resting HR)',
    healthActivityTitle: '🏃 Yesterday’s Activity', healthAiTitle: '🧠 AI Health Insight',
    ouraLoadFailed: 'Failed to load, or Oura data source not configured',
    radarRefNote: 'Dashed ring = 80-point reference line',
    dimSleep: 'Offline Charge', dimReadiness: 'Base Regen', dimActivity: 'Physical Output', dimStress: 'Damage Buffer', dimSpo2: 'Intake Efficiency',
    statePrefix: 'Status: ',
    resLimited: 'Critical', resAdequate: 'Stable', resSolid: 'Grindable', resStrong: 'Buffed', resExceptional: 'Full HP',
    noDataShort: 'No data', scoreSuffix: ' pts',
    bandOptimal: 'Optimal', bandGood: 'Good', bandFair: 'Fair', bandAttention: 'Pay Attention',
    trend7d: '7d', trend14d: '14d', trendInsufficientData: 'Not enough data to chart a trend yet',
    legendHrv: 'Avg HRV', legendRhr: 'Resting HR', trendBaselineNote: 'Dashed line = personal historical average',
    batteryHigh: 'Well Charged', batteryMid: 'Steady', batteryLow: 'Low Battery',
    batteryHighDesc: 'Well recovered — a good day to push harder.',
    batteryMidDesc: 'Steady state — stick to your normal pace.',
    batteryLowDesc: 'Nervous system still under load — ease up and avoid high-intensity efforts.',
    avgLabel: 'avg', todayStatusPrefix: 'Today: ',
    viewRawData: 'View raw HRV / resting HR data',
    stepsSuffix: ' steps', goalPrefix: 'Goal ', activeCalLabel: 'Active Calories', goalKcalPrefix: 'Goal',
    aiDetailsSummary: 'Diagnosis Details', aiWarnings: '⚠️ Anomaly Warnings', aiActions: '✅ Recommended Actions',
    periodDay: 'Yesterday', periodWeek: 'This Week', periodMonth: 'This Month', aiNoData: 'No data yet, or data source not configured',
    farewellProgressSuffix: ' Progress', investedLabel: 'Invested', budgetLabel: 'Budget',
    weeklyEmpty: 'No hours logged yet',
    funnelTitle: '🎯 Job Funnel',
    logUnassigned: 'Other (no task)', todayShort: 'Today', totalShort: 'Total',
    weeksTitle: '📊 Hours per week (last 12)', accTitle: '📈 Accumulated hours', accTotal: 'Total', accByProject: 'By project', accUntil: 'As of', otherProjects: 'Other projects', weekOf: 'Week of',
    projTotalTitle: '⏱️ Total hours by project', unassignedTask: 'No task', topTasksTitle: '🔥 Most time-consuming tasks', topTasksEmpty: 'No time logged on tasks yet',
    kpiHours: 'Hours this week', kpiDoing: 'Tasks in progress', kpiWaiting: 'Waiting / blocked', kpiDone: 'Done this week', segTodo: 'To do',
    progressTitle: '🧭 Project Progress', progressEmpty: 'No projects in progress', noTasksYet: 'No tasks yet',
    needAttn: '⚠️ Needs attention', onTrack: '✅ On track', allOnTrack: 'Every project is moving 👍',
    issueStale: n => `No activity for ${n} days`, issueNever: 'Nothing logged yet', issueWaiting: (x, n) => `"${x}" waiting for ${n} days`, issueNoDoing: 'No task in progress',
    actAddTask: 'Add task', actHold: 'Put on hold', actOpenTasks: 'Open tasks',
    doneTitle: '✅ Done This Week', doneEmpty: 'Nothing finished this week yet',
    modalTitle: 'Weekly Check-in', modalContinue: 'Keep Going', modalHold: 'Put on Hold', modalDone: 'Done / Archive', modalSkip: 'Skip',
    modalNotePlaceholder: 'This week’s progress / notes (optional, appended to this thread)',
    lcExploring: 'Exploring', lcActive: 'Active', lcOnHold: 'On Hold', lcMaintaining: 'Maintaining', lcArchived: 'Archived',
    lcExploringDesc: 'Trying it out, not committed yet', lcActiveDesc: 'Main focus right now', lcMaintainingDesc: 'Established, light regular upkeep', lcOnHoldDesc: 'Paused, may resume later', lcArchivedDesc: 'Finished',
    tsInbox: 'Inbox', tsBacklog: 'Backlog', tsReady: 'Ready', tsDoing: 'In Progress', tsWaiting: 'Waiting / Blocked', tsDone: 'Done',
    tasksSummary: 'Tasks', placeholderNewTask: 'New task…', btnAdd: 'Add',
    appNoProject: 'No project', appPickProject: 'Link a project to add tasks'
  }
};
function t(key){ return (I18N[LANG] && I18N[LANG][key] !== undefined) ? I18N[LANG][key] : (I18N.zh[key] !== undefined ? I18N.zh[key] : key); }
function setText(id, key){ const el = document.getElementById(id); if(el) el.textContent = t(key); }
function setPlaceholder(id, key){ const el = document.getElementById(id); if(el) el.placeholder = t(key); }

function applyI18n(){
  document.documentElement.lang = LANG;
  document.title = t('pageTitle');
  setText('appTitle', 'appTitle');
  document.getElementById('langToggle').textContent = LANG === 'zh' ? 'EN' : '中文'; // shows the language you can switch TO
  setText('tab-kanban', 'tabKanban'); setText('tab-tasks', 'tabTasks'); setText('tab-pipeline', 'tabPipeline'); setText('tab-daily', 'tabDaily');
  setText('tab-health', 'tabHealth'); setText('tab-dash', 'tabDash');
  setText('btnStartCheckin', 'btnStartCheckin'); setText('btnAddThread', 'btnAddThread');
  setText('addFormTitle', editingTaskId ? 'formTitleEdit' : 'formTitleAdd');
  setPlaceholder('newTitle', 'placeholderThreadName'); setPlaceholder('newNotes', 'placeholderNotesOptional');
  setText('btnAddSave', 'btnSave'); setText('btnAddCancel', 'btnCancel');
  setText('pipelineIntro', 'pipelineIntro');
  setText('pipelineCompaniesTitle', 'pipelineCompaniesTitle'); setText('btnAddCompany', 'btnAddCompany');
  setPlaceholder('coName', 'placeholderCompanyName'); setPlaceholder('coNotes', 'placeholderCompanyNotes');
  setText('btnCoSave', 'btnSave'); setText('btnCoCancel', 'btnCancel');
  setText('pipelineContactsTitle', 'pipelineContactsTitle'); setText('btnAddContact', 'btnAddContact');
  setPlaceholder('ctName', 'placeholderContactName'); setPlaceholder('ctNotes', 'placeholderNotes');
  setText('btnCtSave', 'btnSave'); setText('btnCtCancel', 'btnCancel');
  document.querySelectorAll('#coStage option').forEach(o => o.textContent = t('stage' + o.value.charAt(0).toUpperCase() + o.value.slice(1)));
  document.querySelectorAll('#ctStage option').forEach(o => o.textContent = t('stage' + o.value.charAt(0).toUpperCase() + o.value.slice(1)));
  setText('dailyIntro', 'dailyIntro'); setText('dailyNoteTitle', 'dailyNoteTitle');
  setPlaceholder('dailyNoteInput', 'placeholderDailyNote');
  setText('healthOverviewTitle', 'healthOverviewTitle'); setText('healthTrendTitle', 'healthTrendTitle');
  setText('healthActivityTitle', 'healthActivityTitle'); setText('healthAiTitle', 'healthAiTitle');
  ['ouraOverviewCard','ouraTrendCard','ouraActivityCard','ouraAnalysisCard'].forEach(id => {
    const el = document.getElementById(id);
    if(el && (el.textContent === I18N.zh.loading || el.textContent === I18N.en.loading)) el.textContent = t('loading');
  });
  setText('dashWeeksTitle', 'weeksTitle'); setText('dashAccTitle', 'accTitle'); setText('dashProjTotalTitle', 'projTotalTitle'); setText('dashTopTasksTitle', 'topTasksTitle'); setText('dashFunnelTitle', 'funnelTitle');
  setText('dashProgressTitle', 'progressTitle'); setText('dashDoneTitle', 'doneTitle');
  setText('modalTitle', 'modalTitle'); setText('modalContinueBtn', 'modalContinue'); setText('modalHoldBtn', 'modalHold');
  setText('modalDoneBtn', 'modalDone'); setText('modalSkipBtn', 'modalSkip');
  setPlaceholder('ciNote', 'modalNotePlaceholder');
}

function toggleLang(){
  LANG = LANG === 'zh' ? 'en' : 'zh';
  try{ localStorage.setItem('kanban-lang', LANG); }catch(e){}
  applyI18n();
  render(); renderPipeline(); renderDaily(); renderDashboard();
  if(document.getElementById('view-health').classList.contains('on')) renderHealthOverview();
}
