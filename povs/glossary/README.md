# Glossary

One file per term: `povs/glossary/<name>.md`. The name is lowercase letters, digits and hyphens.

```
---
term: Guardrail
summary: A one-line definition, 200 characters or fewer.
aliases: [guardrails]
related: [human-in-the-loop]
---
Optional longer explanation, in the same restricted markdown as a POV.
```

- `term` and every alias must be unique across the whole glossary.
- `related` lists other term file names (without `.md`).
- The first time a term (or an alias) appears in a POV, it is underlined and shows this definition. A term appears once per POV.
- Fictional sample terms live in `povs/samples/glossary/` and go away when `povs/samples/` is deleted.
