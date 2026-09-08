# Project instructions

## Use Mise for project commands

- Use the repository's Mise configuration (`mise.toml`) for project tools and tasks.
- Before running checks or builds in a fresh checkout, run `mise install` and `mise run deps`.
- Run repository workflows through Mise tasks, for example:
  - `mise run typecheck`
  - `mise run lint`
  - `mise run test:unit`
  - `mise run test:integration`
  - `mise run build`
- Do not invoke project-managed tools such as `node`, `npm`, `deno`, `tsc`, or `vite` directly when a Mise task or `mise exec` command is available.
- If a package-scoped command is necessary, run it with `mise exec` from the package directory and preserve the package's existing script arguments.
