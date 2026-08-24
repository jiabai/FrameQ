# 自助邮件激活码设计

- 日期：2026-08-24
- 状态：设计已确认，尚未实现
- 产品规格：docs/product-specs/2026-08-24-self-service-email-activation-code.md
- 相关基线：
  - docs/product-specs/2026-06-21-activation-code-authorization.md
  - docs/product-specs/2026-06-22-server-managed-llm-quota.md
  - docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md

## 1. 决策摘要

FrameQ 在现有 ActivationCode 模型上增加账号绑定的 self_service_email 发码通道，不另建一套授权体系。

已登录且没有有效权益的桌面用户可以请求服务端向登录邮箱发送激活码。服务端先在事务内创建 pending_delivery 状态的绑定码并预留发送限流；SMTP 接受邮件后，再在第二个事务中启用该码并使同账号的旧自助码失效。用户收到邮件后，仍通过现有激活码输入框手动兑换。

自助码兑换必须同时满足：会话有效、码有效、申请账号与兑换账号一致、当前权益不存在或已过期。兑换、码消费、31 天权益授予和 20 次 AI Credits 重置在同一 Store 事务中完成。有效权益期间不允许申领或兑换自助码，因此不能提前续期和叠加授权。

管理员创建的通用码继续使用现有路径：不绑定申请账号，并可按既有规则延长有效权益。本设计只新增一种激活码来源，不改变管理员通用码的合同。

## 2. 采用与放弃的方案

### 2.1 采用：扩展现有 ActivationCode

优点：

- 复用现有安全随机码、标准化、hash-only 存储、单次消费和权益事务。
- 桌面端继续使用同一个输入框和兑换接口，用户心智不变。
- Admin Web 可以在同一列表中观察管理员码和自助码。
- 迁移只需为现有行回填 admin 来源，不需要双轨授权或数据同步。

代价：

- 激活码状态机需要加入投递前状态和账号绑定规则。
- 兑换事务必须按来源区分“管理员可续期”与“自助码仅过期后重开窗口”。

### 2.2 放弃：独立自助授权表

独立表能隔离管理员码和自助码，但会重复随机码生成、hash 存储、兑换、审计、Admin Web 展示与事务测试。两套路径最终仍写同一个 Entitlement，增加一致性成本，不符合当前小型单体服务的规模。

### 2.3 放弃：点击后直接授予权益

直接授权实现更短，但违反“邮件收到 key 后手动填写激活”的产品要求，也取消了用户对收件邮箱和兑换动作的显式确认。

## 3. 范围与不变量

### 3.1 功能范围

- 桌面“账号与授权”页面增加申领按钮及发送状态。
- Tauri 增加一个请求自助激活码的 IPC 命令。
- Server 增加经过桌面 bearer session 认证的申领 API。
- ActivationCode、Store、PrismaStore 和 memory store 支持来源、绑定用户、投递状态和原子申领。
- 既有邮件发送器增加激活码邮件模板。
- Admin Web 激活码列表显示来源、绑定账号、投递状态和短前缀，不显示明文。
- 产品规格、设计索引、安全说明和后续 ExecPlan 保持同步。

### 3.2 必须保持的不变量

- 自助码明文不进入数据库、日志、API 响应或桌面本地持久化。
- 一个自助码只能被绑定账号消费一次。
- 一个账号在同一时刻最多有一个 active 自助码。
- pending_delivery 码永远不能兑换。
- 有效权益账号不能申领或兑换自助码。
- 自助续期只能发生在权益到期后，每次从兑换时刻开始 31 天。
- 管理员通用码的创建和兑换语义不变。
- 服务端不接收任何视频、音频、文字稿、洞察或本地历史内容。

### 3.3 非目标

- Web Dashboard 发码或兑换。
- 邮件链接一键激活、自动读取邮箱或自动填码。
- 支付、订阅、自动续费或套餐分层。
- 删除 Admin Web 发码能力。
- worker、ASR、InsightFlow、下载或本地文件生命周期变更。

## 4. 高层架构

    AccountSheet
        |
        | requestActivationCode(locale)
        v
    Tauri account command
        |
        | POST /api/desktop/activation-codes/request
        v
    Desktop account route
        |
        v
    SelfServiceActivationService
        |-- Store.prepareSelfServiceActivationCode()
        |     校验会话、权益、限流，创建 pending_delivery
        |
        |-- ActivationEmailSender.sendActivationCode()
        |     SMTP 发送明文，只存在于本次进程内存
        |
        '-- Store.activatePreparedSelfServiceActivationCode()
              重新校验权益，使旧自助码失效，启用新码

    用户从邮件复制激活码
        |
        | 既有 redeem_activation_code IPC
        v
    POST /api/desktop/activation-codes/redeem
        |
        '-- Store.redeemActivationCodeAndGrantEntitlement()
              校验来源/绑定/权益，消费码，原子授予权益和配额

新增能力留在 server 和 app 的账号边界内。worker 不参与发码、邮件或权益写入。

## 5. 桌面交互设计

### 5.1 可见性

Server 的桌面账号状态增加 can_request_activation_code 布尔能力。该字段仅在以下条件全部满足时为 true：

- 自助发码功能开关已启用；
- 桌面会话有效；
- Entitlement 不存在，或 expiresAt 小于等于服务端当前时间。

新客户端把该字段视为可选能力；旧 Server 未返回时默认 false。这样可以先部署 Server 和迁移，再发布显示按钮的桌面版本。旧客户端会忽略 Server 新增字段。

AccountSheet 的规则：

| 状态 | 申领按钮 | 激活码输入与兑换 |
| --- | --- | --- |
| 未登录 | 隐藏 | 隐藏 |
| 已登录、未授权 | 显示 | 显示 |
| 已登录、授权过期 | 显示 | 显示 |
| 已登录、授权有效 | 隐藏 | 保持现有隐藏行为 |
| Server 不支持或功能关闭 | 隐藏 | 现有管理员码输入行为保持兼容 |

功能关闭时仍允许用户填写从管理员渠道获得的通用码，因此“隐藏申领按钮”不能删除现有兑换入口。

### 5.2 操作状态

useAccountController 增加 activationCodeRequestPending 和 activationCodeRequestRetryAt 两个瞬时状态：

- 发送中：按钮禁用，显示“正在发送”。
- 成功：显示“激活码已发送到当前账号邮箱”，保存响应中的 retry_at，在冷却结束前禁用按钮。
- 限流：使用 Server 返回的 retry_at 更新冷却提示。
- 已有有效权益：刷新账号状态；按钮随 can_request_activation_code=false 隐藏。
- 邮件或服务暂不可用：保留输入框，显示重试提示，不声称邮件已经送达。
- 兑换成功：沿用现有状态刷新，清空输入框，隐藏申领按钮。

冷却时间只用于界面体验，正确性仍由 Server 限流和权益事务保证。关闭或重启客户端会丢失本地倒计时；下一次请求仍会被 Server 正确接受或限流。

### 5.3 国际化

新增简体中文、繁体中文和英文文案：

- 发送激活码到邮箱；
- 正在发送；
- 已发送及重试时间；
- 请求过于频繁；
- 当前授权有效；
- 邮件服务暂不可用；
- 自助码无效或不属于当前账号。

请求携带当前 UI locale，Server 只接受 zh-CN、zh-TW、en-US 闭集；缺失或非法值回退 zh-CN。locale 只选择邮件模板，不参与授权判断。

## 6. Server API

### 6.1 账号状态扩展

GET /api/desktop/account 增加：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| can_request_activation_code | boolean | 功能已启用且账号当前没有有效权益 |

该字段不表示当前 IP 一定未触发发送限流；最终申领结果以 POST 接口为准。

### 6.2 申领接口

新增 POST /api/desktop/activation-codes/request。

请求：

- Authorization 使用现有桌面 bearer session。
- body 只允许 locale；不接受 email、user_id、权益天数或配额。
- 收件邮箱由 session.userId 对应 User.email 读取。
- 客户端 IP 使用现有 trusted proxy 规则解析。

响应：

| HTTP | error/status | 行为 |
| --- | --- | --- |
| 200 | sent | SMTP 已接受且激活码已启用；返回 retry_at 和 redeem_by，不返回明文 |
| 400 | INVALID_REQUEST | locale 或请求体不合法 |
| 401 | AUTH_REQUIRED | 会话缺失或过期 |
| 404 | FEATURE_NOT_AVAILABLE | 功能开关关闭 |
| 409 | ENTITLEMENT_ACTIVE | 当前已有有效权益；客户端刷新账号状态 |
| 429 | ACTIVATION_REQUEST_RATE_LIMITED | 返回 retry_at，并设置 Retry-After |
| 503 | ACTIVATION_EMAIL_UNAVAILABLE | SMTP 失败或投递后启用未能确认 |
| 503 | SERVER_TEMPORARILY_UNAVAILABLE | 数据库事务暂时不可用 |
| 500 | INTERNAL_SERVER_ERROR | 未分类内部错误 |

接口只有在码已经从 pending_delivery 转为 active 后才返回 sent。SMTP “接受”不等于最终到达收件箱，用户文案使用“已发送”而不承诺即时送达。

### 6.3 Tauri 边界

Rust account 模块增加 request_activation_code 命令：

- 从现有安全存储读取 desktop session token；
- 向申领接口只转发 locale；
- 严格解析 sent、retry_at 和 redeem_by；
- 将闭集错误映射到前端可本地化错误，不透传 Server 原始响应；
- 不记录或持久化邮件正文、激活码或 Authorization。

## 7. 数据模型

ActivationCode 增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| issuanceSource | String | admin 或 self_service_email；现有行回填 admin |
| issuedToUserId | String? | 自助码绑定用户；管理员通用码为 null |
| sentAt | DateTime? | SMTP 接受时间；不代表最终投递证明 |
| disabledReason | String? | delivery_failed、superseded 或 activation_became_active |

status 闭集扩展为：

- pending_delivery：已创建但尚不可兑换；
- active：可兑换；
- redeemed：已消费；
- expired：已超过 redeemBy；
- disabled：因失败、替换或资格变化而不可用。

约束：

- issuanceSource=admin 时 issuedToUserId 必须为 null，创建后直接 active。
- issuanceSource=self_service_email 时 issuedToUserId 必须存在，初始状态只能是 pending_delivery。
- 自助码只有在 sentAt 写入时才能转为 active。
- 兑换正确性始终同时检查 status=active 和 redeemBy>now；后台是否及时把过期行物化为 expired 不影响正确性。
- Prisma 增加 issuedToUser 关系和 issuedToUserId、issuanceSource、status 组合索引。

SQLite 迁移为已有 ActivationCode 行写入 issuanceSource=admin，保留原 status、hash、前缀、兑换人和到期时间。迁移不得改变现有管理员码的可兑换性。

## 8. 服务与 Store 边界

### 8.1 SelfServiceActivationService

新增独立服务以避免把 SMTP、副作用补偿和管理员发码混入现有 ActivationCodeService。它依赖：

- Store 的三个语义操作；
- ActivationEmailSender；
- 安全随机码生成与 normalizeActivationCode；
- 当前时间；
- 自助发码功能开关。

ActivationCodeService 继续负责管理员码生成和统一兑换。随机码格式、31 天常量、30 天 redeemBy 默认值和 20 Credits 常量提取为共享的 activation policy，避免两条发码路径漂移。

### 8.2 原子准备

prepareSelfServiceActivationCode 接收 sessionTokenHash、codeHash、codePrefix、IP 限流 key 和时间，返回闭集结果。locale 只由 service 传给邮件发送器，不进入 Store：

- prepared：包含记录 ID、服务端读取的收件邮箱、retryAt 和 redeemBy；
- session_invalid；
- entitlement_active；
- rate_limited；
- temporarily_unavailable。

一个事务内完成：

1. 校验 session 未撤销且未过期，并读取 session 对应用户；
2. 以 expiresAt>now 判断是否已有有效权益；
3. 为 self_service_activation purpose 原子预留邮箱和 IP 发送限流；
4. 使同账号遗留的 pending_delivery 记录失效；
5. 创建新的 pending_delivery 绑定码。

准备阶段不使现有 active 自助码失效。只有新邮件被 SMTP 接受并成功启用后，旧码才被替换，避免一次发送失败破坏用户仍可使用的旧邮件。

### 8.3 外部邮件副作用

服务在准备事务提交后调用 ActivationEmailSender.sendActivationCode。邮件包含：

- 完整激活码；
- 绑定邮箱；
- redeemBy；
- 31 天权益和 20 次 AI Credits；
- “仅限当前账号、请勿转发”的说明；
- 三语言模板之一。

发送失败时调用 disablePreparedSelfServiceActivationCode，把仍为 pending_delivery 的当前记录改为 disabled，原因记为 delivery_failed。限流预留不回滚，与现有 OTP 发送失败语义一致。

日志只记录请求 ID、结果分类、耗时和非敏感记录 ID；不得记录码、邮件正文、Authorization 或 SMTP 原始响应正文。

### 8.4 原子启用

SMTP 接受后调用 activatePreparedSelfServiceActivationCode。一个事务内：

1. 确认目标仍为该用户的 pending_delivery 自助码；
2. 再次确认用户权益仍不存在或已过期；
3. 把同账号其他 active 自助码改为 disabled，原因记为 superseded；
4. 把当前码改为 active，并写 sentAt。

若准备和启用之间，用户使用旧码或管理员码获得了有效权益，当前 pending_delivery 码改为 disabled，原因记为 activation_became_active，接口返回 ENTITLEMENT_ACTIVE。已经发出的邮件会包含一个不可兑换码，这是为了保证“不叠加有效权益”的 fail-closed 选择。

若 SMTP 已接受但启用事务未能确认，接口返回 ACTIVATION_EMAIL_UNAVAILABLE，pending_delivery 码保持不可兑换。用户可以在限流允许后重试。

### 8.5 限流

复用 AuthRateLimit 的数据库记录和原子预留算法，但把发送目的闭集扩展为 self_service_activation。EmailOtp.purpose 仍只允许 desktop_login 和 admin_login，自助码不会写入 EmailOtp。

初始策略与 OTP 邮件一致：

| 范围 | 策略 |
| --- | --- |
| normalized email + purpose | 60 秒最多一次，固定小时最多五次 |
| trusted client IP + purpose | 固定小时最多二十次 |

scope key 继续使用带版本和 purpose 的 SHA-256，不在限流表重复保存原始邮箱或 IP。数据库冲突重试只重试本地事务，不重复调用 SMTP。

## 9. 兑换事务

redeemActivationCodeAndGrantEntitlement 保留为唯一兑换写边界，并按 issuanceSource 分支。

### 9.1 管理员通用码

行为保持不变：

- 任意有效桌面账号可以兑换；
- 有效权益可以从 max(now, expiresAt) 延长；
- 配额按现有管理员码规则更新；
- 一次性消费、redeemBy 和并发不变量不变。

### 9.2 自助邮件码

同一事务内要求：

- session 有效；
- code hash 匹配且 status=active；
- redeemBy>now；
- issuedToUserId 等于 session.userId；
- 当前 Entitlement 不存在或 expiresAt<=now；
- 条件更新成功把码从 active 改为 redeemed；
- 从 now 创建 31 天权益窗口；
- llmQuotaLimit=20，llmQuotaUsed=0。

账号不匹配、状态不正确、过期或已消费统一返回 code_invalid。当前权益已经有效返回 entitlement_active，客户端刷新账号状态。任何权益写入失败都回滚码消费；任何码消费竞争失败都不授予权益。

## 10. 状态机与并发

自助码状态机：

    pending_delivery
        | SMTP accepted + entitlement still inactive
        v
      active ----------------------> redeemed
        |                               |
        | redeemBy elapsed              | terminal
        v                               v
      expired                         redeemed

    pending_delivery -- SMTP/enable failure --> disabled
    pending_delivery -- entitlement became active --> disabled
    active -- newer self-service code activated --> disabled

并发规则：

- 两个并发申领由数据库限流预留序列化，至多一个进入 SMTP。
- 同一码的两个并发兑换由条件消费保证至多一个成功。
- 旧码兑换与新码启用竞争按事务提交顺序决定；无论顺序如何，最多产生一个新权益窗口。
- 管理员码与自助码并发兑换仍以 Entitlement 和码条件更新事务为正确性边界。
- 不依赖 React 状态、JavaScript 进程锁或 SQLite“通常只有一个 writer”的偶然行为。

## 11. 失败模式

| 失败点 | 外部结果 | 数据结果 | 恢复 |
| --- | --- | --- | --- |
| 准备事务失败 | 503 | 无新码、无 SMTP | 安全重试 |
| 触发限流 | 429 | 无新码、无 SMTP | retry_at 后重试 |
| SMTP 明确失败 | 503 | pending 码 disabled，限流保留 | 冷却后重试 |
| SMTP 接受后进程退出 | 客户端超时 | pending 码不可兑换 | 冷却后重试；新成功码替换旧码 |
| 启用事务失败 | 503 | pending 码不可兑换 | 冷却后重试 |
| 启用前权益变为 active | 409 | pending 码 disabled | 刷新账号状态 |
| 响应丢失但启用成功 | 客户端不确定 | 邮件中 active 码仍有效 | 用户可直接兑换；再次成功申领会替换旧码 |
| 兑换事务失败 | 通用失败 | 码与权益一同回滚 | 安全重试 |

选择 pending_delivery 是明确的 fail-closed 决策。它接受“极少数已收到但不可兑换的邮件”，换取不会因 SMTP 或进程故障留下未确认的有效码。事务 outbox 没有被采用，因为在异步发送前必须可恢复地保存明文或可解密密文，并引入后台投递器，超出当前小型服务需要。

## 12. 安全与隐私

- 请求必须携带有效桌面 session；Server 从 session 解析用户和邮箱。
- 请求体不能覆盖收件邮箱、用户 ID、权益天数或配额。
- 绑定校验位于 Store 兑换事务，而不是只在 route/service 层。
- 码使用现有加密安全随机生成器，标准化后仅存 SHA-256 和短前缀。
- 邮件正文和明文码不进入结构化日志、错误对象、Admin Web、桌面 IPC 响应或诊断导出。
- Admin Web 只显示来源、短前缀、绑定用户、状态、sentAt、redeemBy 和 redeemedAt。
- API 依赖 HTTPS；SMTP 依赖现有 TLS 配置和生产 fail-closed 配置。
- 限流 key 为版本化 hash；自助发码不新增原始 IP 持久化字段。
- 该能力不改变本地优先媒体边界，account server 仍不接收内容数据。

## 13. 配置与发布

新增 FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED：

- production 必须显式配置 true 或 false；
- development/test 默认 false，测试用例按需打开；
- false 时账号状态返回 can_request_activation_code=false，申领 route 返回 FEATURE_NOT_AVAILABLE；
- 该开关是发布和邮件滥用事件的紧急止损手段，不改变已有管理员码兑换能力。

发布顺序：

1. 部署兼容迁移和 Server，保持功能开关 false；
2. 验证数据库迁移、SMTP 模板、健康检查、限流和 Admin Web 列表；
3. 发布能理解可选 capability 字段的桌面客户端；
4. production 开关设为 true；
5. 验证未授权、过期、有效授权和邮件失败四条路径；
6. 需要回滚时先关闭开关，再回滚客户端或 Server。

不在设计阶段修改 docs/ARCHITECTURE.md 对当前已实现系统的描述。实现完成并通过门禁后，再把“管理员发码是当前唯一可见路径”的现状文字更新为自助邮件发码。

## 14. 测试策略

### 14.1 Server

- 未授权和过期账号可以准备、发送、启用自助码。
- 有效权益在准备和启用两个阶段都被拒绝。
- 收件邮箱只能来自 session 用户。
- SMTP 发送前码为 pending_delivery 且不能兑换。
- SMTP 失败和启用失败不会产生 active 码。
- 新码启用后旧自助码失效；管理员通用码不受影响。
- 绑定账号兑换成功，其他账号得到通用无效错误。
- 自助码不能给有效权益续期或叠加 Credits。
- 权益过期后可无限重复新周期，每周期重置 20/0。
- 邮箱/IP 限流、Retry-After、失败计数和数据库重启后限流持久化。
- memory store 与 PrismaStore 的闭集结果一致。
- 独立 Prisma clients 并发申领至多一次 SMTP，余额/权益并发兑换至多一次授予。
- migration 对新数据库和已有管理员码数据库均可应用。
- Admin Web 不显示完整码，日志不包含邮件正文或敏感头。

### 14.2 Rust/Tauri

- request_activation_code 只发送 locale 和 bearer session。
- 成功响应严格解析；缺字段、错类型和未知闭集值 fail closed。
- 401、404、409、429、503 映射为稳定的 IPC 错误。
- 日志和诊断导出不包含 session、邮件正文或激活码。

### 14.3 React

- 未登录隐藏按钮。
- 未授权和过期显示按钮。
- 有效授权隐藏按钮。
- capability 缺失或 false 时隐藏申领按钮，但保留管理员码兑换兼容入口。
- 发送中防重复，成功/限流按 retry_at 禁用，失败可恢复。
- 兑换成功刷新状态并隐藏按钮。
- 新旧异步请求竞争遵循现有 operation ownership，不让旧响应覆盖新账号状态。
- 三语言资源和 i18n literal gate 通过。

### 14.4 回归门禁

- npm --prefix server test
- npm --prefix server run build
- npm --prefix app test
- npm --prefix app run lint
- npm --prefix app run build
- cargo test --manifest-path app/src-tauri/Cargo.toml
- python scripts/validate_agents_docs.py --level ERROR
- python scripts/validate_agents_docs.py --level WARN

worker 无直接改动，但完整发布门禁仍按 docs/EXECUTION_GATES.md 执行。

## 15. 验收场景

1. 新用户登录后看到申领按钮，点击后收到绑定码；手动兑换后按钮消失，获得 31 天与 20 Credits。
2. 授权有效期间，UI 不显示申领按钮；直接调用 API 返回 ENTITLEMENT_ACTIVE。
3. 31 天到期后按钮重新出现；用户可以再次领取和兑换，不限制累计周期数。
4. 同一账号请求第二封成功邮件后，第一封中的未兑换自助码失效。
5. 用户 A 的自助码不能被用户 B 兑换。
6. SMTP 故障或服务崩溃不会留下可兑换的 pending 码。
7. 并发请求和并发兑换都不会创建叠加权益。
8. 管理员创建的通用码仍可按现有规则兑换和延长有效权益。

## 16. 后续工作门禁

本设计确认后，实施前必须：

- 以本设计和产品规格创建 docs/exec-plans/active 下的 ExecPlan；
- 在 ExecPlan 中列出 schema migration、Store TDD、Server route、邮件模板、Rust IPC、React UI、i18n、Admin Web 和文档同步任务；
- 由用户确认 ExecPlan 后再修改实现；
- 实现完成后更新 docs/ARCHITECTURE.md、相关安全说明、TASKS.md 和发布台账。
