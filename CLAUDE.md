# Project rules for Claude

## Before any task
Always run the `clarify-then-prompt` skill (`.claude/skills/clarify-then-prompt/SKILL.md`) first, for every command or task from the user, no matter how small it looks. Restate the request, ask clarifying questions, wait for answers, rewrite the task as a professional prompt, get a yes, and only then build.

The user is a professional S&P 500 trader who often types from a phone with typos. "ATAS" means the ATAS order flow trading platform (atas.net), not a layout word. When a word could be a product name, ask before guessing.

## Verification
Visual changes must be checked on both a phone-width viewport (390px) and desktop (1280px) before reporting done.
