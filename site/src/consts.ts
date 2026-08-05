/**
 * FrameQ 宣传站站点常量。
 *
 * 仅包含构建期确定的静态值。release metadata 来自 docs/releases/vX.Y.Z.md
 * 与 GitHub Releases 真实 URL；发布新版本时手动更新此文件并重新构建。
 *
 * 见 docs/product-specs/2026-08-05-web-marketing-site.md § Content Safety。
 */

/** 产品名（不翻译）。 */
export const PRODUCT_NAME = 'FrameQ';

/** 品类描述。 */
export const PRODUCT_CATEGORY = '视频转文字与 AI 整理桌面工具';

/** 首屏本地优先信任语。 */
export const TRUST_COPY =
  '默认本地处理视频、音频和文字稿；AI 整理需你确认后才会调用云端 LLM。';

/** 工作流简述。 */
export const WORKFLOW_COPY =
  '粘贴公开链接，保存本地文字稿，再生成可继续思考的总结和灵感。';

/** GitHub 仓库 URL。 */
export const GITHUB_URL = 'https://github.com/jiabai/FrameQ';

/** 当前最新 release 版本号（与 docs/releases/ 最新文件一致）。 */
export const LATEST_VERSION = 'v0.3.0';

/** release notes 源文件路径（相对仓库根，用于 content collections 同步参考）。 */
export const RELEASE_NOTES_PATH = 'docs/releases/v0.3.0.md';

/** GitHub Releases 下载基础 URL。 */
const RELEASE_BASE = `${GITHUB_URL}/releases/download/${LATEST_VERSION}`;

/** 平台发行产物定义。仅展示真实存在的产物；对应平台未验证前不显示。 */
export interface DownloadAsset {
  /** 平台显示名。 */
  platform: string;
  /** 架构显示名。 */
  arch: string;
  /** 文件名。 */
  filename: string;
  /** 完整下载 URL。 */
  url: string;
  /** 文件类型标签。 */
  fileType: string;
  /** 安装说明锚点（指向下载页内的说明区块）。 */
  installHint: string;
}

/** 当前已验证的发行产物清单。 */
export const DOWNLOAD_ASSETS: readonly DownloadAsset[] = [
  {
    platform: 'macOS',
    arch: 'Apple Silicon（M 系列）',
    filename: 'FrameQ_0.3.0_aarch64.dmg',
    url: `${RELEASE_BASE}/FrameQ_0.3.0_aarch64.dmg`,
    fileType: 'DMG',
    installHint: '#macos-install',
  },
  {
    platform: 'macOS',
    arch: 'Intel',
    filename: 'FrameQ_0.3.0_x64.dmg',
    url: `${RELEASE_BASE}/FrameQ_0.3.0_x64.dmg`,
    fileType: 'DMG',
    installHint: '#macos-install',
  },
  {
    platform: 'Windows',
    arch: 'x64',
    filename: 'FrameQ_0.3.0_x64-setup.exe',
    url: `${RELEASE_BASE}/FrameQ_0.3.0_x64-setup.exe`,
    fileType: 'EXE 安装包',
    installHint: '#windows-install',
  },
] as const;

/** ASR 模型首启下载说明。 */
export const ASR_MODEL_NOTICE =
  'ASR 模型在首次提交已验证任务时按所选模型按需下载，不内置在安装包中。';

/** 支持的公开视频来源。 */
export const SUPPORTED_SOURCES = [
  '抖音公开视频',
  'B站公开视频',
  '小红书公开视频',
  'YouTube 公开视频',
] as const;

/** 不支持的视频类型（明确限制）。 */
export const UNSUPPORTED_SOURCES = [
  '私有、会员、登录、年龄限制或验证码保护的视频',
] as const;

/** 站点导航链接。 */
export const NAV_LINKS = [
  { label: '首页', href: '/' },
  { label: '下载', href: '/download' },
  { label: '隐私', href: '/privacy' },
  { label: 'GitHub', href: GITHUB_URL },
] as const;

/** Footer 链接。 */
export const FOOTER_LINKS = [
  { label: 'Release Notes', href: `${GITHUB_URL}/releases` },
  { label: '隐私', href: '/privacy' },
  { label: 'GitHub 仓库', href: GITHUB_URL },
  { label: 'v0.3.0 release notes', href: '/download#release-notes' },
] as const;
