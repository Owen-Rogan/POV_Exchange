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
site/                   front end, copied to dist/ (index, add/, 404, styles, js/, fonts/, vendor/)
site/js/                browser modules: tier, graph3d (WebGL), graph2d (canvas), panel, explore, add ...
site/vendor/three/      three.js r187 (three.module.js + three.core.js, MIT), committed so CI needs no npm
site/fonts/             IBM Plex Sans 300/400/600 and Mono 400 (SIL OFL), committed
scripts/build.mjs       validate + build -> dist/
scripts/lib/            front matter, markdown, text rules, graph layout, page and svg builders
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

## Front end

- Three tiers, chosen in `site/js/tier.js`: `full` (WebGL), `lite` (2D canvas), `static` (the SVG poster already in the HTML). Reduced motion or no canvas is always `static`. Force one with `#tier=full|lite|static`.
- Node positions are precomputed by the build (`data/graph.json`); the browser never simulates physics.
- Pages are templates in `site/` with `<!-- build:name -->` markers that `scripts/build.mjs` expands. Add a marker in both `lib/pages.mjs` (`MARKERS`) and the `fns` table in `build.mjs`.
- `site/js/shared/*.js` in `dist/` are copies of `scripts/lib/{frontmatter,markdown,rules}.mjs`, so the Add page checks text exactly as the build does. Edit the originals only.
- Vendored three.js was fetched with `npm pack three@0.187.0` and checked against the registry hash `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==` before use. To upgrade, repeat that and replace both files together (they must be the same version).
- Source files are plain ASCII. Write special characters as `\uXXXX` escapes (a test enforces this).

## Security conventions

- Every page carries a strict CSP (`script-src 'self'; style-src 'self'`): no inline scripts, no `style=` attributes in HTML, no third-party hosts. Styling that changes at runtime goes through `element.style.*` or CSS classes.

- Browser code builds DOM with `textContent`. No `innerHTML`, no raw HTML from content.
- Build-time page generation passes every interpolated value through one `esc()` function. Markdown is parsed to blocks, never passed through as HTML. Links are emitted only after the https check.
- Build errors name the file and rule, never the offending value (it may be a secret).
- Workflows use only official `actions/*`, pinned to full commit SHAs. PR validation has `contents: read` only and never uses `pull_request_target`.
