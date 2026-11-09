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
povs/glossary/<term>.md one glossary term per file (see povs/glossary/README.md)
site.config.json        site settings: contact line, site address, indexing (off), publisher, personal-OneDrive switch
povs/_template/         skipped by the build (folders starting "_")
povs/samples/<slug>/    fictional sample POVs, flagged `sample` by their folder alone; delete povs/samples/ to remove them all
site/                   front end, copied to dist/ (index = Library, graph/, add/, 404, styles, js/, fonts/, vendor/)
site/js/                browser modules (see Front end below)
site/vendor/three/      three.js r187 (three.module.js + three.core.js, MIT), committed so CI needs no npm
site/fonts/             IBM Plex Sans 300/400/600 and Mono 400 (SIL OFL), committed
scripts/build.mjs       validate + build -> dist/
scripts/lib/            front matter, markdown, text rules, graph layout, page builders, and the two build-time pictures (constellation.mjs, ego.mjs)
scripts/test.mjs        build tests (node --test scripts/test.mjs)
scripts/make-samples.mjs  fictional POVs: preview into _samples/ (git-ignored), or --repo to write povs/samples/
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

- Pages: **Library** (`/`: tiles, search, By topic / Newest first, a still topic picture, no 3D), **Graph** (`/graph/`: full-screen explorable graph with a side browser on the left, a reader panel on the right, timeline, tour, and a plain collapsed list at the foot), **Glossary** (`/glossary/`) and **Add** (`/add/`).
- The Library picture and the Graph poster are drawn at build time by `scripts/lib/constellation.mjs`: topics as labelled circles holding their POV count, POVs as faint dots, lines between topics only. It draws a wide and a narrow version; CSS shows the one that fits. Never put the 3D graph or the full node set in a still picture again: it turns into a hairball.
- **Where this sits** (on each POV page) is `scripts/lib/ego.mjs`: a laid-out diagram, not a slice of the 3D graph. Fixed-width pills (topics left, this POV middle, related POVs right, glossary terms below; a stacked tree on phones), 14px text, long titles cut with an ellipsis and a tooltip, up to 4/5/5 items then "+N more". It is a visual twin (`aria-hidden`, links not tabbable); the text lists beside it are the accessible version. Never project the 3D graph into a small picture again: labels scale up and pile on top of each other.
- **Layout** (`scripts/lib/layout.mjs`, `computeClusterLayout`): topics by the force layout on topic-to-topic edges alone; each POV on a Fibonacci sphere around its **main topic** (the first topic it lists), nudged toward its other topics; documents orbit their POV; glossary terms on an outer shell at 1.18 times the radius. A POV's first topic edge is kind `link`, its others `link2`. `link2` and `term` lines are drawn only for the selected or hovered node (`edgeReveal` in `graph-common.js`), so the default picture stays calm.
- **Side browser** (`browse-model.js` pure, `browse.js` UI, wired in `graph-page.js`): search, the three switches, and topics that expand to their POVs, each POV once under its main topic. It reads the same filter result as the graph, so list and picture cannot disagree. Open by default at 1200px and wider; below that only one of browser and reader is open, and on phones both are bottom sheets. The `/` key opens it and focuses search.
- **Moving around:** on-screen Turn/Move switch, zoom in/out and Home buttons, and a ? hint. `dragMeaning` in `controls.js` decides what a drag does from the mode, Shift, mouse button and pointer type (middle and right buttons always slide).
- Graph engine: `graph-engine.js` owns the camera (`camera.js`, pure maths), input (`controls.js`), label choice (`labels.js`) and the frame loop. A *painter* only draws: `graph3d.js` (WebGL) or `graph2d.js` (canvas). Both read the screen positions the engine computes, so hit-testing and drawing always agree.
- Three tiers, chosen in `site/js/tier.js`: `full` (WebGL), `lite` (2D canvas), `static` (the SVG poster plus the list). Reduced motion keeps the graph interactive but stops it moving by itself; only a device that cannot draw gets `static`. Force one with `#tier=full|lite|static`.
- Node positions are precomputed by the build (`data/graph.json`); the browser never simulates physics. Each POV's text is in `data/pov/<slug>.json`, fetched when the reader opens it.
- Two switches shared by Library, Graph and Glossary, remembered in localStorage by `site/js/prefs.js`: **Show samples** (default on while the site is being shaped) and **Show drafts** (default off, so visitors see agreed POVs first). The address overrides them (`#samples=0`, `#drafts=1`). Graph URL state: `#n=<node id>`, `#t=<topic>` (selects that topic; it is no longer a filter), `#q=<text>`, `#terms=1`.
- Counts on the Library are recomputed in the browser from the cards that are shown, never from numbers written into the page, so they cannot disagree with the cards.
- **Documents are links, never uploads.** `documents: ["Title | https://..."]`, checked by `scripts/lib/doc-links.mjs` (Box, SharePoint, OneDrive only; personal OneDrive refused; https, no credentials, no port). Any other file in a POV folder fails the build. Graph document nodes are `d:<slug>/<position>`.
- **Status** (`draft` | `agreed`) is required on every POV. Drafts are hidden by default and drawn as rings in the graph.
- **Glossary:** `povs/glossary/*.md` and `povs/samples/glossary/*.md`. `scripts/lib/glossary.mjs` marks the first mention of each term in each POV; the browser pop-up is `site/js/terms.js`. Terms are a fourth graph node kind, hidden unless "Show terms" is on.
- **Settings** are in `site.config.json` (`scripts/lib/config.mjs` validates it). While `indexing` is false every page carries `noindex, nofollow`. The contact line is plain text; no address or link to anything internal belongs in it.
- Pure, tested modules: `graph-filter.js`, `browse-model.js`, `timeline.js`, `tour.js`, `labels.js`, `camera.js`, `graph-data.js`, `render-blocks.js`, and `dragMeaning` in `controls.js`.
- CSS: the form-message class is `.form-status`. Do not add spacing to a bare `.status`: that class is also the Draft/Agreed chip (a test enforces this).
- Pages are templates in `site/` with `<!-- build:name -->` markers that `scripts/build.mjs` expands. Add a marker in both `lib/pages.mjs` (`MARKERS`) and the `fns` table in `build.mjs`.
- `site/js/shared/*.js` in `dist/` are copies of `scripts/lib/{doc-links,frontmatter,markdown,rules}.mjs`, so the Add page checks text exactly as the build does. Edit the originals only.
- Vendored three.js was fetched with `npm pack three@0.187.0` and checked against the registry hash `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==` before use. To upgrade, repeat that and replace both files together (they must be the same version).
- Preview quirk: an unfocused preview window never fires animation frames, so the graph can look frozen there. Code that must start the page uses a timer fallback (see `afterPaint` in `main.js`).
- Source files are plain ASCII. Write special characters as `\uXXXX` escapes (a test enforces this).

## Uploading to GitHub by hand

`node scripts/package.mjs` writes three zips into `_package/` (the web uploader takes at most 100 files at once): the app first, then the samples in batches. Upload them in that order and wait for a green run after each. The web uploader can only add and overwrite, never delete, so when a change makes old files invalid (as the move to document links did), delete the old folders on GitHub first. A project with no POVs must still build; a test covers it.

## Security conventions

- Every page carries a strict CSP (`script-src 'self'; style-src 'self'`): no inline scripts, no `style=` attributes in HTML, no third-party hosts. Styling that changes at runtime goes through `element.style.*` or CSS classes.

- Browser code builds DOM with `textContent`. No `innerHTML`, no raw HTML from content.
- Build-time page generation passes every interpolated value through one `esc()` function. Markdown is parsed to blocks, never passed through as HTML. Links are emitted only after the https check.
- Build errors name the file and rule, never the offending value (it may be a secret).
- Workflows use only official `actions/*`, pinned to full commit SHAs. PR validation has `contents: read` only and never uses `pull_request_target`.
