# Adding a plugin

Each plugin lives in its own directory below `packages/`.

The repository builder discovers directories containing `package.json`.

## Required `package.json` fields

Example theme:

```json
{
  "name": "@local/eink-light",
  "version": "0.1.0",
  "description": "High-contrast light theme",
  "author": "__OWNER__",
  "files": ["dist"],
  "sn": {
    "identifier": "io.github.__OWNER__.eink-light",
    "name": "E-Ink Light",
    "content_type": "SN|Theme",
    "area": "themes",
    "main": "dist/theme.css",
    "showInGallery": false
  }
}
```

Required by this repository builder:

- `version`
- `sn.identifier`
- `sn.name`
- `sn.content_type`
- `sn.area`
- `sn.main`

`__OWNER__` is replaced at build time with the normalized GitHub owner supplied through `--owner` or `GITHUB_REPOSITORY_OWNER`.

## Runtime files

Use the normal `package.json` `files` array to define what goes into:

```text
dist-pages/static/<identifier>/
dist-pages/zips/<identifier>.zip
```

`package.json` is always included.

Example:

```json
"files": [
  "dist",
  "assets"
]
```

The `sn.main` path must exist after the package's optional build step and must be included in the published runtime files.

## Optional per-package build.py

If a package contains:

```text
build.py
```

the repository builder runs it before packaging.

This lets each package choose its own implementation while keeping the repository-level tooling simple.

A theme can simply copy CSS:

```python
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent
dist = root / "dist"
dist.mkdir(exist_ok=True)
shutil.copyfile(root / "src" / "theme.css", dist / "theme.css")
```

A more complex editor could have its `build.py` invoke Node, Bun, another bundler, or any other build system required by that plugin.

## Generated manifest

For every package, `scripts/build.py` generates:

```text
entries/<identifier>.json
```

with fields derived from `package.json` plus:

```json
{
  "url": "https://.../static/<identifier>/<sn.main>",
  "download_url": "https://.../zips/<identifier>.zip",
  "latest_url": "https://.../entries/<identifier>.json"
}
```

The manifest install URL is the `entries/*.json` URL.

## Adding a theme with the helper

```bash
python3 scripts/new_plugin.py theme "My Theme" my-theme
```

Then edit:

```text
packages/io.github.__OWNER__.my-theme/src/theme.css
```

and bump the version whenever you publish an update.

## Complex editors/components

The hosting and packaging pipeline is content-type agnostic. A complex Standard Notes component/editor can use the same package contract, but its runtime must correctly implement the Standard Notes component protocol/relay expected by that editor.

This starter deliberately does not pretend that a static HTML page is a functional note editor. Start from a known-compatible Standard Notes component implementation or the current component SDK/relay for editor behavior, then let this repository package the resulting runtime.
