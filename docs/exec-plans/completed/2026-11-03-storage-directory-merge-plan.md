# 已有数据目录合并执行计划

用户已在侧边对话确认全部合并规则，并明确委托主线程实施。目标是支持重装后把当前目录合并到仍保留资料的自定义目录。

## 设计与边界

空目标继续使用现有复制迁移。非空目标使用持久合并记录：同相对路径同名文件保留目标并删除源文件，缺少文件移动过去，不比较重复项内容。目标独有文件保持原位。应用资料库标记和固定位置控制记录在合并完成后统一提交，重启从目标读取任务、合集、模型和运行组件。

预检查可以取消且不删除源资料。确认开始合并后冻结数据操作，持久阶段 `merging` 不允许取消；失败和进程终止后继续原合并。逐文件操作能够识别重命名或删除已经完成但状态尚未保存的情况。同卷无覆盖重命名，跨卷真实复制核对后删除；类型冲突、链接、目录替换或权限失败在现场返回错误。

## 任务

- [x] 阅读位置控制、库存、迁移、历史和合集读取实现，确认现有资料库标识约束。
- [x] `data_storage/merge.rs`、`migration.rs`、`location.rs`：非空目标预检、持久合并记录、文件移动/删除、位置提交和重启验证。
- [x] `data_storage/engine.rs`、`control.rs`、`data_storage.rs`：恢复阶段、取消保护、互斥、关闭协调及持久记录验证。
- [x] 前端协议、迁移窗口和三语文本：展示真实合并语义和不可取消阶段，保留现有一次确认入口。
- [x] 使用隔离真实文件验证不同内容同名、两端独有文件、合集目标优先、资料库标识、实际任务读取、权限/类型/链接失败与进程中断恢复。
- [x] 运行 Rust、前端、脚本与文档检查，构建 Windows 程序，更新实施和验收记录。

## 验证命令

- `cargo test --manifest-path app/src-tauri/Cargo.toml --lib -j 1 -- --test-threads=1`
- `cargo test --manifest-path app/src-tauri/Cargo.toml --lib -j 1 merged_target_restarts_through_real_offline_worker_validation -- --ignored --nocapture --test-threads=1`
- `cargo test --manifest-path app/src-tauri/Cargo.toml --lib -j 1 merge_moves_real_files_across_distinct_volumes -- --ignored --nocapture --test-threads=1`（显式设置 `FRAMEQ_STORAGE_CROSS_VOLUME_ROOT`）
- `npm --prefix app test`
- `npm --prefix app run lint`
- `node --test scripts/tests/*.test.mjs`
- `python -m pytest scripts/tests`
- `uv run python scripts/validate_agents_docs.py --level ERROR`
- `npm --prefix app run tauri -- build --no-bundle`

测试文件使用 ignored 的 `build/data-storage-acceptance/`、`build/data-storage-merge/` 下独立目录。跨卷测试使用明确指定的 C 盘可写根内新建的 UUID 子目录；当前用户资料库不参与自动迁移或删除。

## Progress

- 2026-11-03：完成后端合并、持久恢复、三语界面与真实读取回归；Rust、前端、脚本、真实跨卷、生产 worker 验证及 Windows 构建通过。

## Decision Log

- 非空目标采用单独合并流程，空目录现有复制、清理凭据与验证行为继续有效。
- 重复文件遵守目标优先删除源文件的已确认规则；不增加重复确认。
- 持久合并阶段暂停资料操作，支持失败后继续，防止部分源目录重新成为可写资料库。

## 验收记录

- 前端：131 个测试文件通过，1480 项通过、1 项跳过；lint 通过。
- 脚本：Node 54 项与 Python 1 项通过。Python 只有既有缓存目录写入权限警告。
- 文档：0 个错误、0 个警告；最终归档后再次检查。
- 实际读取：5 项通过，覆盖目标/来源独有笔记、同名正文与作品目标优先、标题/置顶、合集、受管来源再次合并、只读重复文件及空目标原流程。
- 独立审查：服务/界面的取消和关闭保护、位置权威、逐文件恢复及跨卷只读属性恢复已复核。
- Rust 全套：556 项通过、0 项失败、28 项环境或辅助入口用例跳过，耗时 228.77 秒。
- 生产 worker：`merged_target_restarts_through_real_offline_worker_validation` 1 项通过，真实 Python 离线核验合并后的目录和目标优先合集，结束后普通数据许可可用，worker 已退出。
- 真实跨卷：D 盘来源至 C 盘独立目录，实际卷身份不同；1 MiB 复制进度时终止真实子进程，验证源存在、目标未发布、实际部分文件存在，继续后完整 SHA-256 与原件一致、重复文件目标优先、源文件删除、重启就绪，1 项通过。目标为 C 盘可写根下 `92672e8e-47d8-46ac-b398-f4a668107c42`。
- 普通恢复：真实文件移动完成及重复源删除后、逐文件记录保存前终止进程，两种情况均恢复成功；真实共享权限拒绝后恢复成功。
- Windows：`npm --prefix app run tauri -- build --no-bundle` 通过；Rust release 编译耗时 3 分 24 秒，生成 `app/src-tauri/target/release/app.exe`。构建保留既有未使用符号、时间格式 API 和前端包体大小警告；未提交、发布或安装。
- macOS实际编译/运行、原生窗口手动交互及复制中途真实容量耗尽未执行；现有平台和发行门禁继续有效。
