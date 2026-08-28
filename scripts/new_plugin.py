#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    if not value:
        raise ValueError("Slug is empty")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a Standard Notes plugin package.")
    sub = parser.add_subparsers(dest="kind", required=True)

    theme = sub.add_parser("theme", help="Create a theme plugin")
    theme.add_argument("name", help="Display name, e.g. 'Paper Gray'")
    theme.add_argument("slug", nargs="?", help="Identifier suffix; default derives from name")

    args = parser.parse_args()

    if args.kind != "theme":
        raise ValueError(f"Unsupported plugin kind: {args.kind}")

    slug = slugify(args.slug or args.name)
    dirname = f"io.github.__OWNER__.{slug}"
    target = PACKAGES / dirname
    if target.exists():
        raise FileExistsError(target)

    (target / "src").mkdir(parents=True)

    package = {
        "name": f"@local/{slug}",
        "version": "0.1.0",
        "description": f"Standard Notes theme: {args.name}",
        "author": "__OWNER__",
        "private": True,
        "files": ["dist"],
        "sn": {
            "identifier": dirname,
            "name": args.name,
            "content_type": "SN|Theme",
            "area": "themes",
            "main": "dist/theme.css",
            "showInGallery": False,
        },
    }
    (target / "package.json").write_text(
        json.dumps(package, indent=2) + "\n",
        encoding="utf-8",
    )

    (target / "build.py").write_text(
        """#!/usr/bin/env python3
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
dist = root / "dist"
dist.mkdir(exist_ok=True)
shutil.copyfile(root / "src" / "theme.css", dist / "theme.css")
""",
        encoding="utf-8",
    )

    (target / "src" / "theme.css").write_text(
        """:root {
  --sn-stylekit-background-color: #ffffff;
  --sn-stylekit-foreground-color: #111111;
  --sn-stylekit-border-color: #777777;
  --sn-stylekit-secondary-background-color: #f2f2f2;
  --sn-stylekit-secondary-foreground-color: #111111;
  --sn-stylekit-editor-background-color: var(--sn-stylekit-background-color);
  --sn-stylekit-editor-foreground-color: var(--sn-stylekit-foreground-color);
  --sn-component-background-color: var(--sn-stylekit-background-color);
  --sn-component-foreground-color: var(--sn-stylekit-foreground-color);
}
""",
        encoding="utf-8",
    )

    (target / "README.md").write_text(
        f"# {args.name}\n\nGenerated Standard Notes theme package.\n",
        encoding="utf-8",
    )

    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
