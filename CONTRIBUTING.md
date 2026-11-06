# Adding a POV

POV Exchange is a **public** site. Anything merged to `main` is published to the internet within a couple of minutes.

## Before you add anything

- **Practice opinions only.** No client names, client data, internal URLs, or anything you would not put on a public website.
- **The automated checks cannot read inside a PDF, deck or spreadsheet.** They scan the text files and the front matter, but a person has to look inside documents. Check yours before uploading.
- Use a **name only** for the author. No email addresses or handles.

## How to add one (on github.com)

1. Open the [`povs`](povs) folder and look at [`_template/pov.md`](povs/_template/pov.md).
2. Choose **Add file > Create new file**. In the name box type `povs/your-slug/pov.md`, where the slug is lowercase letters, digits and hyphens (for example `agents-need-an-owner`).
3. Paste the template, fill it in, and write your POV below the second `---` line.
4. To attach documents, use **Add file > Upload files** into the same `povs/your-slug/` folder, and list each file name under `documents:` in `pov.md`. Allowed types: pdf, pptx, docx, xlsx, csv, txt, md. Maximum 20 MB each.
5. Commit.
   - If you can write to the repository, commit to a new branch and open a pull request so the checks run before anything is published.
   - If you cannot, GitHub offers to create a fork and a pull request for you. A maintainer reviews it.

## Topics

Every POV must use topics from [`povs/topics.json`](povs/topics.json). To propose a new topic, change that file in the same pull request. Topics carry the house view that appears at the top of each section, so a new topic needs a one-line view from the practice.

## If the check fails

The pull request shows a red cross. Open the failed check and read the log. Each line names a file, a line number and the rule that was broken, for example `povs/my-pov/pov.md:7: lists a topic that is not in povs/topics.json`. It never repeats the text that caused the problem.

## Run the checks yourself (optional)

With Node 22 or later installed:

```
node scripts/build.mjs --check
```
