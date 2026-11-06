# POV Exchange

A public, static site: a live library of the practice's point of view on AI topics, explorable as a knowledge graph. Hosted on GitHub Pages at https://owen-rogan.github.io/POV_Exchange/.

## Hard rules

- **Public repo.** No client data, no client names, no internal URLs, no secrets. Practice opinions only.
- **No personal or work email in git history.** Commits use a GitHub noreply address.
- **Commit and push only when the user asks.**

## Layout

```
povs/topics.json        curated topics (the curation lives here)
povs/<slug>/pov.md      a POV: front matter + restricted markdown
povs/<slug>/*.pdf ...   optional documents beside it
povs/_template/         skipped by the build (folders starting "_")
site/                   front end (committed; vendor/ holds three.js)
scripts/build.mjs       validate + build -> dist/
scripts/lib/            front matter, markdown, text rules, graph layout
scripts/test.mjs        build tests (node --test scripts/test.mjs)
scripts/serve.mjs       local preview, 127.0.0.1 only
CONTRIBUTING.md         how to add a POV
.github/workflows/      pages.yml
dist/                   generated, git-ignored, deployed by the Action
```

## Build and run

```
node scripts/build.mjs                       # build into dist/
node scripts/build.mjs --check               # validate only
node --test scripts/test.mjs                 # run the build tests
node scripts/serve.mjs --prefix /POV_Exchange  # http://127.0.0.1:8080/POV_Exchange/
```

- The build runs on the GitHub runner's built-in Node 22 with **no `npm install`**. Use only `node:` built-ins and nothing newer than Node 22. Local Node is 24, so do not assume 24-only APIs.
- All site paths are relative (the site is served under `/POV_Exchange/`). The one exception is `404.html`, which uses `/POV_Exchange/` because Pages serves it at any depth.
- Generated data is never committed, so there is no commit loop.

## Security conventions

- Browser code builds DOM with `textContent`. No `innerHTML`, no raw HTML from content.
- Build-time page generation passes every interpolated value through one `esc()` function. Markdown is parsed to blocks, never passed through as HTML. Links are emitted only after the https check.
- Build errors name the file and rule, never the offending value (it may be a secret).
- Workflows use only official `actions/*`, pinned to full commit SHAs. PR validation has `contents: read` only and never uses `pull_request_target`.
