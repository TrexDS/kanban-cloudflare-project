# 多线程任务看板 — Cloudflare 独立部署与健康看板改造说明

## 背景

看板原本运行在 Claude Artifact 沙盒里，Oura CSV 拉取和数据存储都受沙盒网络策略（CSP/CORS）限制，经常出现"加载失败"，且数据不持久、跟其他项目（Renisa）耦合在同一环境里。

这次把整个项目迁移成一个完全独立的网页（`*.pages.dev`），前端、Oura 数据代理、用户数据存储全部走服务端，不再依赖任何沙盒环境，也跟 Renisa 现有的 Cloudflare Worker 项目完全隔离、互不影响。

## 一、部署架构

### 技术栈

- **托管平台**：Cloudflare Pages（静态页面 + Pages Functions 做轻量后端）
- **数据存储**：Cloudflare KV（键值数据库）— 看板任务、求职进度、每日打卡记录全部持久化在云端，替换掉原来受限的 `window.storage`
- **Oura / AI 数据代理**：两个 Pages Function 服务端转发 Google Sheets 发布的 CSV，前端走同源请求，彻底绕开浏览器 CORS 限制
- **代码仓库**：`TrexDS/kanban-cloudflare-project`（GitHub，`main` 分支）

### 项目结构

```
kanban-cf/
├── public/
│   └── index.html              # 看板前端（单文件 HTML/CSS/JS）
├── functions/
│   └── api/
│       ├── oura/
│       │   ├── raw.js          # 代理 Oura 原始数据 CSV
│       │   └── analysis.js     # 代理 AI 健康解读 CSV
│       └── storage/
│           └── [key].js        # KV 读写接口（GET/PUT）
├── wrangler.toml                # Cloudflare 项目配置 + KV 绑定
└── .gitignore                   # 忽略 .wrangler/ 本地缓存
```

### 关键配置

`wrangler.toml`：

```toml
name = "my-kanban"
pages_build_output_dir = "public"
compatibility_date = "2026-08-22"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "KANBAN_KV"
id = "38fe44dba6834447baa6dbf88f6f34a9"
```

`compatibility_flags = ["nodejs_compat"]` 是部署过程中踩的一个坑：Pages Functions 打包时报错 `No such module "node:stream"`，加上这个兼容标志后解决。

### KV 存储接口

`functions/api/storage/[key].js` 提供一个通用的 GET/PUT 接口，看板前端用 `kvGet(key)` / `kvSet(key, value)` 读写三类数据：

- `thread-kanban-data`：宏观看板的线程列表
- `job-pipeline-data`：求职明细（公司进度、cold outreach 联系人）
- `daily-log-data`：每日打卡记录

### 部署流程

```bash
npx wrangler login                                    # 首次登录 Cloudflare
npx wrangler kv namespace create KANBAN_KV            # 创建 KV 数据库（仅需一次）
npx wrangler pages deploy public --project-name=my-kanban   # 部署/更新
```

改完代码后，以后只需要重复最后一条部署命令即可更新线上版本。

## 二、看板功能改动

### 1. 卡片新增"编辑"功能

宏观看板每张卡片的操作按钮里，"归档"和"删除"之间新增"编辑"按钮。点击后弹出预填当前标题/备注的表单，保存后更新原线程，不会新建重复记录。

### 2. 归档后历史数据保留

- **Dashboard 近7天时间分布**：原来只统计未归档线程，导致线程一旦归档，之前几天的打卡记录直接从图表消失。改成统计全部线程（含已归档），已归档的会标注"（已归档）"。
- **今日打卡页**：某条线程今天已打过卡，即使之后被归档/搁置，当天的记录依然显示（只是不能再继续加时间）。

## 三、健康看板（Oura）重做

### 页面结构调整

新增独立的"健康总览" tab，把原本分散/单薄的 Oura 展示整合成 4 个可视化区块，跟 Dashboard（看板任务相关：求职漏斗、连续打卡、告别视频进度等）分开。

### 数据源

`functions/api/oura/raw.js` 代理的 Google Sheet（`Oura_Raw` 页签）字段远比最初以为的丰富，包含：

```
Date, Sleep Score, Total Sleep, Time in Bed, Sleep Efficiency,
Deep Sleep, REM Sleep, Light Sleep, Sleep Latency, Restfulness,
Avg HRV, Avg Resting HR, Lowest HR, Avg Breath Rate,
Readiness Score, ..., Activity Score, Steps, Total Calories,
Active Calories, ..., Stress High (min), Recovery High (min),
Resilience Level, Sleep/Daytime/Stress Contributor,
Avg SpO2 %, Breathing Disturbance Index, Vascular Age
```

四个区块直接复用这张表的历史行（Function 本身不用改，一直返回全表 CSV）。

### 1. 健康总览 — 5维雷达图

- 维度：睡眠分、恢复分、活动分、压力韧性、血氧
- 纯手写 inline SVG 实现，没有引入任何图表库
- 叠加一条 **80分虚线参考圈**，方便一眼看出哪些维度达标
- 每个顶点旁标注具体分值，图表下方另有明细区列出原始数据

**踩坑与修正**：最初直接把血氧百分比（如 94.4%）当 0–100 分数画在图上，导致血氧轴"爆表"、整个雷达图变形；压力韧性最初用 Resilience Level 的文字档位（limited/solid/strong...）粗略映射分数，主观性强。修正后：

- **血氧**：按临床参考区间分段映射（90%→0分，93%→50分，95%→80分，97%→95分，100%→100分），94.4% 对应约 71 分
- **压力韧性**：改为直接读取 Oura 自带的 `Stress Contributor` 字段（更有依据，不再靠猜）

### 2. 关键趋势 — HRV / 静息心率双线图

- 7天 / 14天切换 tab
- 用 Catmull-Rom 样条做平滑曲线，两条线独立着色，图例展示最新数值

### 3. 昨日活动

- 步数环形进度条（目标 8000 步）
- 活动消耗横向进度条（目标 350 kcal）
- 两个目标值写在代码常量 `STEP_GOAL` / `ACTIVE_CAL_GOAL` 里，可随时调整

### 4. AI 健康解读

- 从一整段文字升级成可折叠面板（`<details>`）
- 会尝试按"核心状态评级 / 异常维度预警 / 高优先级行动"三段式关键词解析 Summary 文本，分别渲染成状态 Tag + 带图标的分段展示；如果文本还是旧格式（没有这些关键词），自动降级显示为普通段落，不会报错

## 四、已知限制

- KV 数据是全新的，跟之前 Claude Artifact 里看板的数据是两份独立数据，不会自动同步，历史求职进度需要手动重新录入一次
- CSV 解析仍是按逗号简单分隔，如果 Google Sheet 某字段值本身包含逗号，需要换更严谨的解析方式
- 步数/活动消耗的目标值是按 Oura 常见默认值硬编码的估算，非本人的个性化目标

## 五、状态

Cloudflare Pages 部署、KV 数据持久化、Oura/AI 数据服务端代理、看板功能增强（编辑、归档留存）、健康看板可视化重构（雷达图/趋势图/活动指标/AI解读四区块）— 全部完成并本地验证通过，可以 close 这个任务。

线上地址：`https://main.my-kanban-6m9.pages.dev`
