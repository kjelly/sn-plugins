#!/usr/bin/env python3
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
dist = root / "dist"
dist.mkdir(exist_ok=True)
shutil.copyfile(root / "src" / "theme.css", dist / "theme.css")
