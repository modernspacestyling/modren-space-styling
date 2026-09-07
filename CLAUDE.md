# Project rules for Claude

## Before any task
Always run the `clarify-then-prompt` skill (`.claude/skills/clarify-then-prompt/SKILL.md`) first, for every command or task from the user, no matter how small it looks. Restate the request, ask clarifying questions, wait for answers, rewrite the task as a professional prompt, get a yes, and only then build.

The user often types from a phone with typos and some Malay words (atas = top/above, bawah = bottom/below, kiri = left, kanan = right, tengah = centre). Do not guess at these; confirm.

## Verification
Visual changes must be checked on both a phone-width viewport (390px) and desktop (1280px) before reporting done.
