# Adding a POV

POV Exchange is a **public** site. Anything merged to `main` is published to the internet within a couple of minutes.

## Before you add anything

- **Practice opinions only.** No client names, client data, internal URLs, or anything you would not put on a public website.
- **Never upload a document to this repository.** Keep it in Box, SharePoint or OneDrive and add its share link (see "Documents" below). The automated checks cannot read inside a PDF, deck or spreadsheet, so a person has to look inside a document before linking it.
- Use a **name only** for the author. No email addresses or handles.

## How to add one (on github.com)

1. Open the [`povs`](povs) folder and look at [`_template/pov.md`](povs/_template/pov.md).
2. Choose **Add file > Create new file**. In the name box type `povs/your-slug/pov.md`, where the slug is lowercase letters, digits and hyphens (for example `agents-need-an-owner`).
3. Paste the template, fill it in, and write your POV below the second `---` line. Set `status: draft` until the practice has agreed the view, then `status: agreed`.
4. To attach documents, add their links under `documents:` (next section).
5. Commit.
   - If you can write to the repository, commit to a new branch and open a pull request so the checks run before anything is published.
   - If you cannot, GitHub offers to create a fork and a pull request for you. A maintainer reviews it.

## Documents

A document is a link, written as `Title | link`:

```
documents: ["Agents deck | https://your-team.sharepoint.com/:b:/s/Practice/Eabc...", "Workshop notes | https://ibm.box.com/s/abc..."]
```

- Only **Box, SharePoint and OneDrive** links are accepted (`box.com`, `sharepoint.com`, `1drv.ms`, `onedrive.live.com`). Any other address stops the build.
- **Personal OneDrive links** (the ones with `-my.sharepoint.com` or `/personal/` in them) are refused, because they carry a person's name. Use a SharePoint team site or Box.
- Readers may be asked to sign in. The site says so next to every document.
- Give each link a clear title. A title cannot contain `|`, quote marks, `<`, `>` or a back-tick.
- Anything uploaded into a POV folder other than `pov.md` stops the build.

## Status

Every POV has `status: draft` or `status: agreed`. The Library shows agreed POVs first, with a "Show drafts" switch. A draft page carries a notice that the view is still forming. Do not mark a POV `agreed` until the practice has agreed it.

## Glossary

One file per term in `povs/glossary/`, for example `povs/glossary/guardrail.md`. See `povs/glossary/README.md` for the format. The first time a term appears in a POV it is underlined with a pop-up definition, and the term links to every POV that uses it. A definition can be read as the practice's position, so write them as carefully as a POV.

## Sample POVs

While the site is being shaped, `povs/samples/` holds 120 **fictional** POVs and 25 fictional glossary terms so the library, the graph and the glossary have something to show. They are tagged "Sample" on the site and a switch hides them. Their document links are fake and open nothing. To remove every one, delete the `povs/samples` folder. Real POVs go in `povs/<name>/`, not in `samples`.

## Topics

Every POV must use topics from [`povs/topics.json`](povs/topics.json). To propose a new topic, change that file in the same pull request. Topics carry the house view that appears at the top of each section, so a new topic needs a one-line view from the practice. Topics marked `"sample": true` exist only for the sample POVs and disappear from the site on their own once the samples are deleted.

## If the check fails

The pull request shows a red cross. Open the failed check and read the log. Each line names a file, a line number and the rule that was broken, for example `povs/my-pov/pov.md:7: lists a topic that is not in povs/topics.json`. It never repeats the text that caused the problem.

## Run the checks yourself (optional)

With Node 22 or later installed:

```
node scripts/build.mjs --check
node --test scripts/test.mjs
```
