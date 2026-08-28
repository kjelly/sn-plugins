# Installing the plugins

The plugins in this repository are published through GitHub Pages. Standard
Notes installs them from their HTTPS manifest URL, not directly from GitHub.

## Published plugin URLs

After the `Deploy GitHub Pages` workflow succeeds, install any of these URLs
in Standard Notes Desktop or Web through the external/custom package
installation field:

| Plugin | Manifest URL |
| --- | --- |
| E-Ink Light | <https://kjelly.github.io/sn-plugins/entries/io.github.kjelly.eink-light.json> |
| E-Ink Dark | <https://kjelly.github.io/sn-plugins/entries/io.github.kjelly.eink-dark.json> |
| Markdown Notes+ | <https://kjelly.github.io/sn-plugins/entries/io.github.kjelly.markdown-notes-plus.json> |

Paste one complete `entries/*.json` URL, confirm the package details, and
install it. The plugin then appears in the corresponding Standard Notes
theme/editor selection UI.

Do not paste the repository URL, the Pages home URL, a `static/` URL, or a
`zips/` URL into the package installer. Those are not install manifests.

## If installation fails

1. Open the [GitHub Actions](https://github.com/kjelly/sn-plugins/actions)
   page and confirm that `Deploy GitHub Pages` completed successfully.
2. Open the manifest URL in a browser. It should return JSON rather than a
   GitHub 404 page.
3. Retry the installation using the `entries/*.json` URL.

For local development, build the Pages tree with:

```bash
python3 scripts/build.py --owner kjelly --base-url http://127.0.0.1:8000
python3 -m http.server 8000 -d dist-pages
```

The local manifest URLs are only for local testing and are not installable by
other devices unless they can reach your machine.
