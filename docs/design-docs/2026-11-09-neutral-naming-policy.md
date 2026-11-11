# 中性命名规范（去品牌化）

| 字段 | 值 |
|------|---|
| 状态 | Confirmed，2026-11-09 用户确认「为了改名方便，尽量不要用品牌名做文件、代码、路径等的命名规则」 |
| 创建日期 | 2026-11-09 |
| 作者 | WorkBuddy |
| 关联文档 | `docs/product-specs/2026-11-09-project-rename-locus.md`、`docs/ARCHITECTURE.md` |
| 决策性质 | 改变仓库内部命名约定、持久化契约文件名、环境变量前缀与应用标识符 |

## 问题

项目原来把品牌名写进了几乎每一层：Python 包 `frameq_worker`、环境变量 `FRAMEQ_*`、应用标识符 `com.frameq.desktop`、数据库 `frameq.sqlite`、磁盘契约 `frameq-task.json`、日志 `frameq-desktop.log`、安装包 `Locus_<version>_x64-setup.exe`，以及三语文案里的 106 处字面量。

改名因此不是「改一个名字」，而是 660 个文件、5,806 处引用的连带改动，还牵扯到用户数据目录、生产 `.env`、老任务恢复和更新链路。这与「产品名应该可以随时更换」的商业现实冲突。

## 规范

### 1. 品牌只出现在文案层，不进入机器标识

品牌名只允许出现在：界面文案、营销站文案、邮件与页面正文、README 与文档正文、发布说明。

禁止出现在：包名、模块名、目录名、环境变量名、应用标识符、数据库文件名、磁盘产物名、日志文件名、测试夹具名、协议字段名、注册表键。

### 2. 机器标识用「组织域 + 角色」表达

| 标识 | 取值 | 说明 |
| --- | --- | --- |
| 应用标识符 | `pro.8xf.app` | `8xf.pro` 反转 + 通用角色 `app`，不含产品名。首次发布后永久冻结 |
| 环境变量前缀 | `APP_` | 单一前缀，不含产品名 |
| 数据库文件 | `app.sqlite` | 角色名 |
| 任务清单 | `task.json` | 角色名 |
| 事务日志 | `.artifact-transaction.json`、`.artifact-{id}-{i}.{kind}` | 角色名 |
| 桌面日志 | `desktop.log` | 角色名 |
| 运行组件资产 | `pytorch-runtime-<target>.zip` | 能力名，不含产品名 |

### 3. 代码结构用角色名

| 层 | 目录 / 包 | 说明 |
| --- | --- | --- |
| 桌面端 | `app/`、`app/src-tauri` | 角色 |
| 转写服务 | `worker/`，包 `worker_core`，分发名 `worker-core` | 角色 |
| 账号与计费服务 | `server/` | 角色 |
| 营销站 | `site/` | 角色 |
| 契约 | `contracts/` | 角色 |

### 4. 品牌名在文案里只有一个来源

- 桌面端：`app/src/brand.ts` 导出 `PRODUCT_NAME`；三语文案用 `{{product}}` 占位，渲染时替换。文案文件里不再出现字面量。
- 服务端：`server/src/brand.ts` 导出 `PRODUCT_NAME`，登录页、Dashboard、Admin、邮件正文统一引用。
- 站点：`site/src/consts.ts` 的 `PRODUCT_NAME`，安装包文件名用模板拼装，不写死。

改名的操作因此降级为：改 3 个常量 + 文档 + 站点措辞。

### 5. 品牌相关的外部身份单点登记

仓库地址、生产域名、数据目录等无法在代码里中性化的身份，集中登记在 `app/src/brand.ts` 与 `server/src/brand.ts`，并在本文件「外部身份」一节列出。变更这些身份属于发布/运维动作，不属于改名。

**GitHub Actions Secret 名称同样属于外部身份，不适用于第 1 节的「环境变量名」规则。** Secret key 存在于仓库设置里，GitHub 不提供读取旧值的接口；改名必须重新录入值，且工作流引用与 Secret 名的不一致不会在常规 CI 中暴露，只在打 tag 发布时让 runner 拿到空值。因此 Secret key 保持创建时的名字，去品牌化只改**消费侧环境变量名**。映射由 `scripts/tests/desktop-release-workflow.test.mjs` 与 `scripts/tests/macos-intel-acceptance-workflow.test.mjs` 锁定：工作流里 `APP_PYTHON_STANDALONE_URL` / `APP_FFMPEG_ARCHIVE_URL` / `APP_FFPROBE_ARCHIVE_URL` 由 `secrets.FRAMEQ_*` 赋值，脚本只读 `APP_*`。

## 外部身份（当前）

| 身份 | 取值 | 变更方式 |
| --- | --- | --- |
| 仓库 | `github.com/jiabai/Locus` | 已于 2026-11-10 改名；updater endpoint、组件下载 URL 与站点链接同批更新。旧名重定向已实测可用 |
| 生产域名 | `locus.8xf.pro` | 已于 2026-11-11 切换；旧域名 `frameq.8xf.pro` 的 DNS 记录删除，不再保留别名。客户端默认服务地址同步改为新域名（`app/src-tauri/src/account.rs` 的 `DEFAULT_SERVER_BASE_URL`），旧版客户端需升级才能继续登录与结账 |
| 生产部署目录 | `/home/ubuntu/app` | 已于 2026-11-11 从 `/home/ubuntu/FrameQ` 迁移：systemd `WorkingDirectory`/`ExecStart`/`ReadWritePaths`、nginx `root`、`DATABASE_URL` 与营销站部署脚本同步 |
| 生产数据库文件 | `server/data/app.sqlite` | 同上，从 `frameq.sqlite` 就地改名 |
| 更新清单参数 | `?updater=1` | 已中性化，无需变更 |
| GitHub Actions Secret | `FRAMEQ_PYTHON_STANDALONE_URL*`、`FRAMEQ_FFMPEG_ARCHIVE_URL*`、`FRAMEQ_FFPROBE_ARCHIVE_URL*` | 值不可读，改名须重新录入；消费侧用中性 `APP_*` 环境变量 |

## 后果

- 下一次改名的成本从「660 文件」降到「3 个常量 + 文档」。
- 代价：本次需要一次性改掉包名、环境变量、应用标识符、磁盘契约名；由于项目尚无外部用户，不写迁移代码，只在本机重装验证。
- 已安装的旧版本与旧数据目录不会自动迁移。这是明确接受的代价。
