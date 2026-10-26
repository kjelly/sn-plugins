#!/usr/bin/env python3
"""Focused regression checks for Pages URLs and builder preflight validation."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import zipfile

from build import (
    FINGERPRINTED_ASSET_CACHE_CONTROL,
    HTML_CACHE_CONTROL,
    ROOT,
    build_manifest,
    collect_runtime_files,
    normalize_base_url,
    resolve_confined,
    validate_unique_identifiers,
    write_cache_headers,
    write_runtime_package,
)


def check_manifest_urls() -> None:
    base_url = normalize_base_url(" https://kjelly.github.io/sn-plugins/ ")
    assert base_url == "https://kjelly.github.io/sn-plugins"
    assert normalize_base_url("http://127.0.0.1:8000/") == "http://127.0.0.1:8000"
    for invalid in (
        "", " ", "/", "/sn-plugins", "kjelly.github.io/sn-plugins",
        "ftp://example.com", "https://", "https://example.com/?q=1",
        "https://example.com/#fragment", "https://exam ple.com",
    ):
        try:
            normalize_base_url(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"builder must reject invalid base URL {invalid!r}")

    manifest = build_manifest(
        {},
        {"identifier": "markdown-notes-plus", "name": "Markdown Notes+", "main": "dist/index.html"},
        "0.1.0",
        base_url,
        "test-digest",
    )
    assert manifest["url"] == f"{base_url}/static/markdown-notes-plus/dist/index.html"
    assert manifest["download_url"] == f"{base_url}/zips/markdown-notes-plus.zip"
    assert manifest["latest_url"] == f"{base_url}/entries/markdown-notes-plus.json"


def check_pages_task() -> None:
    task = tomllib.loads((ROOT / "mise.toml").read_text(encoding="utf-8"))["tasks"]["ci:pages"]["run"]
    with tempfile.TemporaryDirectory(prefix="sn-plugins-pages-test-") as temporary:
        root = Path(temporary)
        # Capture the real task's build arguments without running npm or rebuilding the editor.
        for name, script in {
            "npm": "#!/bin/sh\nexit 0\n",
            "python3": (
                f"#!{sys.executable}\nimport json, sys\n"
                "if sys.argv[1] == 'scripts/build.py':\n"
                "    print(json.dumps(sys.argv[1:]))\n"
            ),
        }.items():
            executable = root / name
            executable.write_text(script, encoding="utf-8")
            executable.chmod(0o755)

        for override, expected in (
            (None, "https://kjelly.github.io/sn-plugins"),
            ("", "https://kjelly.github.io/sn-plugins"),
            ("https://plugins.example.com/collection", "https://plugins.example.com/collection"),
        ):
            environment = {
                **os.environ,
                "PATH": str(root) + os.pathsep + os.environ["PATH"],
                "GITHUB_REPOSITORY": "kjelly/sn-plugins",
                "GITHUB_REPOSITORY_OWNER": "kjelly",
            }
            environment.pop("PAGES_BASE_URL", None)
            if override is not None:
                environment["PAGES_BASE_URL"] = override
            result = subprocess.run(
                ["sh", "-ec", task], cwd=ROOT, env=environment,
                check=True, capture_output=True, text=True,
            )
            assert not result.stderr, result.stderr
            assert json.loads(result.stdout) == [
                "scripts/build.py", "--owner", "kjelly", "--base-url", expected,
            ]

        output = root / "pages"
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/build.py"), "--base-url", "", "--output", str(output)],
            cwd=ROOT, capture_output=True, text=True,
        )
        assert result.returncode != 0
        assert "Base URL must be an absolute HTTP(S) URL" in result.stderr
        assert not output.exists(), "invalid URLs must fail before building or publishing files"


def main() -> int:
    check_manifest_urls()
    check_pages_task()
    validate_unique_identifiers(
        [(Path("first"), "io.github.owner.first"), (Path("second"), "io.github.owner.second")]
    )

    try:
        validate_unique_identifiers(
            [(Path("first"), "io.github.owner.same"), (Path("second"), "io.github.owner.same")]
        )
    except ValueError as error:
        message = str(error)
        assert "Duplicate resolved plugin identifier 'io.github.owner.same'" in message
        assert "first" in message and "second" in message
    else:
        raise AssertionError("duplicate resolved identifiers must fail preflight")

    with tempfile.TemporaryDirectory(prefix="sn-plugins-builder-test-") as temporary:
        root = Path(temporary) / "package"
        outside = Path(temporary) / "outside"
        (root / "dist").mkdir(parents=True)
        outside.mkdir()
        (root / "package.json").write_text("{}\n", encoding="utf-8")
        (root / "dist" / "runtime.js").write_text("runtime", encoding="utf-8")
        (outside / "runtime.js").write_text("outside", encoding="utf-8")
        (root / "escape").symlink_to(outside, target_is_directory=True)

        unsafe_paths = (
            Path("/etc/passwd"),
            root / "dist" / "runtime.js",
            Path("."),
            Path("../outside/runtime.js"),
            Path("dist/../package.json"),
            Path("escape/runtime.js"),
        )
        for unsafe in unsafe_paths:
            try:
                resolve_confined(root, unsafe, "test path")
            except ValueError:
                pass
            else:
                raise AssertionError(f"builder must reject unsafe path {unsafe}")

        package = {"files": ["dist"]}
        runtime_files = collect_runtime_files(root, package)
        assert [path.relative_to(root).as_posix() for path in runtime_files] == [
            "dist/runtime.js",
            "package.json",
        ]
        zip_path = Path(temporary) / "runtime.zip"
        write_runtime_package(root, package, runtime_files, Path(temporary) / "static", zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            names = archive.namelist()
            assert names == ["dist/runtime.js", "package.json"]
            assert all(
                not name.startswith("/") and ".." not in Path(name).parts
                for name in names
            )

        output = Path(temporary) / "pages"
        runtime_dist = output / "static" / "markdown-notes-plus" / "dist"
        (runtime_dist / "assets").mkdir(parents=True)
        (runtime_dist / "index.html").write_text("<!doctype html>\n", encoding="utf-8")
        write_cache_headers(output, [{"identifier": "markdown-notes-plus"}])
        headers = (output / "_headers").read_text(encoding="utf-8")
        assert "/static/markdown-notes-plus/dist/assets/*" in headers
        assert f"Cache-Control: {FINGERPRINTED_ASSET_CACHE_CONTROL}" in headers
        assert "/static/markdown-notes-plus/dist/*.html" in headers
        assert f"Cache-Control: {HTML_CACHE_CONTROL}" in headers

    print("build URL, Pages shell, identifier, confinement, and zip-entry validation: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
