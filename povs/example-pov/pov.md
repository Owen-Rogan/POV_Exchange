---
title: Example POV: how this page is put together
summary: A fictional example that shows every supported feature. Delete this folder once you have real POVs.
type: pov
status: agreed
topics: [agents, governance]
author: Example Author
date: 2026-11-06
documents: ["Example attachment (a link) | https://example.box.com/s/exampledocumentlink"]
---
This is a **fictional example**. It says nothing about what the practice thinks. It exists to show what a POV page can contain and to prove the pipeline works end to end.

## What you can write

A POV is plain text with a small set of formatting:

- Headings with `##` and `###`
- **Bold** and *italic* text, and `inline code`
- Bullet lists and numbered lists
- Quotes
- Links to public websites, such as [GitHub Pages documentation](https://docs.github.com/en/pages)

### Numbered steps

1. Copy the `_template` folder and rename it to a short slug.
2. Fill in the front matter at the top of `pov.md`, including `status: draft` or `status: agreed`.
3. Write the body. Link any documents from Box, SharePoint or OneDrive, and commit.

> A point of view is only useful if someone can find it, read it and act on it.

## Documents are links

Never upload a document into this repository. Put it in Box, SharePoint or OneDrive and list the link under `documents:` as `Title | link`. The link above is a made-up example and does not open anything.

## What is not allowed

The build stops with a clear message if a file contains raw HTML, images, email addresses, tokens, links that do not start with https, or a document link that is not on Box, SharePoint or OneDrive. It names the file and line but never repeats the offending text.
