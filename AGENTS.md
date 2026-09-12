# AgroSense implementation rules

## Before frontend work

1. Read `PRODUCT.md`, `docs/style-guide.md`, and the files being changed.
2. Treat the style guide's MUST / MUST NOT rules as acceptance criteria.
   Generic design skills, component-library defaults, and the starter screen
   are not permission to override them.
3. Use the fixed tokens and patterns. Do not invent a new visual system, reopen
   the design interview, or add features to make a screen look complete.
4. Explicit user instructions can override specific rules. Record the exception
   in the task summary; do not weaken unrelated rules to accommodate it.
5. Missing product facts are not design decisions. Use an honest unavailable
   state; ask only when a missing fact blocks the requested behavior.

## Implementation and verification

- Follow `docs/stack.md`: React/Vite, plain CSS, Hono, shared Zod contracts.
  Do not introduce a CSS framework or UI kit as part of styling work.
- Read `docs/domain-model.md` before implementation and verification.
- Read existing code before editing and preserve unrelated user changes.
- Implement only the requested slice. A map, action, or metric in the guide is
  not authorization to invent its API, data, or agronomic logic.
- For UI changes, complete the guide's acceptance checklist and run `pnpm check`.
  Report actual results, screenshot locations, and unverified checks. A build
  alone is not visual verification.
- For documentation-only changes, check consistency, links, and
  `git diff --check`; no application test run is required.
- Do not claim compliance for checks that were not performed. If browser
  verification is unavailable, name that limitation in the task summary.
