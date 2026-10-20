"""PyTorch 运行时组件的检测、指纹比对与 sys.path 注入。

组件与模型是两回事：模型（权重）走既有模型下载流程；组件是依赖闭包
（funasr、torch 等），由构建脚本打包、按需下载到 app-local data。

裁剪后的安装包在资源根写一份 ``runtime-manifest.json``，组件目录里也有一
份，两份 ``lock_fingerprint`` 一致才算可用。包内没有 manifest 时（本地
dev、外置之前的旧版本安装），门禁不生效，保持原有行为。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

COMPONENT_DIR_ENV = "FRAMEQ_PYTORCH_RUNTIME_DIR"
BUNDLED_MANIFEST_ENV = "FRAMEQ_BUNDLED_RUNTIME_MANIFEST"
BUNDLED_MANIFEST_NAME = "runtime-manifest.json"
COMPONENT_MANIFEST_NAME = "runtime-manifest.json"
COMPONENT_SITE_PACKAGES_NAME = "site-packages"

RUNTIME_COMPONENT_READY = "ready"
RUNTIME_COMPONENT_MISSING = "missing"
RUNTIME_COMPONENT_STALE = "stale"
RUNTIME_COMPONENT_UNGATED = "ungated"


def resolve_component_dir(environ: dict[str, str]) -> Path | None:
    """从环境变量读组件目录；未配置视为缺失，由调用方决定文案。"""
    configured = (environ.get(COMPONENT_DIR_ENV) or "").strip()
    if not configured:
        return None
    return Path(configured)


def locate_bundled_manifest(
    project_root: Path,
    environ: dict[str, str] | None = None,
) -> Path | None:
    """定位包内 manifest。返回 None 表示这份运行时未裁剪，组件门禁不生效。"""
    env = environ if environ is not None else {}
    override = (env.get(BUNDLED_MANIFEST_ENV) or "").strip()
    if override:
        candidate = Path(override)
        return candidate if candidate.is_file() else None
    candidate = Path(project_root) / BUNDLED_MANIFEST_NAME
    return candidate if candidate.is_file() else None


def read_manifest_fingerprint(path: Path) -> str | None:
    """读 manifest 里的 lock 指纹；文件缺失、损坏或字段异常一律返回 None。"""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    fingerprint = data.get("lock_fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint.strip():
        return None
    return fingerprint


def evaluate_component(
    component_dir: Path | None,
    bundled_fingerprint: str | None,
) -> str:
    """给出组件状态。

    ``ungated``：包内未裁剪，不做任何检查；``missing``：组件未下载或内容
    不完整；``stale``：组件存在但指纹与当前包不一致，需要重新下载。
    """
    if bundled_fingerprint is None:
        return RUNTIME_COMPONENT_UNGATED
    if component_dir is None or not component_dir.is_dir():
        return RUNTIME_COMPONENT_MISSING
    component_fingerprint = read_manifest_fingerprint(
        component_dir / COMPONENT_MANIFEST_NAME
    )
    if component_fingerprint is None:
        return RUNTIME_COMPONENT_MISSING
    if component_fingerprint != bundled_fingerprint:
        return RUNTIME_COMPONENT_STALE
    return RUNTIME_COMPONENT_READY


def install_sys_path(component_dir: Path, sys_module: Any = sys) -> bool:
    """把组件的 site-packages 幂等前置进 sys.path，返回是否真的新增。

    前置保证组件内的 funasr、torch 优先于包内同名模块；包内已裁剪时不存在
    冲突，前置只是防御顺序问题。已存在时不重复插入。
    """
    site_packages = Path(component_dir) / COMPONENT_SITE_PACKAGES_NAME
    if not site_packages.is_dir():
        return False
    resolved = str(site_packages)
    if resolved in sys_module.path:
        return False
    sys_module.path.insert(0, resolved)
    return True
