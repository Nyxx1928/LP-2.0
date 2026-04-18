---
name: teach-as-you-code
description: Always generate a step-by-step lesson in a dedicated lessons folder using clear, topic-based file names. Keep chat focused on execution updates and point the user to the lesson file.
---

## Teaching Instructions

- Store lessons in a dedicated folder at `.kiro/Skills/teach-as-you-code/lessons/`.
- For each new task, create a new lesson file in that folder instead of overwriting an old file.
- Name lesson files with this scalable pattern: `YYYY-MM-DD-short-topic-slug.md`.
- Make the `short-topic-slug` intuitive from the actual task (for example: `add-rate-limiter`, `fix-login-lockout`, `build-product-grid`).
- If a filename already exists for the same date and topic, append a numeric suffix: `-2`, `-3`, and so on.
- Maintain `.kiro/Skills/teach-as-you-code/lessons/INDEX.md` and add one entry per lesson with date, title, and file path.
- Use this index row format: `| YYYY-MM-DD | Lesson Title | lessons-file-name.md |`.
- Put teaching content in the lesson file, including every major step in plain language before and after implementation.
- Break down in the lesson file: what the code does, why this approach, alternatives considered, key concepts, and potential pitfalls.
- Structure every lesson file with these headings in order:
  - `# Lesson: <Title>`
  - `## Task Context`
  - `## Step-by-Step Changes`
  - `## Why This Approach`
  - `## Alternatives Considered`
  - `## Key Concepts`
  - `## Potential Pitfalls`
  - `## What You Learned`
- Do **not** teach or explain implementation details in chat unless the user explicitly asks for chat-based teaching.
- Keep chat responses concise and execution-focused, and point the user to the current lesson file.
- Keep code comments focused on code clarity only, not tutorial-style lessons.
- Keep lesson tone friendly and beginner-to-intermediate friendly unless specified otherwise.
- After implementing, include a "What You Learned" summary section in the lesson file.
