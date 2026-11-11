# 改名为 Locus 并去品牌化命名

状态：2026-11-09 用户确认两件事——改名为 **Locus**（去掉中文名「影问」），且**不要再用品牌名做文件、代码、路径命名**；因为项目尚未推广、没有外部用户，所有标识都可以一次性改干净，不写迁移代码。

配套设计规范：`docs/design-docs/2026-11-09-neutral-naming-policy.md`。

## 用户目标

1. 用户看到的每一处产品名都是 Locus：窗口标题、应用内三语文案、安装包文件名、安装目录、营销站、README、邮件与 Admin 页。
2. 品牌名从机器标识里彻底消失：包名、环境变量、应用标识符、数据库文件、磁盘契约、日志名、测试夹具都不再含 `frameq`。
3. 下一次改名只需要改 3 个常量与文档，不需要再动 660 个文件。

## 命名映射

| 现状 | 改为 | 层 |
| --- | --- | --- |
| `FrameQ`（品牌文案） | `Locus` | 文案 |
| `影问` | 删除，只保留 Locus | 文案 |
| `frameq_worker`（包） | `worker_core` | 代码 |
| `frameq-worker`（分发名） | `worker-core` | 代码 |
| `FRAMEQ_*`（103 个环境变量） | `APP_*` | 运行时 |
| `com.frameq.desktop`（标识符） | `pro.8xf.app` | 运行时 |
| `frameq.sqlite` | `app.sqlite` | 数据 |
| `frameq-task.json` | `task.json` | 磁盘契约 |
| `.frameq-artifact-transaction.json` | `.artifact-transaction.json` | 磁盘契约 |
| `.frameq-artifact-{id}-{i}.{kind}` | `.artifact-{id}-{i}.{kind}` | 磁盘契约 |
| `frameq-desktop.log` | `desktop.log` | 诊断 |
| `frameq-pytorch-runtime-<target>.zip` | `pytorch-runtime-<target>.zip` | 发布资产 |
| `FrameQ-install.log`、`.frameq-install-probe`、`FrameQLog` 等 | `install.log`、`.install-probe`、`AppLog` 等 | 打包 |
| `frameq-<临时名>`（测试夹具、探针、临时目录） | `app-<临时名>` | 测试 |
| `?frameq-updater=1` | `?updater=1` | 更新链路 |
| `FrameQ_<version>_x64-setup.exe` 等 | `Locus_<version>_x64-setup.exe` 等（由 productName 派生） | 发布资产 |

## 不在本次代码范围内（需要运维动作）

| 身份 | 现状 | 说明 |
| --- | --- | --- |
| 生产域名 | `locus.8xf.pro` | 已于 2026-11-11 完成 DNS、证书与 nginx 切换，旧域名不保留别名 |
| GitHub 仓库 | `jiabai/Locus` | 已于 2026-11-10 改名；updater endpoint、组件下载 URL 与站点链接同批更新 |
| 生产服务名 | `locus-server` | 已于 2026-11-11 由 `frameq-server` 改名（unit、仓库样例与运行手册同步） |
| 生产部署目录 / 数据库文件 | `/home/ubuntu/app`、`app.sqlite` | 已于 2026-11-11 迁移（checkout、nginx `root`、systemd `WorkingDirectory`/`ReadWritePaths`、`DATABASE_URL` 同步） |

仓库地址分散在若干常量与配置中（Tauri updater endpoint、`runtime_component.rs`、`updates.rs`、`brand.ts`、`updateClient.ts`、`site/src/consts.ts` 等），2026-11-10 已统一换成新名；生产域名、部署目录与服务名仍待运维迁移。

## 关键约束

1. 磁盘契约名同时出现在 `contracts/task-artifact-transaction-v1.json`、Python `task_transaction.py`、Rust `task_manifest/transaction.rs` 三处；必须三处一致，否则 worker 写的 journal 会被桌面端整份拒绝，任务静默从历史消失。
2. 环境变量改名后，本机 `app/src-tauri` 首次启动写入的 `.env` 模板、安装包内 `.env.template`、`.env.example` 三份必须同步，否则新装用户拿到旧默认值。
3. 应用标识符变更会改变应用数据目录；本次不写迁移，旧目录保留在原处，本机验证时手工备份后再使用新目录。
4. 文案层不再硬编码品牌：三语文案改用 `{{product}}` 占位，渲染时替换为常量。

## 验收标准

- `git grep -i "frameq"` 在代码与活文档中仅剩「外部身份」表中的域名、仓库、部署目录。
- `git grep -i "影问"` 为 0。
- 三端门禁全绿：ruff、worker 全量、前端测试与构建、服务端测试与构建、`cargo test`、脚本测试、文档治理、`git diff --check`。
- 本机 `tauri build --no-bundle` 产物能启动，数据目录为新标识符，功能正常。
- 本机编译安装包，静默安装到干净环境后：安装目录为 `%LOCALAPPDATA%\Locus`，卸载项显示 Locus，日志为 `install.log`。
