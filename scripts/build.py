#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PACKAGES_DIR = ROOT / "packages"
OUTPUT_DIR = ROOT / "dist-pages"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build Standard Notes plugin manifests, hosted files, ZIPs, and Pages catalog."
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SN_PLUGINS_BASE_URL", "http://127.0.0.1:8000"),
        help="Public base URL, without a trailing slash.",
    )
    parser.add_argument(
        "--owner",
        default=os.environ.get("GITHUB_REPOSITORY_OWNER", "local"),
        help="GitHub owner used to resolve __OWNER__ placeholders.",
    )
    parser.add_argument(
        "--output",
        default=str(OUTPUT_DIR),
        help="Output directory.",
    )
    return parser.parse_args()


def normalize_owner(owner: str) -> str:
    value = owner.strip().lower()
    value = re.sub(r"[^a-z0-9.-]+", "-", value)
    value = value.strip(".-")
    if not value:
        raise ValueError("Owner becomes empty after normalization")
    return value


def replace_owner(value, owner: str):
    if isinstance(value, str):
        return value.replace("__OWNER__", owner)
    if isinstance(value, list):
        return [replace_owner(v, owner) for v in value]
    if isinstance(value, dict):
        return {k: replace_owner(v, owner) for k, v in value.items()}
    return value


def load_package(package_dir: Path, owner: str) -> dict:
    package_root = package_dir.resolve()
    path = resolve_confined(package_root, Path("package.json"), "package.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    return replace_owner(data, owner)


def resolve_confined(root: Path, candidate: Path, label: str) -> Path:
    """Resolve a package-owned path and reject traversal and symlink escapes."""
    root_resolved = root.resolve()
    if candidate.is_absolute():
        raise ValueError(f"{label}: absolute paths are not allowed: {candidate}")
    if not candidate.parts or any(part in ("", ".", "..") for part in candidate.parts):
        raise ValueError(f"{label}: unsafe relative path: {candidate}")
    resolved = (root_resolved / candidate).resolve(strict=False)
    try:
        resolved.relative_to(root_resolved)
    except ValueError as error:
        raise ValueError(f"{label}: symlink/path escape: {candidate}") from error
    return resolved


def run_package_build(package_dir: Path) -> None:
    build_script = resolve_confined(package_dir, Path("build.py"), "build.py")
    if build_script.exists():
        subprocess.run(
            [sys.executable, str(build_script)],
            cwd=package_dir,
            check=True,
        )


def validate_metadata(package_dir: Path, package: dict) -> tuple[dict, str]:
    version = package.get("version")
    sn = package.get("sn")

    if not isinstance(version, str) or not version.strip():
        raise ValueError(f"{package_dir}: package.json requires a non-empty version")

    if not isinstance(sn, dict):
        raise ValueError(f"{package_dir}: package.json requires an sn object")

    required = ("identifier", "name", "content_type", "area", "main")
    missing = [key for key in required if not isinstance(sn.get(key), str) or not sn[key].strip()]
    if missing:
        raise ValueError(f"{package_dir}: missing required sn fields: {', '.join(missing)}")

    identifier = sn["identifier"]
    if "/" in identifier or "\\" in identifier or identifier in (".", ".."):
        raise ValueError(f"{package_dir}: unsafe identifier: {identifier}")

    main_path = resolve_confined(package_dir, Path(sn["main"]), "sn.main")
    if not main_path.is_file():
        raise ValueError(f"{package_dir}: sn.main does not exist after build: {sn['main']}")

    return sn, version


def validate_unique_identifiers(package_identifiers: list[tuple[Path, str]]) -> None:
    resolved: dict[str, Path] = {}
    for package_dir, identifier in package_identifiers:
        previous = resolved.get(identifier)
        if previous is not None:
            raise ValueError(
                f"Duplicate resolved plugin identifier '{identifier}' "
                f"for {previous} and {package_dir}"
            )
        resolved[identifier] = package_dir


def collect_runtime_files(package_dir: Path, package: dict) -> list[Path]:
    selected: dict[str, Path] = {}

    package_json = resolve_confined(package_dir, Path("package.json"), "package.json")
    selected["package.json"] = package_json

    declared = package.get("files")
    if declared is None:
        declared = ["dist"]
    if not isinstance(declared, list) or not all(isinstance(v, str) for v in declared):
        raise ValueError(f"{package_dir}: files must be an array of strings")

    for entry in declared:
        src = resolve_confined(package_dir, Path(entry), "files entry")
        if not src.exists():
            raise ValueError(f"{package_dir}: runtime path listed in files does not exist: {entry}")

        if src.is_file():
            rel = src.relative_to(package_dir).as_posix()
            selected[rel] = src
        else:
            for file_path in sorted(src.rglob("*")):
                if file_path.is_file():
                    relative_file = file_path.relative_to(package_dir)
                    file_path = resolve_confined(package_dir, relative_file, "runtime file")
                    rel = file_path.relative_to(package_dir).as_posix()
                    selected[rel] = file_path

    return [selected[key] for key in sorted(selected)]


def write_runtime_package(
    package_dir: Path,
    package: dict,
    runtime_files: list[Path],
    static_dir: Path,
    zip_path: Path,
) -> str:
    if static_dir.exists():
        shutil.rmtree(static_dir)
    static_dir.mkdir(parents=True, exist_ok=True)
    zip_path.parent.mkdir(parents=True, exist_ok=True)

    package_json_bytes = (json.dumps(package, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for source in runtime_files:
            relative_source = source.relative_to(package_dir)
            confined_source = resolve_confined(package_dir, relative_source, "runtime file")
            rel = confined_source.relative_to(package_dir).as_posix()
            if not rel or rel.startswith("/") or ".." in Path(rel).parts:
                raise ValueError(f"{package_dir}: unsafe ZIP entry: {rel}")
            destination = static_dir / rel
            destination.parent.mkdir(parents=True, exist_ok=True)

            if rel == "package.json":
                destination.write_bytes(package_json_bytes)
                info = zipfile.ZipInfo("package.json")
                info.date_time = (2020, 1, 1, 0, 0, 0)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                zf.writestr(info, package_json_bytes)
            else:
                data = source.read_bytes()
                destination.write_bytes(data)
                info = zipfile.ZipInfo(rel)
                info.date_time = (2020, 1, 1, 0, 0, 0)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                zf.writestr(info, data)

    return hashlib.sha256(zip_path.read_bytes()).hexdigest()


def build_manifest(
    package: dict,
    sn: dict,
    version: str,
    base_url: str,
    sha256: str,
) -> dict:
    identifier = sn["identifier"]
    main = sn["main"]

    manifest = dict(sn)
    manifest["version"] = version
    manifest["identifier"] = identifier
    manifest["name"] = sn["name"]

    if package.get("description"):
        manifest["description"] = package["description"]

    publisher = package.get("author")
    if publisher:
        if isinstance(publisher, dict):
            publisher = publisher.get("name")
        if publisher:
            manifest["publisher"] = publisher

    manifest["url"] = f"{base_url}/static/{identifier}/{main}"
    manifest["download_url"] = f"{base_url}/zips/{identifier}.zip"
    manifest["latest_url"] = f"{base_url}/entries/{identifier}.json"
    manifest["sha256"] = sha256

    return manifest


def write_catalog(output: Path, manifests: list[dict], base_url: str) -> None:
    cards = []
    for manifest in manifests:
        install_url = manifest["latest_url"]
        cards.append(
            f"""
            <article class="card">
              <h2>{html.escape(manifest["name"])}</h2>
              <div class="meta">{html.escape(manifest["content_type"])} · v{html.escape(manifest["version"])}</div>
              <p>{html.escape(manifest.get("description", ""))}</p>
              <label>Install URL</label>
              <div class="install-row">
                <input readonly value="{html.escape(install_url, quote=True)}">
                <button data-copy="{html.escape(install_url, quote=True)}">Copy</button>
              </div>
              <div class="links">
                <a href="{html.escape(install_url, quote=True)}">manifest</a>
                <a href="{html.escape(manifest["download_url"], quote=True)}">zip</a>
                <a href="{html.escape(manifest["url"], quote=True)}">runtime</a>
              </div>
            </article>
            """
        )

    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Standard Notes Plugins</title>
  <style>
    :root {{
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
      line-height: 1.5;
    }}
    body {{ max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }}
    h1 {{ margin-bottom: 4px; }}
    .sub {{ opacity: .72; margin-top: 0; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(300px,1fr)); gap: 16px; }}
    .card {{ border: 1px solid color-mix(in srgb, currentColor 24%, transparent); border-radius: 12px; padding: 18px; }}
    .card h2 {{ margin: 0 0 4px; }}
    .meta {{ opacity: .7; font-size: .9rem; }}
    label {{ display:block; font-size:.85rem; margin-bottom:4px; opacity:.8; }}
    .install-row {{ display:flex; gap:8px; }}
    input {{ min-width:0; flex:1; padding:8px; }}
    button {{ padding:8px 12px; cursor:pointer; }}
    .links {{ display:flex; gap:14px; margin-top:10px; font-size:.9rem; }}
    code {{ overflow-wrap:anywhere; }}
  </style>
</head>
<body>
  <h1>Standard Notes Plugins</h1>
  <p class="sub">Generated repository catalog. Paste an Install URL into Standard Notes' external/custom package installer.</p>
  <p>Base URL: <code>{html.escape(base_url)}</code></p>
  <section class="grid">
    {''.join(cards)}
  </section>
  <script>
    for (const button of document.querySelectorAll("[data-copy]")) {{
      button.addEventListener("click", async () => {{
        await navigator.clipboard.writeText(button.dataset.copy);
        const old = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => button.textContent = old, 1000);
      }});
    }}
  </script>
</body>
</html>
"""
    (output / "index.html").write_text(document, encoding="utf-8")


def main() -> int:
    args = parse_args()
    owner = normalize_owner(args.owner)
    base_url = args.base_url.rstrip("/")
    output = Path(args.output).resolve()

    if not PACKAGES_DIR.is_dir():
        raise ValueError(f"Missing packages directory: {PACKAGES_DIR}")

    package_dirs = []
    for package_json in sorted(PACKAGES_DIR.glob("*/package.json")):
        relative_package = package_json.parent.relative_to(PACKAGES_DIR)
        package_dirs.append(resolve_confined(PACKAGES_DIR, relative_package, "package directory"))
    if not package_dirs:
        raise ValueError("No plugin packages found")

    discovered = []
    for package_dir in package_dirs:
        run_package_build(package_dir)
        package = load_package(package_dir, owner)
        sn, version = validate_metadata(package_dir, package)
        discovered.append((package_dir, package, sn, version))

    validate_unique_identifiers(
        [(package_dir, sn["identifier"]) for package_dir, _, sn, _ in discovered]
    )

    if output.exists():
        shutil.rmtree(output)
    (output / "entries").mkdir(parents=True)
    (output / "static").mkdir(parents=True)
    (output / "zips").mkdir(parents=True)

    manifests = []
    for package_dir, package, sn, version in discovered:
        identifier = sn["identifier"]

        runtime_files = collect_runtime_files(package_dir, package)
        runtime_rels = {
            path.relative_to(package_dir).as_posix()
            for path in runtime_files
        }
        if sn["main"] not in runtime_rels:
            raise ValueError(
                f"{package_dir}: sn.main '{sn['main']}' is not included by package.json files"
            )

        static_dir = output / "static" / identifier
        zip_path = output / "zips" / f"{identifier}.zip"
        sha256 = write_runtime_package(
            package_dir, package, runtime_files, static_dir, zip_path
        )

        manifest = build_manifest(package, sn, version, base_url, sha256)
        manifest_path = output / "entries" / f"{identifier}.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        manifests.append(manifest)

    aggregate = {item["identifier"]: item for item in manifests}
    (output / "packages.json").write_text(
        json.dumps(aggregate, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (output / ".nojekyll").write_text("", encoding="utf-8")
    write_catalog(output, manifests, base_url)

    print(f"Built {len(manifests)} plugin(s) into {output}")
    for item in manifests:
        print(f"- {item['name']}: {item['latest_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
