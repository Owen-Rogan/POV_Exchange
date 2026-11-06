---
title: Example POV: how this page is put together
summary: A fictional example that shows every supported feature. Delete this folder once you have real POVs.
type: pov
topics: [agents, governance]
author: Example Author
date: 2026-11-06
documents: [example-notes.txt]
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
2. Fill in the front matter at the top of `pov.md`.
3. Write the body, add any documents, and commit.

> A point of view is only useful if someone can find it, read it and act on it.

## What is not allowed

The build stops with a clear message if a file contains raw HTML, images, email addresses, tokens or links that do not start with https. It names the file and line but never repeats the offending text.
