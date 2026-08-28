#!/usr/bin/env python3
"""Build the browser runtime with the package-local Vite graph."""

from pathlib import Path
import subprocess
import shutil


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

# Vite also empties its output directory, but clean it here so a failed build
# can never leave stale runtime assets that the root packager might publish.
if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir(parents=True, exist_ok=True)
subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
shutil.copyfile(ROOT / "src" / "style.css", DIST / "style.css")
