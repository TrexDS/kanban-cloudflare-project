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
    healthOverviewTitle: '◐ 今日状态', healthSleepTitle: '🌙 睡眠', healthVitalsTitle: '❤️ 身体指标', 
    healthActivityTitle: '🏃 活动', healthAiTitle: '🧠 AI 健康解读',
    ouraReadFailed: '❗ Oura 数据读取失败，现在没有可显示的健康数据。可能是同步服务出了问题，稍后点「重试」。', ouraCardFailed: '❗ 读取失败', aiReadFailed: '❗ AI 解读读取失败', ouraReadFailedShort: '读取失败',
    ouraNoData: '暂无数据', retry: '重试', dataAsOf: '数据更新到 {d}',
    dataStale: '⚠️ 数据已经 {n} 天没更新了（最新是 {d}）。检查 Oura App 有没有同步，或者 Google Sheet 的自动同步是否停了。',
    rangeN: '{n} 天', lastNNights: '最近 {n} 晚', lastNDays: '最近 {n} 天',
    trendVs: '和再往前 {n} 天的平均比：{v}', trendSame: '和再往前 {n} 天的平均差不多',
    alertsTitle: '⚠️ 需要注意', listSep: '、',
    alertCombo: '最近一晚有 {k} 项指标同时偏离你的常见范围：{list}。',
    alertHrvLow: 'HRV 已经连续 {n} 晚低于你的常见范围。', alertRhrHigh: '静息心率已经连续 {n} 晚高于你的常见范围。',
    alertTempHigh: '体温已经连续 {n} 晚高于你的常见范围。', alertShortSleep: '最近 {m} 晚里有 {n} 晚睡不到 6 小时。',
    alertStress: 'Oura 已经连续 {n} 天把当天判定为「压力偏大」。', lowShort: '偏低', highShort: '偏高',
    healthStressTitle: '😮‍💨 压力 vs 恢复', stressLabel: '压力', recoveryLabel: '恢复',
    ouraDayCounts: '最近 {n} 天里，Oura 判定：', dayCount: '{label} {k} 天', dayNone: '{m} 天没有判定',
    stressTotals: '压力共 {s} · 恢复共 {r}', stressDesc: 'Oura 根据白天的心率和 HRV 判断：「压力」是身体处于高压的时长，「恢复」是真正放松的时长。',
    healthWorkTitle: '💼 工作投入 vs 第二天恢复', workLess3: '工作 < 3 小时', work3to6: '工作 3–6 小时', work6plus: '工作 6 小时以上', workDays: '{n} 天',
    workResult: '工作 6 小时以上的第二天，恢复分平均 {h}，比工作不到 3 小时的第二天{dir} {d} 分。', lower: '低', higher: '高',
    workNeedMore: '每组至少要有 3 天才能比较，继续打卡就会出结论。',
    workNotEnough: '数据还不够：目前只有 {n} 天同时有打卡和 Oura 数据，至少需要 6 天。',
    workDesc: '按前一天在「今日打卡」里记的总工时分组，看第二天早上的恢复分。共 {n} 天；没打卡的日子不计入。只是平均值对比，不代表因果。',
    kpiReady: '今日恢复',
    perDay: '日均 {v}', dayByDay: '每天', nightTimeline: '整晚时间线', wakeUps: '夜里醒了 {n} 次', noTiming: '这段时间没有入睡时间数据',
    scheduleLine: '平均 {b} 上床、{w} 起床 · 上床时间前后浮动约 {sd}',
    refRange: '一般参考', refIn: '在一般参考内', refBelow: '低于一般参考', refAbove: '高于一般参考', refNone: '没有一般参考：体温偏差本来就是和你自己的基准比的',
    alertRefLow: '近 7 晚平均{m} {v}，低于一般健康成年人的参考范围（{r}）。', alertRefHigh: '近 7 晚平均{m} {v}，高于一般健康成年人的参考范围（{r}）。',
    refSources: '一般参考出处：血氧、呼吸频率来自 Oura 官方；静息心率来自 Mayo Clinic；HRV 来自已发表的人群研究，测量方式和戒指不同，只作大致参考。都不是医学诊断。',
    resLimited: '有限', resAdequate: '尚可', resSolid: '稳定', resStrong: '强', resExceptional: '极强',
    noDataShort: '暂无数据',
    bandOptimal: '很好', bandGood: '良好', bandFair: '一般', bandAttention: '需关注',
    ringSleep: '睡眠', ringReady: '恢复', ringActivity: '活动',
    ringSleepDesc: 'Oura 睡眠评分', ringReadyDesc: 'Oura 恢复（准备度）评分', ringActivityDesc: 'Oura 前一天的活动评分',
    readyVerdict: '恢复分 {v}，在 Oura 的分档里属于「{band}」。',
    daySummaryPrefix: '昨天：', day_stressful: '压力偏大', day_restored: '恢复得好', day_normal: '正常', day_relaxed: '放松',
    resiliencePrefix: '抗压韧性：',
    sleepHeadline: '{d} 那晚睡了 {t}', sleepMoreThanUsual: '比近两周平均多 {m}', sleepLessThanUsual: '比近两周平均少 {m}', sleepSameAsUsual: '和近两周平均差不多',
    stage_awake: '清醒', stage_rem: 'REM', stage_light: '浅睡', stage_deep: '深睡',
    stage_awakeDesc: '躺在床上但醒着', stage_remDesc: '快速眼动睡眠', stage_lightDesc: '浅层睡眠', stage_deepDesc: '最深的睡眠阶段',
    inBedLabel: '卧床', asleepLabel: '睡着', efficiencyLabel: '睡眠效率', latencyLabel: '入睡用时',
    avgAsleep: '平均睡着',
    vitalsIntro: '最近一晚的数值，和你自己前 30 晚的常见范围（平均值上下一个标准差）比较。',
    vHrv: '心率变异性 HRV', vRhr: '静息心率', vSpo2: '血氧', vBreath: '呼吸频率', vTemp: '体温偏差', perMin: '次/分',
    vHrvDesc: '心跳间隔的变化程度，取睡眠期间的平均值。', vRhrDesc: '睡眠期间的平均心率。',
    vSpo2Desc: '睡眠期间的平均血氧饱和度。', vBreathDesc: '睡眠期间每分钟的平均呼吸次数。',
    vTempDesc: '和你自己的基准体温相比的偏差。',
    vitalInRange: '在你的常见范围内', vitalHigh: '比平时高', vitalLow: '比平时低', usualRange: '你的常见范围',
    vitalNoBaseline: '数据还不够，攒满 5 晚后显示常见范围', last14Nights: '近 14 晚', lastNight: '最近一晚',
    steps7d: '最近 7 天步数', goalHitDays: '{n}/{m} 天达标',
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
    healthOverviewTitle: '◐ Today', healthSleepTitle: '🌙 Sleep', healthVitalsTitle: '❤️ Vitals',
    healthActivityTitle: '🏃 Activity', healthAiTitle: '🧠 AI Health Insight',
    ouraReadFailed: '❗ Couldn’t read Oura data, so there’s nothing to show. The sync service may be down; try Retry later.', ouraCardFailed: '❗ Read failed', aiReadFailed: '❗ Couldn’t read the AI insight', ouraReadFailedShort: 'read failed',
    ouraNoData: 'No data yet', retry: 'Retry', dataAsOf: 'Data up to {d}',
    dataStale: '⚠️ No new data for {n} days (latest is {d}). Check that the Oura app has synced, or that the Google Sheet sync is still running.',
    rangeN: '{n}d', lastNNights: 'Last {n} nights', lastNDays: 'Last {n} days',
    trendVs: 'vs the {n} days before: {v}', trendSame: 'about the same as the {n} days before',
    alertsTitle: '⚠️ Worth a look', listSep: ', ',
    alertCombo: 'Last night {k} signals were outside your usual range at once: {list}.',
    alertHrvLow: 'HRV has been below your usual range for {n} nights in a row.', alertRhrHigh: 'Resting heart rate has been above your usual range for {n} nights in a row.',
    alertTempHigh: 'Temperature has been above your usual range for {n} nights in a row.', alertShortSleep: '{n} of the last {m} nights were under 6 hours.',
    alertStress: 'Oura has rated {n} days in a row as “stressful”.', lowShort: 'low', highShort: 'high',
    healthStressTitle: '😮‍💨 Stress vs recovery', stressLabel: 'Stress', recoveryLabel: 'Recovery',
    ouraDayCounts: 'Oura’s day ratings over the last {n} days: ', dayCount: '{label} {k}', dayNone: '{m} not rated',
    stressTotals: 'stress {s} · recovery {r}', stressDesc: 'From Oura’s daytime heart rate and HRV: “stress” is time under high load, “recovery” is time truly relaxed.',
    healthWorkTitle: '💼 Work vs next-day recovery', workLess3: 'Under 3h of work', work3to6: '3–6h of work', work6plus: '6h+ of work', workDays: '{n} days',
    workResult: 'After days with 6h+ of work, next-morning readiness averages {h} — {d} points {dir} than after days under 3h.', lower: 'lower', higher: 'higher',
    workNeedMore: 'Each group needs at least 3 days before comparing — keep logging.',
    workNotEnough: 'Not enough data yet: only {n} days have both a daily log and Oura data; 6 are needed.',
    workDesc: 'Grouped by total hours logged in Daily Log the day before, against next-morning readiness. {n} days; days with nothing logged are left out. Averages only — not cause and effect.',
    kpiReady: 'Readiness today',
    perDay: '{v}/day', dayByDay: 'Day by day', nightTimeline: 'Through the night', wakeUps: 'woke up {n} times', noTiming: 'No bedtime data for this period',
    scheduleLine: 'In bed around {b}, up around {w} on average · bedtime varies by about {sd}',
    refRange: 'Typical', refIn: 'within the typical range', refBelow: 'below the typical range', refAbove: 'above the typical range', refNone: 'No population benchmark: temperature deviation is measured against your own baseline',
    alertRefLow: 'Your 7-night average {m} is {v}, below the typical range for healthy adults ({r}).', alertRefHigh: 'Your 7-night average {m} is {v}, above the typical range for healthy adults ({r}).',
    refSources: 'Typical ranges: blood oxygen and breathing rate from Oura; resting heart rate from Mayo Clinic; HRV from a published population study measured differently from a ring — a rough guide only. None of this is a medical diagnosis.',
    resLimited: 'Limited', resAdequate: 'Adequate', resSolid: 'Solid', resStrong: 'Strong', resExceptional: 'Exceptional',
    noDataShort: 'No data',
    bandOptimal: 'Optimal', bandGood: 'Good', bandFair: 'Fair', bandAttention: 'Pay attention',
    ringSleep: 'Sleep', ringReady: 'Readiness', ringActivity: 'Activity',
    ringSleepDesc: 'Oura sleep score', ringReadyDesc: 'Oura readiness score', ringActivityDesc: 'Oura activity score, previous day',
    readyVerdict: 'Readiness {v} — “{band}” on Oura’s scale.',
    daySummaryPrefix: 'Yesterday: ', day_stressful: 'stressful', day_restored: 'restored', day_normal: 'normal', day_relaxed: 'relaxed',
    resiliencePrefix: 'Resilience: ',
    sleepHeadline: 'Night of {d}: {t} asleep', sleepMoreThanUsual: '{m} more than your 2-week average', sleepLessThanUsual: '{m} less than your 2-week average', sleepSameAsUsual: 'about your 2-week average',
    stage_awake: 'Awake', stage_rem: 'REM', stage_light: 'Light', stage_deep: 'Deep',
    stage_awakeDesc: 'In bed but awake', stage_remDesc: 'Rapid eye movement sleep', stage_lightDesc: 'Light sleep', stage_deepDesc: 'The deepest stage',
    inBedLabel: 'In bed', asleepLabel: 'Asleep', efficiencyLabel: 'Efficiency', latencyLabel: 'Time to fall asleep',
    avgAsleep: 'avg asleep',
    vitalsIntro: 'Last night compared with your own usual range over the previous 30 nights (mean ± one standard deviation).',
    vHrv: 'Heart rate variability', vRhr: 'Resting heart rate', vSpo2: 'Blood oxygen', vBreath: 'Breathing rate', vTemp: 'Temperature deviation', perMin: '/min',
    vHrvDesc: 'Variation between heartbeats, averaged over sleep.', vRhrDesc: 'Average heart rate during sleep.',
    vSpo2Desc: 'Average blood oxygen saturation during sleep.', vBreathDesc: 'Average breaths per minute during sleep.',
    vTempDesc: 'Deviation from your own baseline temperature.',
    vitalInRange: 'Within your usual range', vitalHigh: 'Higher than usual', vitalLow: 'Lower than usual', usualRange: 'Usual range',
    vitalNoBaseline: 'Not enough nights yet — the usual range appears after 5', last14Nights: 'Last 14 nights', lastNight: 'Last night',
    steps7d: 'Steps, last 7 days', goalHitDays: 'goal hit {n}/{m} days',
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
  updateHealthBadge(); // tab label + ⚠️ when Oura data can't be read or is stale setText('tab-dash', 'tabDash');
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
  setText('healthOverviewTitle', 'healthOverviewTitle'); setText('healthSleepTitle', 'healthSleepTitle'); setText('healthVitalsTitle', 'healthVitalsTitle'); setText('healthStressTitle', 'healthStressTitle'); setText('healthWorkTitle', 'healthWorkTitle');
  setText('healthActivityTitle', 'healthActivityTitle'); setText('healthAiTitle', 'healthAiTitle');
  ['ouraOverviewCard','ouraSleepCard','ouraVitalsCard','ouraStressCard','ouraWorkCard','ouraActivityCard','ouraAnalysisCard'].forEach(id => {
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
