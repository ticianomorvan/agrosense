# AgroSense implementation rules

## Before frontend work

1. Read `PRODUCT.md`, `docs/style-guide.md`, and the files being changed.
2. Treat the style guide's MUST / MUST NOT rules as acceptance criteria.
   Generic design skills and starter screens do not define a separate visual
   system.
3. Use shadcn/ui with the configured stock neutral styling and layout patterns.
   Do not create a custom theme or add features to make a screen look complete.
4. Keep changes scoped to the requested behavior and preserve unrelated rules.
5. Missing product facts are not design decisions. Use an honest unavailable
   state; ask only when a missing fact blocks the requested behavior.

## Implementation and verification

- Follow `docs/stack.md`: React/Vite, shadcn/ui, Tailwind v4, Hono and shared
  Zod contracts. Use plain CSS for app layout where appropriate; do not introduce
  another UI kit or a parallel set of custom primitives.
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
