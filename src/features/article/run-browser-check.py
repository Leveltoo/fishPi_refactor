import os
from pathlib import Path
import subprocess

project = Path(__file__).resolve().parents[3]
env = os.environ.copy()
env["PLAYWRIGHT_MODULE"] = (
    "C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/"
    "dependencies/node/node_modules/playwright"
)
env["CONTENT_BROWSER"] = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
env["CONTENT_TEST_URL"] = "http://localhost:1420"
env["CONTENT_SCREENSHOT_DIR"] = str(Path(__file__).resolve().parent)
raise SystemExit(subprocess.call(
    ["node", "src/features/article/browser-selfcheck.mjs"], cwd=project, env=env
))
