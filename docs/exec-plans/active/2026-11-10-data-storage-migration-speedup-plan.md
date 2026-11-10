# 2026-11-10 数据存储迁移提速执行计划

状态：第一批 4 项 + 第二批（verify_published 降级、build 清单并行化）**代码完成**；data_storage 全模块 88 passed / 0 failed（用户干净环境，针对第一批；第二批待复跑）。recheck 后台化、同卷 rename、validator fingerprint 化维持单独立项。

## 目标

把「更改数据存储位置」的全量哈希/复制耗时降到约原来的 1/3，不削弱迁移的数据安全保证：源保留、断点恢复、`SourceChanged` 检测、逐字节校验语义全部保持。

## 背景量化

当前一次非合并迁移对全部数据做约 7 遍 SHA-256（约 3 遍读源 + 4 遍读目标），且树遍历、哈希、复制、进度持久化全部单线程串行：

| 阶段 | 代码位置 | 哈希遍数 |
| --- | --- | --- |
| prepare 建清单 | `inventory.rs::build_with_progress` | 源 ×1 |
| start 源重验 | `inventory.rs::verify_sources_with_progress` | 源 ×1 |
| copy | `migration.rs::copy_entry`（读源 + 边写边哈希） | 源 ×1（读），目标 ×1（写时） |
| copy 后目标重哈希 | `copy_entry` 末尾 `hash_open_file_while` | 目标 ×1 |
| verifying | `migration.rs::verify_destination` | 目标 ×1 |
| publish 后 | `migration.rs::verify_published` | 目标 ×1 |
| 重启 recheck | `migration.rs::recheck_inner` | 目标 ×1 |

10 GB 库 ≈ 70 GB 读 + 哈希，HDD 上十几分钟量级。

## 改动范围（第一批，本次实施）

| # | 改动 | 文件 | 安全性论证 |
| --- | --- | --- | --- |
| 1 | 复制与哈希并行化（2-8 worker，进度按序汇总，保持清单确定序；`verify_destination` 同样并行化） | `migration.rs::start_inner_with_preflight`、`verify_destination`、`worker_count()` | 各文件间无依赖；哈希与校验语义不变，只改执行顺序 |
| 2 | 砍掉复制后对刚写文件的重哈希 | `migration.rs::copy_entry` 删除末尾 `hash_open_file_while` 重开重哈希 | 写入时已边写边算哈希且 `sync_all`，该层只防磁盘写路径静默损坏，收益极低；`verify_destination` 仍全量兜底 |
| 3 | start 源重验改廉价判定：同一物理文件（identity 一致）且长度与权限未变时直接沿用清单 SHA-256，失配才重哈希 | `inventory.rs::verify_sources_with_progress` → `visit_verified` | inventory 已记录每条目的 `identity` 与 `length`；同 identity 同长度的原地内容篡改由复制阶段写时哈希兜底（`copy_entry` 边读边比对清单哈希），不在这里重复承担 |
| 4 | persist 节流：复制与目标验证改为每 250 ms 轮询持久化一次（原复制每 8 MiB、验证每文件持久化） | `migration.rs`（`PARALLEL_POLL_INTERVAL`、`parallel_progress_poll`） | control JSON 只承载进度计数；resume 已按 inventory 逐文件幂等，计数滞后最多一个轮询周期，只影响进度条不影响恢复正确性 |

## 第二批（2026-11-10 实施）

| # | 改动 | 文件 | 备注 |
| --- | --- | --- | --- |
| 5 | ~~estimate + build 合并为单遍树遍历~~ **决定不做** | — | estimate 是纯元数据遍历（秒级），真正开销在哈希；合并会在哈希完成前失去「空间不足」早期报错与进度总量（10 GB 库塞 1 GB 空间会白等数分钟哈希）。收益远小于损失。 |
| 6 | `verify_published` 降级：publish 是 `rename_no_replace` 不改内容，payload 已由 verify_destination 全量哈希；发布后校验降为权限 + 文件可打开 + 命名空间结构比对 | `migration.rs::verify_published` | 重启后 recheck 仍全量校验一次 |
| 7 | build 清单哈希并行化（用户委托决策后实施）：遍历阶段只收集元数据，文件 SHA-256 交给 2-8 worker（`hash_entries_parallel`），结果按原下标回填；跨源任务树比对与目标去重移到哈希之后（哈希前 sha 为空无法发现同任务内容冲突） | `inventory.rs::build_inner`、`visit`、`hash_entries_parallel` | 原 estimate 路径（hash=false）行为不变；进度从逐块改为 250ms 聚合轮询 |

第三批（单独立项，未实施）：recheck 后台化（动 UI 状态机）、同卷 rename 快速路径（动源保留/回滚语义，需设计文档）、validator fingerprint 化（动 worker 契约边界）。

## 不在本计划内（单独立项，见上「第三批」说明）

- **recheck 全量哈希后台化**：改「重启后可用性」的产品语义（模型/运行时就绪状态延迟确认），牵动 UI 状态机。
- **同卷 rename 快速路径**：动源保留与回滚语义，需独立设计文档。
- **validator verify 侧用 fingerprint 文件比对替代真实 worker import**：涉及 `data_storage_validation.rs` 与 worker 契约，单独评估。

## 验收门禁

- `cargo test --manifest-path app/src-tauri/Cargo.toml`（`RUST_MIN_STACK=16777216`，注意 52 项既有失败基线，需 stash 对照或单跑判定回归）。
- `data_storage` 现有验收测试全绿（`tests.rs`、`merge_reading_tests.rs`、`data_storage_validation.rs`）。
- 新增并行化测试：乱序完成下进度汇总与最终 state 一致；cancel 竞态下无文件泄漏。
- 真实迁移端到端（本机，非模拟）：迁移一个含 outputs + 模型 + runtime 的真实库，记录迁移前后耗时对比与 `recheck` 结果；源目录保留、字节级比对抽样通过。
- 文档治理：`uv run python scripts/validate_agents_docs.py --level ERROR`。

## 决策记录

- 分批推进：第一批 4 项是纯执行层优化，不改变任何校验语义；第二、三批涉及语义取舍，先不实施。Date: 2026-11-10 / WorkBuddy + User。
- 源重验廉价判定用 inventory 已有 `DirectoryIdentity`（volume + file index），不引入新持久化字段。Date: 2026-11-10 / WorkBuddy + User。
- persist 节流从「64 MiB / 512 文件阈值」简化为「250 ms 轮询持久化」：语义等价（每轮询周期至多一次小 JSON 写），且 UI 进度与持久化保持同步（`state()` 读的是 persist 写入的 inner.control）。Date: 2026-11-10 / WorkBuddy。
- 3 个依赖「重验阶段逐块哈希进度」的测试按新语义改写：改为在 prepare 后改变文件长度（identity+length 失配）强制走重哈希路径，保留「重验期间可取消」的测试意图；新增 `inventory_preflight_source_reverification_skips_hashing_while_identity_and_length_hold` 覆盖廉价判定三条行为（未变文件跳哈希、同长度原地改写不拦截、长度变化报 SourceChanged）。Date: 2026-11-10 / WorkBuddy。
- 第二批 item 5（estimate+build 合并）实施前否决：estimate 元数据遍历秒级，合并牺牲空间早期报错与进度总量，收益不抵损失。Date: 2026-11-10 / WorkBuddy（用户委托决策）。
- 第三批三项（recheck 后台化 / 同卷 rename / validator fingerprint 化）用户委托决策后维持单独立项：分别动产品语义、安全语义与 worker 契约，不应与本性能批次捆绑。Date: 2026-11-10 / WorkBuddy（用户委托决策）。
- build 清单并行化实施（第三批唯一提前项）：剩余唯一单线程全量哈希遍历，复用已落地的 worker 池模式，不碰产品语义。进度从逐块哈希事件改为 250ms 聚合轮询，两个依赖逐块进度的测试改写（哈希完成断言 + 大文件线程定时取消），只读真实库测试的 reports 断言放宽为 `reports>0`。Date: 2026-11-10 / WorkBuddy（用户委托决策）。

## 验证记录

- `cargo check --lib` 通过（含并行化后的借用检查）。
- 2026-11-10 用户干净环境（agent 宿主之外）`cargo test --lib data_storage::`：**88 passed / 0 failed / 9 ignored**。含 5 个改写/受影响测试（`skips_hashing_while_identity_and_length_hold`、`reports_real_chunks_and_cancels`、`can_cancel_before_copying`、`reports_real_reverification_before_native_copy`、`cancelled_resume_reverification_restores_the_previous_location`）全部通过——并行复制、并行目标验证与廉价重验端到端走通。
- agent 宿主内无法得出有效结论：本机环境对测试真实文件删除的拦截（name-probe 清理 `PermissionDenied`，os error 5）在基线与改动后同样出现、非沙箱模式下也复现、同一测试多次运行结果不稳定，失败全部落在 `Fixture::prepare` 入口、无一进入 copy/verify 逻辑。教训：**本机 data_storage 测试的通过/失败集合逐次波动（今日基线 32 挂、改动后 39-43 挂、用户环境 0 挂），判回归必须用干净环境单跑或跑全模块，不能拿宿主内波动计数对比**。

## 残余风险

- 并行复制在 HDD 上可能因随机寻址反而变慢；当前按 `available_parallelism` 收敛到 [2,8]，实施后未在 HDD 上实测，后续可按介质探测线程数。
- 砍掉写入后重哈希后，磁盘静默位翻转由 `verify_destination` 全量兜底拦截，窗口期从「写完立即」变为「verifying 阶段」。
- persist 节流后，进程被强杀时进度计数可能滞后最多 250 ms 的量，UI 显示与实际 payload 可复用文件数有短暂偏差；resume 路径按 inventory 逐文件幂等，数据不受影响。
- `cargo test --lib` 全量复跑（用户环境）与本机真实迁移端到端计时对比（10 GB 量级、迁移前后耗时）尚未完成。
