from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from frameq_worker.task_store import TaskStoreFacade


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    store = TaskStoreFacade(args.root / "outputs", args.root / "cache")
    environment = {
        key: value for key, value in os.environ.items()
        if key.upper() in {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT"}
    }
    environment.update({
        "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "FRAMEQ_OUTPUT_DIR": str(store.output_root), "FRAMEQ_CACHE_DIR": str(store.cache_root),
        "HOME": str(args.root), "USERPROFILE": str(args.root),
        "MODELSCOPE_CACHE": str(args.root / "modelscope-cache"),
    })
    operation_id = str(uuid4())
    save_request = {
        "contract_version": 2, "operation_id": operation_id,
        "task_id": "20261102-123456-web-" + uuid4().hex[:16],
        "article": {
            "title": "跨语言正文核验",
            "text": "保留UTF-8正文、空白和表情🙂。\r\n" * 6,
            "markdown": "## 正文结构\n\n- 第一条\n- 第二条\n",
            "sourceUrl": "https://www.python.org/doc/?id=12",
        },
    }
    completed = subprocess.run(
        [sys.executable, "-m", "frameq_worker", "--save-web-page-stdin",
         "--web-operation-id", operation_id],
        input=json.dumps(save_request).encode("utf-8"), capture_output=True, timeout=60,
        check=False, cwd=args.root, env=environment,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.decode("utf-8"))
    saved = json.loads(completed.stdout.decode("utf-8"))
    if saved["status"] != "completed":
        raise ValueError("Real web save did not complete.")
    print(completed.stdout.decode("utf-8").strip(), flush=True)
    for target in ("summary", "insights", "dissection", "draft"):
        request = {"task_id": saved["task_id"], "target": target, "output_language": "zh-CN"}
        if target == "draft":
            request.update({"insight_id": 1, "platform": "xiaohongshu"})
        completed = subprocess.run(
            [sys.executable, "-m", "frameq_worker", "--retry-insights-stdin"],
            input=json.dumps(request).encode("utf-8"), capture_output=True, timeout=60,
            check=False, cwd=args.root, env=environment,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.decode("utf-8"))
        result = json.loads(completed.stdout.decode("utf-8"))
        if result["error"]["code"] != (
            "DRAFT_SEED_INVALID" if target == "draft" else "AI_CONFIG_MISSING"
        ):
            raise ValueError("Unexpected real retry failure category.")
        print(completed.stdout.decode("utf-8").strip(), flush=True)


if __name__ == "__main__":
    main()
