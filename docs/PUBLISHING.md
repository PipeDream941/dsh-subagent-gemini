# Publishing checklist

## 1. Publish the npm package

The package is already shaped for the plugin market: it declares
`dsh.bundle.patch` in `package.json` and ships `cordis.patch.yml` next to it.

```bash
npm login                      # one-time, needs an npm account
npm run pack:check             # verify the tarball contents
npm publish --access public
```

Before publishing, update the metadata in `package.json`:

- `repository` / `homepage` — your GitHub repository (the market links to it);
- `version` — bump on every publish (see `CHANGELOG.md`).

## 2. Push the GitHub repository

Create a repository (e.g. `dsh-subagent-gemini`) and push this directory. The
market requires:

- `package.json` with the `dsh.bundle` manifest (already present);
- a `cordis.patch.yml` next to it (already present);
- real, working code — this plugin ships real behavior (CLI discovery,
  configuration normalization, credential detection), not just a dependency list;
- a repository **at least one day old** before submitting the market PR;
- the GitHub topic **`dsh-plugin`** on the repository.

```bash
gh repo create dsh-subagent-gemini --public --source . --push   # or create it in the UI
gh repo edit --add-topic dsh-plugin                             # requires gh auth
```

## 3. Submit to the DSH plugin market

Per the market [contributing guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md),
open a PR that adds exactly one file, `data/plugins/<owner>__<repo>.yml`:

```yaml
url: https://github.com/<owner>/dsh-subagent-gemini
name: <owner>/dsh-subagent-gemini
category: tools
description:
  en: "Runs the Google Gemini CLI as a one-shot coding subagent over the Agent Client Protocol, exposed as a subagent_gemini delegation tool."
  zh: "把 Google Gemini CLI 作为一次性编码子智能体接入 DeepSeek Harness，提供 subagent_gemini 委派工具。"
```

Notes:

- Only `description.en` is required; `zh` is optional.
- Quote the description if it contains a colon followed by a space.
- `category` is `tools` (a model-facing delegation tool). The category list also
  includes `model`, `workflow`, etc.; pick the closest one.
- Do **not** edit the generated README files by hand.
- If you publish tarballs instead of npm, add a `tarball:` URL to the entry.

## 4. Version compatibility

`package.json` pins `@deepseek-ai/dsh-subagent-acp` to the DSH release this
plugin was developed against (`0.2.1-rc.2`). When a new DSH minor lands:

1. bump that dependency and the `dsh` engine range;
2. run `npm test` and `npm run smoke` against the new host;
3. publish a new version and update the market entry if anything user-visible changed.
