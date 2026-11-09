from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

from worker_core.runtime_component import (
    evaluate_component,
    install_sys_path,
    locate_bundled_manifest,
    read_manifest_fingerprint,
    resolve_component_dir,
)


def inspect_storage(*, import_component: bool) -> dict[str, object]:
    manifest = locate_bundled_manifest(Path.cwd(), dict(os.environ))
    fingerprint = read_manifest_fingerprint(manifest) if manifest is not None else None
    component = resolve_component_dir(dict(os.environ))
    state = evaluate_component(component, fingerprint)
    imported = False
    if import_component:
        if state != "ready" or component is None or not (component / "site-packages").is_dir():
            raise ValueError("Storage component is unavailable")
        install_sys_path(component)
        component_packages = (component / "site-packages").resolve()
        for name in ("torch", "torchaudio", "funasr"):
            imported_module = importlib.import_module(name)
            if not Path(imported_module.__file__).resolve().is_relative_to(component_packages):
                raise ValueError("Storage component imported from an unexpected directory")
        imported = True
    from worker_core.model_download import (
        ONNX_SENSEVOICE_MODEL_ID,
        SENSEVOICE_MODEL_ID,
        validate_asr_model_cache,
    )

    model_root = Path(os.environ["APP_MODEL_DIR"])
    ready_models = [
        model
        for model in (SENSEVOICE_MODEL_ID, ONNX_SENSEVOICE_MODEL_ID)
        if validate_asr_model_cache(model_root, model)
    ]
    return {
        "schema_version": 1,
        "ready_models": ready_models,
        "component_state": state,
        "component_fingerprint": fingerprint,
        "component_imported": imported,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--import-component", action="store_true")
    args = parser.parse_args()
    with redirect_stdout(sys.stderr):
        result = inspect_storage(import_component=args.import_component)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
