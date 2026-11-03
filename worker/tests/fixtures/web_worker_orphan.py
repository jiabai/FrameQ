import json
import os
import subprocess
import sys
import time
from pathlib import Path

mode = sys.argv[1]
if mode == "child":
    time.sleep(120)
else:
    if mode not in {"crash", "success", "wait"}:
        raise ValueError("Unknown process-tree test mode")
    sys.stdin.buffer.read()
    child = subprocess.Popen(
        [sys.executable, __file__, "child"], stdin=subprocess.DEVNULL
    )
    destination = Path(sys.argv[2])
    pending = destination.with_name("tree-pending.json")
    pending.write_text(
        json.dumps({"root": os.getpid(), "child": child.pid}), encoding="utf-8"
    )
    pending.replace(destination)
    if mode == "wait":
        time.sleep(120)
    os._exit(0 if mode == "success" else 7)
