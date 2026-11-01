# Data Storage Location and Migration Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

在设置基础页把「输出目录」升级为已确认的「数据存储位置」横向设置项，通过明确确认迁移任务、笔记/合集、模型、组件与缓存。
凭据、设置与日志保留在系统默认应用目录。迁移先复制、核对、原子切换，再重启验证，最后由用户明确清理旧副本。
产品范围、布局与本计划的具体实现机制已经确认并完成实施。验收使用隔离资料；当前用户库没有迁移或清理。

## Progress

- [x] 2026-11-01: 读取规则、流程、门禁、相关架构/安全/设计资料并分三组完成只读路径和守卫调查。Validation: runtime/settings/worker/manifest/媒体授权与前端启动源码，以及三份只读审查结果。
- [x] 2026-11-01: 记录已确认产品范围与布局，定义兼容、互斥、切换、恢复和清理边界。Validation: `docs/product-specs/2026-11-01-data-storage-location.md`。
- [x] 2026-11-01: 完成规格/计划交叉复核与文档治理，明确跨IPC准备、访问状态、物理根身份、相对旧输出和多次迁移清理。Validation: 两组最终只读复核无剩余确认阻断项；文档治理0错误0警告，git diff --check exit 0。
- [x] 2026-11-01: 确认本技术执行计划并开始实施。Validation: 本线程用户回复“确认，按计划实施”。
- [x] 2026-11-01: 前端设置、三语迁移/恢复、编辑会话、复合处理链和更新/关闭守卫接入。Validation: 全量前端125文件/1389项通过，lint通过；真实Chrome生产构建检查5项通过。
- [x] 2026-11-01: 正式只读worker核验协议和迁移路径接入，并刷新安装资源worker镜像。Validation: worker 1221 passed/4 skipped；ruff通过；资源镜像与源码逐字节一致；Node脚本51项、Python文档脚本1项通过。
- [x] 2026-11-01: 完成固定配置/可迁移数据边界、启动状态、访问协调器与全模块路径接入。Validation: 完整Rust串行运行465 passed/7 ignored，保留全部进程树、超时与清理断言；真实取消、canary、跨卷检查另外执行通过。
- [x] 2026-11-01: 完成预检、复制核对、提交、恢复、重启验证和精确清理。Validation: 持久阶段及预检内部真实进程终止、源变化再确认、目录替换、真实ACL拒绝、只读控制失败、同身份重定位、多次迁移清理与停止清理均通过。
- [x] 2026-11-01: 完成基础页入口、确认进度、编辑/忙碌保护和三语恢复界面。Validation: 真实WebView2三语设置行四CSS视口、模型草稿保留、目录选择/取消；Prepared重开预览、确认复制、实际受控重启、Ready及媒体授权通过。
- [x] 2026-11-01: 完成门禁、真实模型/组件功能验证与文档同步。Validation: 18,232文件/785,611,445字节恢复迁移、ONNX ASR和迁移前后真实组件导入通过；Windows正式构建与正常资料启动通过。环境缺失项目见实际验收记录。

## Surprises & Discoveries

- Evidence: `runtime.rs:23–39` 仅有 resource_dir/user_data_dir；`:61` 的 ensure_runtime_dirs 会创建默认数据目录并删除旧 work。
  `lib.rs:92` setup 尚无数据位置准备，`main.tsx:16–30` 只进行语言准备；App 启动会恢复删除、刷新历史和合集。
  所以位置解析/恢复必须早于这些写入，不能在普通设置加载完成后再改路径。
- Evidence: `task_manifest/storage.rs:10–20`、`settings.rs:299–311` 的有效旧输出优先级是 .env → 进程环境 → 默认 outputs；
  设置视图仅返回 .env 值。历史扫描只看一个输出根，`task_manifest/access.rs:67–105` 还会忽略部分目录并恢复事务。
  库存必须完整枚举，不以历史可见列表作为迁移或清理范围。
- Evidence: `worker_runtime/command.rs:234–291` 把 outputs/cache/models/runtime 与配置目录一起派生；
  `worker/config.py:23–39` 使用 USER_DATA_DIR/.env。新的数据根不能替换配置根或worker的固定配置cwd。
- Evidence: 任务 artifacts/draft_path 为相对路径；自动标题在 manifest，手动名称和固定在 task sidecar；合集在默认根的 collections.json。
  本地原始媒体只在请求时使用，正式任务保存自有副本。完整任务树可按字节迁移，无需全局替换路径字符串。
- Evidence: `tauri.conf.json:29` 仅授权默认outputs/播放缓存，`transcript_detail.rs:98–102` 仍拼接默认目录；迁移必须同步播放路径和最小授权范围。
- Evidence: `.frameq-note-deletion.json` 含根/任务/缓存身份，任务另有 prepared/committed 事务；迁移前需要处理这些恢复记录。
  `ProcessSupervisors` 的任务/下载通道与各模块局部锁不能提供全库互斥，播放准备和历史读取还可能写入缓存或恢复事务。
- Evidence: DraftResultSheet dirty 为内部状态，设置/档案/合集另有局部草稿；窗口关闭与更新重启当前没有迁移保护。
  设置内部storage分类的显示名已为「缓存」，数据位置仍使用基础入口。

## Decision Log

- Decision: 保留固定配置根，新增统一数据根及 Rust DataStorageManager；安装资源保持不可迁移职责。Rationale: 凭据/设置边界与大文件迁移同时成立，避免逐处重定向user_data_dir。Date/Author: 2026-11-01 / User + Codex。
- Decision: 固定根的单个原子控制JSON同时持有active位置和pending阶段，目标内部存放大库存/校验凭据。Rationale: 位置提交只有一个权威写入，固定盘只保留少量控制资料。Date/Author: 2026-11-01 / Codex。
- Decision: 旧输出环境只用于legacy兼容；managed控制记录存在后，普通设置保存与进程输出环境不能改库。Rationale: 避免旧设置草稿或两份配置形成分歧，兼容现有用户直到主动迁移。Date/Author: 2026-11-01 / Codex。
- Decision: 统一后端操作许可、迁移独占与固定根进程锁；读操作中的恢复/缓存写入同样受控。Rationale: 前端导航守卫及单任务锁无法覆盖全部写入。Date/Author: 2026-11-01 / Codex。
- Decision: 复制/核对完成才提交，提交后保持暂停直至重启验证；清理使用单独确认和逐文件凭据。Rationale: 保持原件、任务身份和唯一副本保护，允许中断后重判权威位置。Date/Author: 2026-11-01 / User + Codex。
- Decision: 数据不可用时只挂载恢复入口，验证已有库后才能重新定位；不自动新建默认资料库。Rationale: 避免把离线/损坏显示成空历史。Date/Author: 2026-11-01 / User + Codex。
- Decision: 应用重启只由应用内受控命令执行；同一临界区停止数据许可并释放配置进程锁后才调用request_restart，旧实例继续拒绝写入。Rationale: Tauri重启退出无法使用普通prevent_exit保护，且新进程可能先于旧进程退出取得配置锁。Date/Author: 2026-11-01 / Codex。
- Decision: 独立审查后的恢复验证覆盖预检内部材料、盘符变化、取消后编辑再预检，以及清理期间新副本文件保护。Rationale: 持久阶段外的材料和外部文件操作也必须保留恢复依据及唯一完整副本。Date/Author: 2026-11-01 / Codex。

## Context and Orientation

- Spec: `docs/product-specs/2026-11-01-data-storage-location.md`。
- Rust模块：`app/src-tauri/src/data_storage.rs`（命令/组合边界），私有 `data_storage/{engine,location,control,inventory,migration,owned_artifacts,cleanup,tests}.rs`；正式worker核验组合位于 `data_storage_validation.rs`。
- 共用安全文件系统：`app/src-tauri/src/safe_filesystem.rs` 与 `safe_filesystem_unix.rs`，提供祖先/no-follow/文件身份与句柄安装能力，原删除错误映射与约束继续保留。
- 路径/启动/权限：`runtime.rs`、`lib.rs`、`settings.rs`、`task_manifest/storage.rs`、`tauri.conf.json`；依赖声明/锁定在 `app/src-tauri/Cargo.toml` 与 `Cargo.lock`。
- 数据使用者：`worker_runtime/command.rs`、`asr_model.rs`、`runtime_component.rs`、`collections.rs`、`note_actions.rs`、`history.rs`、`history_deletion.rs`及其私有模块、`transcript_detail.rs`/audio_playback、`draft_detail.rs`、`video_processing/`。
- 固定使用者：`account.rs`、`ui_preferences.rs`、`insight_preferences.rs`、`updates.rs`、`diagnostics/`；只改职责明确的accessor，不迁移这些配置或凭据。
- 前端新增 `app/src/dataStorageClient.ts`、`app/src/dataStorageProtocol.ts`、`app/src/features/dataStorage/StorageBootstrap.tsx`、`DataStorageSetting.tsx`、`DataStorageMigrationSheet.tsx`、`useDataStorageController.ts`及对应测试。
- 前端接入：`main.tsx`、`App.tsx`、settingsClient、SettingsSheet/useSettingsController、DraftResultSheet和各实际编辑/保存所有者、useAsrModelDownload、useAppUpdateController、window_chrome、tauriIpcProtocol与三语资源。
- Worker参考与回归：`worker/config.py`、`task_store.py`、`task_transaction.py`、`asr_runtime/registry.py`、`model_download.py`、`runtime_component.py`；环境名称和任务格式保持，添加真实跨根回归。
- 验收资料：主要位于ignored `build/data-storage-acceptance/`；跨卷另用已授权C盘隔离工作区，原生应用使用独立标识 `com.frameq.storage-acceptance-20261101-3e8a` 的临时app-local目录。公开模型与组件只读复制，不读取当前用户凭据、真实.env或私有媒体。

## Plan of Work

### Task 1: 位置模型、控制记录与安全文件系统

- [x] 在location定义固定 `config_root`、安装 `resource_root`、有效 `data_root`、`output_root`、cache/models/runtime/collections accessor。
  RuntimePaths 保持明确职责；`FRAMEQ_USER_DATA_DIR`、worker cwd 和 env_path 继续使用config_root。
  固定控制文件命名为config_root/data-storage.json，进程锁为config_root/.data-storage.lock，根标记为data_root/.frameq-storage/store.json。
- [x] 固定配置入口使用独立resolve_fixed_paths/ensure_config_dirs；语言、账号、偏好、日志和恢复查询在数据盘不可用时仍可读取固定配置。
  去除这些命令对ensure_runtime_dirs的数据初始化副作用；数据入口必须先从Manager取得已验证DataPaths，禁止反向依赖固定服务触发默认空库。
- [x] 控制记录使用serde/serde_json，禁止未知字段、非法阶段、非绝对路径和过大记录；复用atomic_files同步写入/替换。
  新安装可初始化默认位置；升级时无控制记录采用legacy快照并保留有效旧输出设置，不自动搬迁。
- [x] 核心契约采用以下语义闭集，持久字段由serde及严格值校验维护：

```rust
enum StorageMode { Legacy, Managed }
enum MigrationPhase {
    Waiting, Prepared, Copying, Verifying, Publishing,
    RestartRequired, Validating, CleanupAvailable, Cleaning,
    Cancelled, Failed,
}
enum DataAccess { Ready, Quiescing, RecoveryRequired, RestartRequired, Unavailable }
struct ActiveStorage {
    mode: StorageMode,
    library_id: uuid::Uuid,
    generation: u64,
    data_root: std::path::PathBuf,
    root_identity: DirectoryIdentity,
    legacy_output_root: Option<std::path::PathBuf>,
}
struct DirectoryIdentity { volume: u64, file: u64 }
struct ReceiptRef {
    operation_id: uuid::Uuid,
    relative_path: std::path::PathBuf,
    sha256: String,
}
// StorageControlV1的固定字段：schema_version、active、pending、cleanup_receipts、cancelled_copy_refs。
// pending保留operation_id、实际durable_phase、旧active快照、目标/来源identity、inventory引用、游标及last_error。
// Failed/Cancelled为UI结果；last_error不覆盖实际durable_phase。清单在数据根中，固定记录有256KiB上限。
```

- [x] 操作命名空间固定为 `.frameq-storage/operations/<operation_id>/{inventory.json,payload,partial,temporary}`；历史清理凭据位于 `.frameq-storage/receipts/<operation_id>/`。有界游标与临时材料归属在固定控制记录中持久保存。
  只发布outputs/cache/models/runtime/collections.json等声明的数据项，历史receipt按控制记录引用独立导入；当前operation元数据只按本次ID/身份/摘要排除数据计数。
  不对任意隐藏文件豁免校验，不把源整个.frameq-storage覆盖到目标当前操作目录；同ID receipt内容不一致即冲突。

- [x] 抽取安全文件系统能力：全祖先检查、no-follow打开、目录固定句柄、volume/file identity、普通文件类型与hardlink检查。
  源和目标拒绝symlink/junction/reparse及link count不为1的文件，明确报告并保留原件；不将未知路径转换为递归删除能力。
- [x] 真实文件测试证明控制记录原子替换后只可能为旧/新完整记录；非法/缺失目标不触发默认outputs创建；已有删除安全测试保持。

### Task 2: 统一访问许可与启动准备

- [x] DataStorageManager持有已验证位置快照、短临界区Mutex计数及操作许可；许可跨async运行期间仅持有拥有型句柄，不持有MutexGuard。
  普通数据操作先取得许可再解析路径；内部子调用继承许可，避免迁移等待时再次申请造成中途拒绝。
- [x] 前端先进入本地Preparing，冻结新的用户动作，但允许已经登记的复合流程收尾和所属编辑会话执行保存/放弃/取消。
  等待process→标题→自动合集提交、保存→刷新等完整promise结束、dirty清除，以及既有更新完成后，才发送prepare_data_storage_migration。
  后端此时进入Waiting拒绝新数据许可，并排空已经接受的调用后进入Prepared；不采用跨前端IPC继承临时许可的假设。
  Waiting取消释放维护状态；固定凭据/日志服务与必要恢复命令独立可用。
- [x] 固定config_root锁文件用 `std::fs::File::try_lock` 保证同一配置的进程互斥；争用返回封闭错误，不无限阻塞UI。
  同一目标由迁移ID/目标身份及目标锁共同保护。锁只约束合作进程，源外部变化仍由完整性复核发现。
- [x] 在Rust setup注册Manager；在语言准备完成后、App挂载前由StorageBootstrap查询状态。
  DataAccess由控制记录的实际阶段与active验证结果统一派生；RecoveryRequired/RestartRequired/Unavailable仅挂恢复界面，Ready才挂App。
  CleanupAvailable或仅有cleanup receipt仍为Ready，不阻止正常读写；避免把pending非空一律当不可用。
- [x] 将窗口关闭、更新安装/relaunch接入阶段保护，并在Rust CloseRequested/ExitRequested处理普通系统关闭。
  既有updateBusy先完成；若更新已安装待重启，先完成更新重启，再允许迁移Prepared。
  切换前普通关闭先请求取消并等待持久阶段；提交后允许受控重启，无法拦截的强制退出依赖恢复协议。
- [x] 两个真实进程、真实线程与文件证明互斥；两个worker通道、事务恢复、缓存准备均持有许可；自动合集通过前端完整promise排空后再申请Waiting。验证包括实际进程锁、许可排空和读取/写入调用检查。

### Task 3: 全部路径使用者与旧输出兼容

- [x] 逐一替换可迁移路径的 `user_data_dir.join(...)`，不替换auth/env/preferences/logs/resource路径。
  worker每次命令从同一位置快照派生OUTPUT/CACHE/MODEL/PYTORCH_RUNTIME，保持USER_DATA与cwd固定。
- [x] configured_output_root改为位置快照解析；Legacy保留当前.env/进程优先级，Managed固定为data_root/outputs。
  旧环境值留作来源记录；settings保存协议只管理ASR等固定设置，移除outputDir写入，不能提交默认空值覆盖旧路径。
- [x] 实际库存包括有效自定义输出及默认outputs遗留、cache、models、runtime、collections；相同物理目录去重。
  完整复制任务树与opaque旧目录，保持未知旧内容的物理保留状态。自定义根非tasks中的归属不明文件列为冲突，不静默丢弃或递归吞并。
- [x] 旧输出为相对值时返回LegacySourceAmbiguous，要求通过原生来源选择明确定位，不推断Rust启动cwd或config_root中的任何一份为唯一资料。
  在迁移确认流程中通过原生目录选择定位旧资料并展示完整来源，确认后才生成库存；不新增第二个常规设置入口，不只选一个基准canonicalize。
- [x] 相同task ID：整树相对路径/类型/文件字节全部一致才去重；不同则返回明确冲突。大小写/目标文件名规则产生的冲突也必须拒绝。
  不改变task ID、Collections taskIds、manifest相对路径、标题或Markdown正文。
- [x] 迁移前在独占状态执行已知任务事务与已接受删除恢复；不认识或恢复失败的待决事务阻止切换，并保留原件。
  被历史扫描忽略的普通旧目录仍计入库存，不能因不可显示而丢失。
- [x] 更新媒体授权：启动只允许已验证有效outputs的tasks和播放缓存子树；移除旧根授权，未ready不开放资料访问；不允许整盘/固定凭据根通配。
  播放缓存使用新根，前端重启后重新加载绝对任务/音频路径；不沿用旧节点缓存路径。
- [x] 路径矩阵测试使用真实.env文件与子进程环境（仅隔离测试目录），覆盖有效优先级、默认遗留和独立worker原有环境能力；不得读取真实凭据。

### Task 4: 目录选择、库存与空间预检

- [x] 使用现有DialogExt模式选择folder；Rust保留绝对路径/identity并返回一次性selection_token及显示路径，前端不能提交任意路径执行复制或删除。
- [x] 最终Prepared库存须在许可排空及未保存会话解决后生成。预检拒绝相同/嵌套/祖先/安装路径、目录别名、链接、非空无关目标和其他资料库。
  同一pending迁移ID、库存与身份一致的目标才允许恢复；选择取消不改变active。
- [x] 在Cargo.toml加入 `fs4 = { version = "=1.1.0", default-features = false }` 并更新Cargo.lock，使用其当前用户可用空间查询，查询目标卷和固定控制卷；使用文件逻辑大小及分配/元数据余量计算需求，整数溢出直接失败。
  目标基础余量64MiB，并至少按文件数×目标分配单元计入元数据/小文件开销；同卷也不假设移动或零成本copy-on-write。
  固定配置卷单独预留两份最大控制记录加1MiB提交/probe余量，不要求它容纳完整库存或复制数据，不能把目标64MiB余量重复应用于配置盘。
- [x] 用应用自有随机名probe验证create/write/sync/read/不覆盖安装/remove，验证目标支持所需文件大小/文件名、身份与原子发布。
  probe清理仅针对本次创建且身份不变的文件；失败不修改source/control.active。
- [x] 库存保存每个相对路径、类型、长度、权限/可执行位、源身份与SHA-256，包含空目录、备份和下载材料。
  目标预览显示来源/目标、文件/字节、冲突、空间、重启与原件保留；plan_token绑定控制generation、sources、target、库存摘要。
- [x] 空间/权限/冲突测试使用真实文件与ACL；实际稀疏逻辑文件超过当前可用容量时预检拒绝。容量受限卷中途耗尽及macOS未具备环境，明确记录未验证。

### Task 5: 复制、核对、发布与单次提交

- [x] 目标内创建本迁移拥有的staging与库存，按清单流式复制；每个普通文件以create_new写入部分文件，检查取消与真实I/O错误，sync后校验再安装。
  只保留受支持的权限/可执行位，不生成外部链接；不把复制视为模型下载或伪造模型就绪。
- [x] 逐文件读取目标重新计算SHA-256，并再次检查源全量清单与散列，发现新增/删除/变化或身份替换即失败。
  目标量和类型也必须与清单一致，不能只核对总字节或manifest列出的正式产物。
- [x] 保存有界进度/游标和receipt摘要；完整清单在目标的应用元数据区。取消/错误保留旧active及原件、持久状态和可识别副本，不自动切换。
  恢复前重新验证源库存，源变化则重新生成明确确认的计划；不能继续相信旧完成标记。
- [x] 错误仅写last_error并保留实际durable_phase/提交边界；明确取消时原子清除阻塞pending，将已生成副本信息存为cancelled_copy_refs，释放旧库许可。
  再次继续从记录重新预检，不能将取消前的散列/完成标记当当前来源。记录达到有界上限时明确拒绝新操作，不丢弃恢复引用。
- [x] 全部核对后进入Publishing并关闭取消。逐个发布目标自有顶层项，使用目标同卷原子rename与持久阶段判断恢复；禁止覆盖其他条目。
  目标marker包含library_id及generation+1，旧marker保持旧generation，防止把陈旧副本当当前库重新定位。
- [x] 最后一次原子替换固定StorageControl：active改为新根、pending设RestartRequired、添加receipt引用。
  不通过第二份.env写入提交位置；提交成功后当前进程保持暂停，不在内存热切换至新绝对路径。
- [x] 事件使用独立 `data-storage-progress`，只传operation ID/generation/封闭phase/code/文件与字节计数及本机预览路径；过期事件不能更新另一迁移。
  不复用worker处理阶段，不记录文件内容、凭据或完整私有文件名。

### Task 6: 启动恢复、重启验证与旧副本清理

- [x] 新进程先读取同一个固定控制记录。active还是旧根时，恢复Prepared/Copying/Verifying/Publishing或明确取消；不能推断半成品已成功。
  active已指向新根时只走新根验证；若控制写入成功但UI未收到结果，以持久active/generation为准。
- [x] 首次RestartRequired→Validating验证marker、布局和receipt，重新扫描受支持任务/合集引用并核对迁移库存；旧版原件保持不受信任的物理留存。
  模型/组件按迁移前捕获的就绪、缺失、过期或不可用状态比较；只对原本已就绪的对应版本执行既有哈希/版本/指纹与真实导入验证。
  原本缺失/过期的内容保持原状态，不永久阻止库Ready、不导入opaque内容、不借迁移自动下载。
  验证成功原子结束pending、记录验证generation与cleanup receipt；以后启动只做正常库/路径检查，不用迁移旧散列否定用户的合法新编辑。
- [x] 离线/损坏状态只提供重检、继续/取消未提交迁移、选择并验证现有当前资料位置等恢复操作。
  重新定位必须匹配控制记录中active.root_identity（volume/file）及当前library_id/generation与资料证据；同目录盘符改变可接受。
  物理身份不同的克隆或旧generation副本不作为当前库接受，不提供无提示回退。
- [x] 核验成功才进入CleanupAvailable，解除正常数据操作暂停。用户明确确认后，清理先取得独占并重新盘点两端。
  仅删除receipt中证明属于应用、source identity/hash未变且新位置仍有一致副本的文件；新旧不同或新位置缺失的项目保留并报告。
  中断后按逐项清理记录继续，删除前重新检查；不删除默认配置根、共享custom root、外部原文件或未知条目。
- [x] 多次迁移的待清理receipt随应用元数据一起保存，不丢弃先前未处理的副本记录。receipt的副本位置通过当前active库+相对路径解析。
  A→B→C后，清理A必须核对当前C，不能仍用B证明A可以删除；任何旧路径重新成为有效位置时禁止清理它。
- [x] 真实子进程在持久阶段就绪消息后由父进程终止，再由新进程恢复。覆盖提交前后、目标移除、控制盘写失败、取消竞态、源变化、部分清理及跨进程互斥；不使用替身文件系统或伪成功标记。

### Task 7: 基础设置行、三语与编辑/重启保护

- [x] 新DataStorageSetting替代旧outputDir输入：标题/路径在左、更改在右，button type=button，不提交Settings表单。
  固定设置保存协议、加载提示和「只影响后续任务」文案同步调整；显示真实当前根及必要legacy来源说明，不出现第二目录入口。
- [x] DataStorageMigrationSheet覆盖Waiting/Prepared/Copying/Verifying/Publishing/RestartRequired/Validating/Failed/Cancelled/CleanupAvailable/Cleaning，复用共同sheet视觉、焦点和独立正文/页脚。
  明确取消可用阶段，提交时不暴露可重复点击操作；关闭/重开从持久状态恢复进度。
- [x] useDataStorageController聚合现有业务所有者：处理含标题及完成后的自动合集提交、两个下载、AI/整理、文字稿/草稿保存、笔记/合集、设置/档案及缓存。
  也覆盖updateBusy及安装后待重启状态。前端从申请开始冻结新动作，复合流程/dirty处理结束后申请Rust Waiting；失败/取消按持久状态释放，不能只依赖canNavigate。
- [x] 文字稿、DraftResultSheet、名称/合集表单、设置与档案会话暴露本会话的dirty/saving及保存/放弃/取消结果。
  迁移前调用所属会话守卫；不直接关闭弹窗、清空buffer或自动保存。等待保存promise及后续刷新/成员提交结束才继续。
- [x] 关闭窗口、更新安装/重启经统一迁移状态决策；不能让更新relaunch在复制或控制提交中穿插。强制退出测试验证下次可恢复。
- [x] 三语新增等价文案及严格Storage DTO/事件解析；数值非负且有界、路径只展示本机Rust后端已验证位置，Windows内部前缀仅在显示层省略；错误码映射本地文案。
  复验1734×907、1180×760、720×640、1734×640的真实数值/输入与焦点滚动；不新增截图权限假设。

### Task 8: 全量验证与持久文档

- [x] 新增Rust `data_storage/tests.rs`，主要测试根在ignored build/data-storage-acceptance；跨卷及原生使用明确的独立工作区/应用标识；使用生产函数、真实线程/文件/子进程。
  worker新增真实跨根config/task/组件回归；前端覆盖DTO、状态归属、busy/dirty、三语与真实签出浏览器限制。
- [x] 完成下方全部自动化门禁；容量受限卷及macOS缺失条件见实际验收记录，没有替换磁盘或模型返回值。
- [x] 更新ARCHITECTURE路径与启动/任务访问、SECURITY本地数据/凭据/媒体权限/清理、DESIGN设置行/进度/恢复，以及相关旧输出/播放缓存规格，移除被本规格替代的当前行为表述。
  不在AGENTS写入历史台账；维持main共享工作区，不使用Git回滚或提交未授权内容。
- [x] 记录真实命令输出、文件数量/散列、恢复状态与实际功能证据；测试子进程及9334调试端口已关闭，正常正式应用已启动，当前用户库未迁移或删除。

## Validation and Acceptance

### 阶段与访问权威

| 持久/交互状态 | 权威位置与数据访问 | 重启/取消处理 |
| --- | --- | --- |
| 前端Preparing | 旧位置；禁止新界面动作，已有跨IPC收尾/dirty保存继续 | 尚无数据复制，取消释放界面冻结 |
| Waiting/Prepared/Copying/Verifying | 旧active，后端不发新数据许可 | 恢复界面继续或明确取消；取消清除阻塞pending并保留副本引用 |
| 上述阶段发生错误 | 旧active；保留实际phase与last_error | 继续重新预检或明确取消，不用Failed标签覆盖提交信息 |
| Publishing | 旧active直至原子控制替换成功；不可取消 | 按控制active/generation与已发布项恢复，未提交不采用目标 |
| RestartRequired/首次Validating | 新active；正常数据访问暂停 | 从新根核对，失败/离线显示恢复入口，不退回旧根 |
| Ready/CleanupAvailable | 新active；正常访问允许 | 结束迁移pending，只保留清理凭据；不以旧库存否定后续合法编辑 |
| Cleaning | 当前active；清理期间独占 | 持久游标继续或停止清理，保留未处理receipt，正常库随后可用 |
| 清理部分失败/完成 | 当前active仍有效 | 差异项目保留并报告；结束当前清理操作，保留未清理项目凭据 |
| 当前位置不可用/控制无效 | 不开放数据命令 | 重检或校验同一物理库，禁止创建默认空库 |

### 本机IPC边界

| 命令 | 输入与结果约束 |
| --- | --- |
| get_data_storage_state | 固定配置可用；返回DataAccess、当前显示位置、持久阶段与可执行动作，不初始化数据根 |
| select_data_storage_directory | 本机folder dialog；purpose为Target/LegacySource/Relink，返回绑定用途的selection_token/显示路径；选择取消返回空 |
| prepare_data_storage_migration | target token、已确认legacy source tokens及expected generation，前端复合操作/dirty结束后申请Waiting；返回库存预览/plan_token或封闭冲突 |
| confirm_data_storage_migration | plan_token；重验身份/空间/快照后复制，重复请求不启动第二操作 |
| cancel_data_storage_migration / resume_data_storage_migration | operation_id+expected generation；取消只允许未提交阶段，恢复重新校验来源 |
| recheck_data_storage / relink_data_storage | 重检已有控制根，或原生选择令牌定位同一物理库；不创建新空库 |
| restart_for_data_storage | 仅已提交且可受控重启的状态，持久记录成功后重启 |
| prepare_old_storage_cleanup / confirm_old_storage_cleanup | receipt ID→精确清理预览/一次性确认token；只使用当前active副本验证，禁止前端传任意删除路径 |

选择、预检与确认令牌由Rust持有并绑定窗口/operation/generation/身份，不能跨操作复用。
事件与查询使用同一份有界DTO，固定错误码包括DataUnavailable、ControlInvalid、Busy、UnsafePath、TargetConflict、
LegacySourceAmbiguous、InsufficientSpace、PermissionDenied、SourceChanged、VerificationFailed及CommitFailed；所有路径只在本机界面出现。

### 命令门禁

```text
cargo test --manifest-path app/src-tauri/Cargo.toml
npm --prefix app test
npm --prefix app run lint
npm --prefix app run tauri -- build --no-bundle
uv run ruff check worker
uv run pytest worker/tests
node --test scripts/tests/*.test.mjs
uv run python -m pytest scripts/tests -o cache_dir=build/pytest-data-storage-cache
uv run python scripts/validate_agents_docs.py --level WARN
git diff --check
```

验收预期：各命令exit 0；测试通过数量按实际输出记录，不在计划阶段填写未来通过数量。
涉及进程树的Windows测试须具备终止测试自己创建的子进程权限；拒绝访问需解决环境后重跑，不能减少断言。

### 必须有证据的矩阵

| 范围 | 实际证明 |
| --- | --- |
| 所有数据 | 源/目标完整相对路径、长度、SHA-256、空目录与权限/可执行位；manifest、标题、固定/手动名、原稿、合集和缓存一致 |
| 兼容 | .env优先/进程覆盖/默认、默认遗留、同根别名、同ID相同/不同内容、旧版/损坏目录、非应用文件、待决任务/删除事务 |
| 目标安全 | 同盘/跨盘、空/非空、嵌套/祖先/同路径、大小写/名称冲突、symlink/junction/reparse/hardlink、预检后换目录 |
| 空间/权限 | 实际容量查询、只读/ACL拒绝、受限卷预检不足与中途ENOSPC、固定控制盘失败；旧active与原件仍可读 |
| 并发 | 两个真实进程及任务/下载/保存/成员提交与隐含恢复写入；Waiting拒绝新操作并等待已有操作结束 |
| 取消/崩溃 | 复制中取消、验证末尾取消、Publishing取消禁用；每个持久阶段终止并重启，权威根始终可唯一判定 |
| 重启/离线 | 新进程使用新根、任务/合集读取、播放scope、真实模型校验/短媒体ASR、组件导入；离线进入恢复而非空库 |
| 清理 | 只能删除receipt证明且两端一致的文件；差异/缺失/源变化项目保留，固定配置/共享无关文件保持；中断后可继续 |
| 客户端 | 全部busy/dirty与更新/关闭组合、事件过期/重复、三语四CSS视口、真实输入/滚轮/AX、生产浏览器真实不可用状态 |

真实文件与独立进程功能检查在隔离工作目录执行，不改变当前用户的存储位置。
原生实际用户库迁移/清理需要用户在正式界面选择目标并明确确认；代码实施批准不替代这项运行时确认。
真实模型/组件及小容量卷的环境条件要单独报告；缺少条件的功能保留为未验证，不能以占位文件或mock填补。

### 依赖依据

- 文件互斥采用本机Rust 1.96已覆盖的稳定标准库能力；[File::try_lock文档](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock)说明其Windows/Unix锁与合作进程边界。
- 容量采用[fs4 1.1.0 available_space](https://docs.rs/fs4/1.1.0/fs4/fn.available_space.html)的当前用户可用字节语义；按上述版本锁定并校验Windows/macOS构建。
- 已有sha2、serde_json、uuid和atomic_files继续承担散列、标准格式、身份和原子控制写入，不手写成熟格式parser。

## Outcomes & Retrospective

固定配置与可迁移数据路径、全局许可、迁移/恢复/精确清理、正式只读worker验证、设置和恢复界面均已实现并完成本机验收。
当前用户库保持原位。验收没有启动下载或付费生成，公开模型和组件通过隔离副本执行实际迁移与功能检查。
Windows正式应用已构建并启动，正常主页、笔记入口及输入区域可用，无数据恢复错误。

### 实际验收记录

| 检查 | 结果与证据 |
| --- | --- |
| Rust完整门禁 | `cargo test --manifest-path app/src-tauri/Cargo.toml -- --test-threads=1`：465 passed / 7 ignored；`build/data-storage-acceptance/rust-tests-final.log`。串行运行保留真实原有超时和完整进程树清理断言。 |
| 前端 | 125文件/1389项通过，lint与生产构建通过；`frontend-tests-complete.log`。真实Chrome生产检查5项包含实际无原生桥的恢复边界。 |
| Worker | ruff通过；1221 passed / 4 skipped，跳过项为现有环境/平台条件；`worker-tests-final.log`。 |
| 脚本 | Node 51项、Python 1项通过；文档治理0错误0警告，diff检查通过。 |
| 打包 | 正式Windows `tauri build --no-bundle`通过，worker资源与源码逐字节一致；`desktop-build-final.log`。独立标识的debug构建也通过。 |
| 独立真实补充 | 打包Python环境canary、原生验证worker取消、C→D跨卷复制/重开、业务资料roundtrip及两个真实模型验收分别执行通过。ignored基础设施子进程由阶段矩阵实际调用，不作为跳过产品能力。 |
| 大库恢复迁移 | 18,232文件、785,611,445字节；正式resume→完整散列核对→提交→新Manager验证为Ready，原副本保留；`real-public-20261101-01/migration-result.json`。 |
| 模型与ASR | ONNX资产真实散列核验；正式worker完成短音频识别14字。音频SHA-256 `88d7ad64145646763e0113d9e51469866ebb410079b12d43e63c0d4454572b02`，正文SHA-256 `00b0038b0cb4628e0af7bce27e64671a3cac514bfc1158b2c3b3708e20b4adb3`；`asr-result.json`。 |
| 组件 | 迁移前后真实导入torch 2.10.0+cpu、torchaudio 2.11.0+cpu、funasr 1.3.9，模块文件均来自隔离组件目录。资源中没有组件gate manifest，正式状态保持实际ungated；独立导入证据没有冒充当前版本ready；`functional-result.json`。 |
| 业务读取 | 正式任务、文字稿、自动标题、手动标题/固定、原稿、草稿、默认+显式旧来源、合集及opaque引用均通过生产读写函数roundtrip。 |
| 原生设置 | 三语×四CSS视口共12项布局检查，正文操作14px、标题16px、横向无溢出、页脚可达；真实键盘修改模型、目录选择/取消后草稿保留、跨语言保持草稿；`native-layout-*.json`。 |
| 原生恢复迁移 | 正式服务先在独立应用配置中生成Prepared，真实客户端重开恢复预览并通过键盘确认。20文件/242,486,653字节C→D迁移、实际受控重启后generation=1、Ready、模型可用、中文偏好保留；`native-restart-result.json`。 |
| 原生媒体scope | 新库任务子树WAV实际读取200且SHA匹配；相同公开音频在库外返回403；`native-assets-result.json`。 |

Not run / Residual risk：macOS没有本机运行证据；真实容量受限卷的复制中途ENOSPC未执行。Windows真实可用空间预检、稀疏逻辑大小不足、ACL拒绝及只读控制失败已经覆盖。
原生目录选择与取消已验收；首次选择返回后Preparing内各编辑owner的全部保存/放弃/取消组合未逐项端到端点击，已由代码复核和相应前端回归检查。原生清理最终删除按钮没有点击，实际删除/保留/停止/中断恢复由真实文件核心测试覆盖。
本次没有截图或图像比较。隔离测试资料保留在明确的测试目录中，未递归清理用户目录。
