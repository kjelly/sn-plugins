# Standard Notes Plugins Starter

A self-contained monorepo starter for hosting multiple Standard Notes external plugins on GitHub Pages.

It follows the current Standard Notes external-package model:

- one repository can contain many plugins;
- Standard Notes installs a plugin from an HTTPS JSON manifest URL;
- the manifest points to a hosted runtime URL (`url`);
- Desktop can download a ZIP (`download_url`);
- Desktop can check `latest_url` for newer versions.

This starter intentionally keeps the release pipeline dependency-light: the repository-level build and packaging tools use only Python 3's standard library.

## Included

- GitHub Pages deployment workflow
- pull-request build verification workflow
- manifest generator
- deterministic-ish ZIP packaging
- generated plugin catalog
- `packages.json` aggregate catalog
- helper to create additional theme plugins
- two working sample themes:
  - E-Ink Light
  - E-Ink Dark
- a source-first Markdown Notes+ editor foundation:
  - Markdown Notes+

The editor lives in its own package directory at
`packages/markdown-notes-plus/`. It keeps the repository
builder generic, so additional plugins can be added as sibling directories.
The editor package currently builds a React/Vite runtime with EditorKit,
Milkdown, CodeMirror 6, and Markmap. Its Deno test command remains a focused
projection/legacy-compatibility suite; Standard Notes Web/Desktop/mobile host
integration and complete CommonMark/GFM behavior are not claimed.

## Repository layout

```text
.
├── .github/workflows/
│   ├── pages.yml
│   └── verify.yml
├── packages/
│   ├── io.github.__OWNER__.eink-light/
│   └── io.github.__OWNER__.eink-dark/
├── scripts/
│   ├── build.py
│   └── new_plugin.py
├── docs/
│   ├── ADDING_PLUGIN.md
│   └── INSTALLING_PLUGINS.md
└── dist-pages/             # generated, not committed
```

## 1. GitHub repository

The canonical repository for this collection is:

```text
https://github.com/kjelly/sn-plugins
```

If you are setting up a fresh clone, push the `main` branch with:

```bash
git init
git add .
git commit -m "Initial Standard Notes plugins repository"
git branch -M main
git remote add origin git@github.com:kjelly/sn-plugins.git
git push -u origin main
```

## 2. Enable GitHub Pages

In GitHub:

```text
Settings
  → Pages
  → Build and deployment
  → Source: GitHub Actions
```

The included `.github/workflows/pages.yml` will build and deploy the site after a push to `main`.

The workflow automatically derives:

```text
https://kjelly.github.io/sn-plugins
```

and replaces `__OWNER__` inside generated plugin identifiers with `kjelly`.

## 3. Install the included plugins

After the Pages workflow finishes successfully, install each plugin from its
manifest URL. In Standard Notes Desktop or Web, open the external/custom
package installation field, paste one URL below, and confirm installation:

```text
E-Ink Light
https://kjelly.github.io/sn-plugins/entries/io.github.kjelly.eink-light.json

E-Ink Dark
https://kjelly.github.io/sn-plugins/entries/io.github.kjelly.eink-dark.json

Markdown Notes+
https://kjelly.github.io/sn-plugins/entries/markdown-notes-plus.json
```

The generated Pages home page also lists the current manifest, runtime, and
ZIP URLs for every plugin. Install the `entries/*.json` URL, not the GitHub
repository URL and not the `static/` or `zips/` URL.

### Updating an installed plugin

When a plugin version changes, push the update to `main` and wait for the
Pages workflow to deploy. Standard Notes can use the same `latest_url` manifest
to detect the new version.

## Local build

All development and CI runtimes are pinned in [`mise.toml`](mise.toml).
Install those runtimes and the locked npm dependency graph before building or
testing:

```bash
mise install
mise run deps
```

The normal local verification entry point is:

```bash
mise run test:verify
```

Individual checks are available through `mise tasks ls`, for example
`mise run test:unit`, `mise run test:integration`, and
`mise run test:e2e:release`. `mise.lock`, `package-lock.json`, and `deno.lock`
pin the corresponding runtime and package dependency graphs.

```bash
mise exec -- python3 scripts/build.py \
  --owner kjelly \
  --base-url http://127.0.0.1:8000
```

The repository builder discovers sibling packages, runs each optional
package-local `build.py`, validates that `sn.main` and every declared runtime
file remain inside that package (rejecting absolute, traversal, and symlink
escape paths), then writes safe POSIX ZIP entries. For the Markdown Notes+
package, the package-local build uses `npm run build` and requires Node 18+.

Serve the generated Pages tree:

```bash
mise exec -- python3 -m http.server 8000 -d dist-pages
```

Open:

```text
http://127.0.0.1:8000/
```

The local manifest URLs will use the local base URL supplied above.

## Add another theme

```bash
mise exec -- python3 scripts/new_plugin.py theme "Paper Gray" paper-gray
mise exec -- python3 scripts/build.py --owner YOUR_GITHUB_USER --base-url http://127.0.0.1:8000
```

See [`docs/ADDING_PLUGIN.md`](docs/ADDING_PLUGIN.md) for package format and runtime file rules.
See [`docs/INSTALLING_PLUGINS.md`](docs/INSTALLING_PLUGINS.md) for published manifest URLs and troubleshooting.

## Versioning

When changing a plugin, increase its `package.json` version:

```json
{
  "version": "0.2.0"
}
```

The generated `latest_url` always points to the current manifest. Standard Notes Desktop can compare that version and download the new ZIP.

The package-level checks are:

```sh
mise run lint
mise run typecheck
mise run test:unit
mise run test:integration
mise run test:e2e:release
mise run build
```

`mise run test:unit` is intentionally Deno-based for the existing projection and relay
compatibility regressions; it is not full browser/host acceptance.

## Important security note

An external Standard Notes component is code you are choosing to execute in the client context available to that component. Keep this repository under your control, review dependencies and GitHub Actions changes, and avoid installing manifests from untrusted repositories.
