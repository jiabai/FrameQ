from __future__ import annotations

import argparse
import os
from pathlib import Path

from frameq_worker.task_transaction import commit_task_artifacts, recover_task_artifacts


def interrupt_after_article(point: str) -> None:
    if point == "after_replace:article/article.txt":
        os._exit(73)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("interrupted", "recover"))
    parser.add_argument("task_dir", type=Path)
    args = parser.parse_args()
    if args.operation == "recover":
        print(recover_task_artifacts(args.task_dir).value)
    else:
        manifest = (args.task_dir / "frameq-task.json").read_bytes()
        commit_task_artifacts(args.task_dir, {
            "article/article.txt": b"Python article revision\n",
            "article/article.md": b"# Python article revision\n",
            "frameq-task.json": manifest,
        }, _fault_hook=interrupt_after_article)


if __name__ == "__main__":
    main()
