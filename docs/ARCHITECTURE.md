# Quick 架构说明（给后续 Agent 的快速上手文档）

这份文档的目标是：让新加入的 agent 在 5-10 分钟内理解系统边界、关键流程、改动入口和常见坑位。

## 1. 系统概览

当前项目是一个 **RSS 驱动的新闻聚合应用**，核心由四块组成：

- **Go 后端（Gin + GORM）**：拉取 RSS、存储、聚合流查询、文章详情、AI 摘要/速览、来源管理。
- **后台 RSS Worker**：按轮询策略抓取来源并写入文章。
- **PostgreSQL（含 pgvector 可选能力）**：主存储；也承担缓存（摘要、速览）。
- **React 前端（Vite + TS）**：阅读流 + 管理页，统一调用后端 API。

前端 UI/UX 的产品定位、生成 prompt、严格审核 prompt 见：`docs/UIUX_REVIEW_PROMPT.md`。后续 agent 做界面改动时，应先阅读这份文档，避免回到模板化 SaaS 页面风格。

运行时关系：

1. 前端请求后端 `GET` 接口拿流与详情。
2. 来源变更、刷新、AI 生成等写操作走后端 `POST/PATCH/DELETE`。
3. RSS Worker 常驻运行，持续抓取并写入 `articles`。
4. AI 相关请求由后端转发至外部/本地 AI 代理，再写入缓存表。
5. 异步文章摘要和聚合速览任务写入 `ai_tasks`；服务重启后会恢复最近七天内未完成的任务，并继续受进程内并发上限约束。

## 2. 后端启动与进程模型

入口：`cmd/server/main.go`

启动顺序（非常关键）：

1. 读取配置：`internal/config/config.go`
2. 配置向量聚类开关：`internal/clustering/vector.go`
3. 连接数据库：`internal/database/db.go`
4. 执行版本化迁移：`internal/database/migrations.go`；首次基线迁移包含已有 GORM schema 和兼容性调整
5. 将已执行版本记录到 `schema_migrations`；PostgreSQL advisory lock 避免多个进程同时迁移
6. 初始化（可选）pgvector schema：`clustering.EnsureVectorSchema`
7. 启动 RSS Worker goroutine：`internal/worker/rss_worker.go`
8. 构建 AI 客户端（可选）：`internal/aisummary/client.go`
9. 组装 Gin Router：`internal/router/router.go`
10. 启动 HTTP Server 并监听优雅退出信号

只执行数据库迁移可运行 `go run ./cmd/migrate`。所有迁移在同一事务中执行，失败时不会记录部分版本。
新增字段或索引时必须在 `registeredSchemaMigrations` 末尾追加更高版本，不能修改已发布版本的名称，也不能重新把 `AutoMigrate` 放回启动流程。迁移应保持向后兼容，使自动部署的旧二进制在健康检查失败回滚后仍能启动。

## 3. 路由与权限边界

路由组装：`internal/router/router.go`

所有响应都会附带 `Server-Timing: app;dur=...` 和 `X-Request-ID`。前者表示后端写出首字节前的应用处理耗时，可用浏览器 Network 面板区分后端耗时与 DNS、TLS、CDN/代理耗时；后者可关联 JSON access log。500 响应不会向客户端暴露底层数据库或系统错误，只返回安全消息和请求 ID，完整错误保留在服务端日志中。

- 存活检查：`GET /healthz`
- 数据库就绪检查：`GET /readyz`
- 公共读接口（默认无需 token）
  - `GET /api/v1/feed`
  - `GET /api/v1/feed/briefing/status`
  - `GET /api/v1/feed/briefing/result`
  - `GET /api/v1/articles/:id`
  - `GET /api/v1/articles/:id/enrichment`
  - `POST /api/v1/articles/:id/view`
  - `GET /api/v1/articles/:id/cluster-diagnosis`
  - `GET /api/v1/articles/:id/summary`
  - `GET /api/v1/articles/:id/summary/status`
  - `GET /api/v1/sources`
  - `GET /api/v1/sources/:id`
- 管理写接口（可选 admin token）
  - `GET /api/v1/admin/source-status`
  - `POST /api/v1/feed/briefing`
  - `POST /api/v1/articles/:id/summary`
  - `POST /api/v1/articles/:id/track-thread`
  - `POST /api/v1/sources`
  - `POST /api/v1/sources/discover`
  - `POST /api/v1/sources/reclassify`
  - `POST /api/v1/sources/bulk/tags`
  - `PATCH /api/v1/sources/:id`
  - `DELETE /api/v1/sources/:id`
  - `POST /api/v1/sources/:id/test`
  - `POST /api/v1/sources/:id/refresh`

鉴权中间件：`internal/router/admin_middleware.go`

- 当 `ADMIN_AUTH_ENABLED=true` 时，写路由需要 token。
- 支持三种来源：
  - `X-Admin-Token`
  - `Authorization: Bearer ...`
  - Cookie `quick_admin_token`

## 4. 后端模块分层

### 4.1 Handler 层（HTTP 编排）

目录：`internal/handlers/`

- `feed_handler.go`
  - 列表查询（支持去重、分页、关键词、标签、来源过滤）
  - 聚合流只返回有界摘要预览，完整内容在文章详情打开时按需读取
  - AI 聚合速览（briefing）生成与缓存
- `article_handler.go`
  - 文章详情
  - 文章摘要接口
  - 线程跟踪入口（将论坛帖子变成可轮询来源）
- `source_handler.go`
  - 来源 CRUD、重分类、批量标签操作、测试与手动刷新
- `source_transfer.go`
  - 来源导入/导出
  - 传输 payload 解析与去重/更新策略
- `source_discovery.go`
  - feed probe
  - RSS 自动发现（HTML link / robots / sitemap / RSSHub alias）
- `source_classification.go`
  - 来源标签归一化与自动推断
- `source_identity.go`
  - 站点名、`site_key`、RSSHub/内网地址识别规则
- `admin_status_handler.go`
  - 来源健康统计（窗口成功率、最新抓取状态、stale 判定）

### 4.2 Service 层（业务能力）

- `internal/aitask/service.go`
  - 文章摘要与聚合速览共用的持久任务执行器
  - 统一处理任务去重、并发限制、超时、状态持久化、panic 隔离和重启恢复
- `internal/articlesummary/service.go`
  - 文章摘要输入加载与生成流程
  - DB 缓存读写（`article_summaries`）
- `internal/handlers/feed_briefing_tasks.go`
  - 聚合速览任务 payload 编解码与业务 runner 适配
  - 保存完整输入快照，交由通用任务执行器运行
- `internal/handlers/article_content_service.go`
  - 论坛线程抓取与解析（USCard/V2EX/Reddit）
  - 外链正文抓取、缓存、失败熔断、日预算限流
- `internal/handlers/public_http_client.go`
  - 图片代理和外链正文共用的公网 HTTP client
  - 在拨号时固定并校验 DNS 结果，拦截内网、回环、链路本地、CGNAT、重定向绕过和 DNS rebinding
- `internal/handlers/image_proxy_handler.go`、`image_proxy_cache.go`
  - 安全代理文章图片，并设置浏览器缓存响应头
  - 使用有容量上限的内存 LRU 缓存和并发请求合并，避免不同客户端重复回源
- `internal/aisummary/client.go`
  - 统一 AI 接口适配（OpenAI Chat / Messages）
  - 提示词封装 + 返回内容提取 + 空摘要保护

### 4.3 Worker 层（异步抓取）

- `internal/worker/rss_worker.go`
  - 按 source 轮询周期抓取
  - 失败重试与指数退避
  - 条件请求（ETag/Last-Modified）
  - 写入文章并记录抓取日志

### 4.4 基础能力层

- `internal/clustering/`：链接/标题归一化、事件聚类、可选向量近邻归并
- `internal/feedextract/`：从 RSS raw 中抽取回复数/图片等辅助字段
- `internal/textclean/`：HTML/文本清洗归一化
- `internal/database/`：连接与运行时兼容迁移
- `internal/models/`：ORM 模型定义

## 5. 核心数据流（从输入到展示）

### 5.1 创建来源

入口：`POST /api/v1/sources`（`internal/handlers/source_handler.go`）

流程：

1. 校验请求（`rss_url` 必填）。
2. 若缺少 name，优先探测 feed `<title>`，否则回退到 URL 推导名称。
3. 归一化 tags；若仅提供通用标签会自动推断更具体标签。
4. 计算 `site_key`（用于站点合并/静音等能力）。
5. 写入 `sources`。

### 5.2 RSS 抓取入库

入口：`RSSWorker.Start`（`internal/worker/rss_worker.go`）

流程：

1. 读取 enabled 来源，判断是否到期。
2. 发起 HTTP 请求（含 ETag/Last-Modified）。
3. 解析 feed item -> 映射 article。
4. 对同来源 GUID/链接/内容哈希做精确去重后写入 `articles`，文章立即可见。
5. 将新文章加入后台关联队列；队列异步更新 `event_clusters`/`articles.cluster_id`，不阻塞 RSS 入库。
6. 后台每分钟扫描未关联文章，进程重启或队列暂时满载也会自动补做。
7. 更新来源状态与 `source_fetch_logs`。

### 5.3 聚合流查询

入口：`GET /api/v1/feed`（`internal/handlers/feed_handler.go`）

特点：

- 默认返回完整的多源阅读流，关联文章仍分别展示，并带 `duplicate_count` 作为“相关条目数”提示。
- 显式传入 `dedupe=1` 时才按 cluster 折叠为代表文章。
- 支持 cursor 分页（`sort_time + id` 编码）。
- 支持 `tag/source_ids/q/include_hidden` 过滤。
- 可传 `since=<RFC3339>` 按文章入库时间查询检查点后的内容，并返回 `meta.total_count`；该计数只在补课请求中执行，不增加普通首屏查询成本。
- 返回前会做文本清洗、图片/回复数补全。

### 5.4 文章详情增强

文章打开采用渐进式加载：阅读流先用列表数据立即渲染，`GET /api/v1/articles/:id` 补充数据库正文，`GET /api/v1/articles/:id/enrichment` 并行加载外部全文与论坛评论。浏览计数由独立的 `POST /api/v1/articles/:id/view` 异步记录，避免只读接口产生写入和阻塞。

增强结果持久化在 `article_enrichments`。新鲜缓存直接返回；过期缓存先返回旧值，再由后台单航班刷新；冷缓存才等待首次抓取。这样后端重启不会丢失全文/评论缓存，同一文章的并发请求也不会重复访问上游。

入口：`GET /api/v1/articles/:id`（`internal/handlers/article_handler.go`）

增强内容：

- `thread`：论坛贴正文 + 评论（当前支持 USCard/V2EX/Reddit 规则）
- `external`：对外链网页进行正文抽取（受 host 白名单、缓存、预算限制）

### 5.5 线程持续跟踪

入口：`POST /api/v1/articles/:id/track-thread`

逻辑：

1. 从文章 link 推断线程 feed URL。
2. 若已有同 URL source，则复用并修正属性。
3. 若无则新建 `kind=thread` 来源并开始轮询。

### 5.6 文章 AI 摘要

入口：`POST /api/v1/articles/:id/summary`

逻辑：

- 优先读 `article_summaries` 缓存。
- `async=1` 时进入摘要任务队列，前端轮询 `summary/status`。
- 成功后写入缓存；后续同模型请求直接命中缓存。

### 5.7 AI 聚合速览

入口：`POST /api/v1/feed/briefing`

逻辑：

1. 选取当前视图文章集（可按来源/tag/关键词），保留多源原始输入。
2. 生成 digest key（包含 model + filter + article_ids）。
3. 命中 `feed_briefings` 则返回缓存。
4. `async=true` 时把输入快照写入 `ai_tasks` 并立即返回 `202`；前端轮询 `briefing/status`，完成后读取 `briefing/result`。
5. 未命中则由后台任务调用 AI 并持久化；共同事实合并表述，但保留各来源的新增信息、角度和分歧。
6. 后端重启会恢复最近七天内的 queued/running 任务；digest 校验确保恢复时不会用变化后的文章集合生成旧结果。

定时来源速览由 `FeedBriefingScheduler` 执行。可通过 `AUTO_AI_BRIEFING_TIMEZONE` 和
`AUTO_AI_BRIEFING_BLOCKED_WINDOWS` 禁止后台任务在高价时段运行；到期任务不会丢失，而是在下一个允许时段继续执行。该限制不影响用户手动触发的文章摘要或聚合速览。

阅读流的补课模式在浏览器本地保存最近处理检查点。首次使用默认回看 24 小时，检查新增时调用 `GET /api/v1/feed?since=...`，生成补课速览时复用现有 briefing API 和 AI 任务队列，并选取最新 30 篇作为输入。

## 6. 数据模型速查

模型目录：`internal/models/`

- `schema_migrations`
  - 已执行数据库版本；启动和 `cmd/migrate` 通过 advisory lock 串行更新
- `sources`
  - 来源主表：`name/rss_url/site_key/kind/topic_url/tags/enabled/poll_interval_sec`
  - 健康相关：`consecutive_failures/last_error/last_fetched_at`
  - 交互相关：`click_count/last_clicked_at/hidden_in_sidebar`
- `articles`
  - 文章主表：`source_id/link/title/summary/content/raw`
  - 去重聚类：`canonical_link/normalized_title/cluster_id/content_hash`
  - 展示增强：`image_url/reply_count/tags`
- `event_clusters`
  - 事件聚类主表，记录代表文章和时间范围
- `article_summaries`
  - 文章摘要缓存（唯一键 `article_id`）
- `feed_briefings`
  - 聚合速览缓存（唯一键 `digest_key`）
- `ai_tasks`
  - 文章摘要和聚合速览的持久任务状态；聚合速览输入保存在 `payload`
- `source_fetch_logs`
  - 每次抓取的日志、耗时、状态、错误
- `article_vectors`（可选）
  - pgvector 向量表，用于近似语义聚类补充

## 7. 前端架构

入口：`frontend/src/App.tsx`

### 7.1 总体模式

- 单页应用，`App.tsx` 更接近顶层装配器而不是唯一状态中心。
- 视图层分成三个 tab：
  - `reader`：阅读流 + 详情阅读
  - `ai`：历史聚合速览与文章摘要
  - `sources`：管理（来源列表、健康、批量操作、发现、重分类）

### 7.2 主要状态域

顶层状态仍然主要在 `App.tsx`，但阅读流的组合与副作用已经下沉到专用 hooks。重点状态域仍包括：

- 来源域：`sources/sourceStatus`
- 流域：`feed/feedCursor/hasMoreFeed`
- 详情域：`selectedArticle/selectedArticleID`
- AI 域：`articleSummary/feedBriefing/summaryTasks/aiModel`
- 筛选域：`keyword/tagFilter/sourceFilter/unreadOnly/mutedSiteKeys`
- 交互域：订阅侧栏、浮动阅读、标签筛选、上下文菜单

### 7.3 Hook 拆分

目录：`frontend/src/hooks/`

- `use-reader-feature-section`：阅读区主组合层，串联 reader 相关 action/data/effects
- `use-reader-feature-derived`：阅读流与详情的派生状态
- `use-reader-feature-effects`：阅读流相关副作用与轮询
- `use-reader-workspace-composition`：把 reader 状态装配成 `ReaderWorkspace` 所需 props
- `use-source-management-state`：来源管理页状态收敛
- `use-source-management-actions`：来源管理操作集合（create/update/bulk/discover）

### 7.4 组件边界

目录：`frontend/src/components/`

- `reader-feed-panel.tsx`：左侧阅读流
- `reader-detail-panel.tsx`：右侧详情/沉浸阅读
- `reader-subscription-sidebar.tsx`：订阅源与标签侧栏
- `source-management-panel.tsx`：管理页主面板
- `summary-task-strip.tsx`：AI 任务队列条
- `source-overlays.tsx`：来源弹层与上下文菜单

### 7.5 样式边界

- `frontend/src/index.css`：页面基础样式和 Tailwind 入口
- `frontend/src/App.css`：应用壳、阅读流、详情和管理页共享样式
- `frontend/src/styles/ai-library.css`：AI 历史页、速览文档和对应响应式规则

新增 AI 历史页样式应放入 `styles/ai-library.css`，不要继续堆入全局 `App.css`。两个文件由 `App.tsx` 按上述顺序加载，以保留既有级联优先级。

### 7.6 API 客户端与鉴权

文件：`frontend/src/api.ts`

- 所有写请求会自动读取 localStorage 中 `quick_admin_token` 并加 Bearer。
- 读请求默认无 token。
- 对 `404` 缓存缺失类接口（如摘要缓存）有单独处理。

## 8. 配置与运行开关

配置定义：`internal/config/config.go`

关键开关：

- 服务与权限：`SERVER_PORT`、`ADMIN_AUTH_ENABLED`、`ADMIN_TOKEN`
- Worker：`WORKER_*`
- 聚类：`CLUSTER_VECTOR_*`
- AI：`AI_SUMMARY_*`
- 外链抓取：`EXTERNAL_FETCH_*`
- 数据库：`POSTGRES_*` + `DB_*`

常用脚本：

- `./scripts/db-up.sh`：启动 Postgres + pgAdmin
- `./scripts/dev-up.sh --detach`：后台启动 DB + API
- `./scripts/dev-down.sh`：停止 API + DB
- `./scripts/api-up.sh`：仅启动后端

## 9. Agent 扩展指引（建议按此改）

### 9.1 新增“论坛线程解析规则”

目标：让新站点支持“文章详情中显示正文+评论”和“track-thread 持续跟踪”。

主要改动点：

1. `internal/handlers/article_content_service.go`
2. 在 `forumThreadTargetFromLink` 增加新站点分支
3. 实现 `xxxTopicRSSURLs` + post number 解析函数
4. 调整 `normalizeThreadText` 规则（必要时）
5. 为新规则补充 handler/service 单测

### 9.2 新增 AI 功能（低风险路径）

1. 先在 handler 增加 read/write endpoint。
2. 把核心逻辑放 service（参考 `internal/articlesummary/service.go`）。
3. 明确 DB 缓存键，避免重复推理成本。
4. 前端接入时优先复用 `summaryTasks` 机制。

### 9.3 新增筛选/排序能力

后端优先在 SQL 层完成筛选，前端仅做轻量状态映射，避免把大数据量过滤放浏览器。

## 10. 常见排障清单

1. API 起来但访问 `/` 返回 404：正常，后端只提供 API，不提供首页。
2. 摘要接口返回空：先检查 AI 代理与 `AI_SUMMARY_*` 配置是否匹配（style/header/prefix/model）。
3. 源创建慢或失败：先看 `sources/:id/test` 与网络超时；不少第三方 RSSHub 有限流。
4. 线程评论不显示：先确认文章 link 是否命中当前规则（USCard/V2EX/Reddit）。
5. feed 看起来有“无关文章”：先确认 `source_ids`/`tag`/`q` 参数是否组合正确。
6. 端口占用：`dev-down` 会尝试杀掉监听进程；若残留再手动 `lsof -i :8080`。

---

如果后续你要继续重构，建议优先顺序：

1. 继续缩减 `use-reader-feature-section`，把 reader 主组合层再拆成更稳的 domain hooks。
2. 把 `article_handler.go` 的剩余编排继续向 service 下沉。
3. 给“线程解析规则”做独立 adapter 注册机制（减少 if/else 分支增长）。
