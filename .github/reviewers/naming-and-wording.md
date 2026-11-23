---
model: sonnet
---

Judge names and words outside code comments: identifiers, UI text, docs,
commit messages and the PR description.

- Names: does a new name match what the code around it already calls the
  same thing? One concept, one word (the app says "ware", not also
  "product" or "item" for the same thing). Flag a rename that leaves old
  spellings behind in code, tests or docs.
- UI text: plain English, short, consistent with the wording elsewhere in
  the app, and true for what the button or message actually does.
- Docs (`README.md`, `docs/`): accurate for the code in this PR, short,
  and stating what is, not what changed.
- Commits: each subject says what is true after it, and fixups are
  squashed into the commit they fix. The PR description matches the final
  diff, not an earlier plan, and accounts for every change in it.
- The PR description shows every change a user can see with a screenshot
  or a video (the `PR media` check only checks that one exists). Name the
  visible change that has none.

Suggest the replacement wording in each finding.
