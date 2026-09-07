---
name: clarify-then-prompt
description: MANDATORY first step for EVERY command, task, bug report, or feature request the user gives, before touching any file or tool. The user often types quickly, on a phone, with typos and mixed English/Malay words (e.g. "atas" = top/above, "bawah" = bottom/below, "kiri" = left, "kanan" = right, "tengah" = centre). Restate what you understood, ask every clarifying question needed to remove ambiguity, wait for answers, then rewrite the request as a top-1% professional prompt (goal, context, exact scope, acceptance criteria, constraints) and confirm it before executing. Use this even for tasks that look obvious.
---

# Clarify, then prompt, then build

The user wants no guessing. Every task goes through three gates before any code, file, or external change is made.

## Gate 1: Understand and ask

1. Read the request slowly. Expand typos and non-English words. Common ones:
   - atas = top / above, bawah = bottom / below
   - kiri = left, kanan = right, tengah = centre / middle
   - besar = big, kecil = small, salah = wrong, betul = correct
   - "on my phone" = the issue must be checked on a mobile viewport too
2. Write back, in one or two plain sentences, what you think they want.
3. Ask clarifying questions. Ask as many as needed, but make each one cheap to answer: offer options or yes/no where possible, so the user can reply from a phone. Always cover:
   - **Where**: which page, screen, file, or URL. Name the candidates you found in the repo so they can just pick one.
   - **What is wrong now**: what they see today (position, text, colour, behaviour). Ask for a screenshot if a visual bug is described in words.
   - **What good looks like**: the expected result, in their words.
   - **Devices**: desktop, phone, or both. Which browser or app.
   - **Scope**: fix only this, or also the same pattern elsewhere.
   - **Done means**: how they will check it (visual, a test, a specific value).
4. Do NOT start implementing while questions are open. If the session is autonomous and the user cannot reply, state your assumptions explicitly, pick the most likely reading, and flag it clearly at the top of your final message.

## Gate 2: Write the professional prompt

Once answers are in, rewrite the task as a prompt a top engineer would hand to an AI. Use this exact structure and show it to the user for a quick yes/no before executing:

```
## Task
One sentence stating the outcome.

## Context
- Project, stack, and the exact files/pages involved (repo-relative paths).
- What the user sees today (their words + what you verified in the code).

## Requirements
1. Numbered, testable requirements. Each one observable.
2. Devices / breakpoints that must be covered.

## Out of scope
- What must NOT change.

## Acceptance criteria
- [ ] Checkbox list the user can verify.

## Verification plan
- How you will prove it (screenshot at widths X and Y, test command, etc).
```

Keep it short. No filler. Every line must change what gets built.

## Gate 3: Execute and report

- Build exactly the confirmed prompt, nothing more.
- Verify with the plan from Gate 2 and show evidence (screenshots, test output).
- In the final message, restate the confirmed prompt's task line, what changed, and how it was verified.
- If reality disagrees with the prompt mid-way, stop and ask again rather than improvising.

## Question style

- Short questions, numbered, one idea each.
- Offer choices: "Is it (a) the page title at the top, or (b) the 'Monthly Trend' title inside the card?"
- Never ask something you can find in the repo yourself. Look first, then ask only what the code cannot tell you.
- Never ask more than is needed to remove real ambiguity, but never skip a question because the answer "seems obvious".
