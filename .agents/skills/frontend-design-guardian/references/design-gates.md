# Design quality gates

## Planning gate

- Product purpose, audience, task, and constraints are written in
  `PRODUCT.md`.
- Existing design truth and the proposed direction are written in `DESIGN.md`.
- Real references and anti-pattern decisions are recorded.
- A major redesign is explicitly marked `awaiting human approval` until the
  owner approves it.

## Implementation gate

- Scope is limited to the approved surface and does not change framework
  semantics, package artifacts, or test contracts.
- Native semantics, keyboard access, focus-visible styling, contrast, and
  responsive behavior are checked.
- No generic visual scaffolding, hidden test instrumentation, fabricated
  metrics, or unsupported claims were added.

## Evidence gate

- The actual app ran successfully.
- Desktop and mobile screenshots were captured and inspected.
- An independent critique was completed.
- Impeccable critique/audit/detect results were reviewed, not blindly obeyed.
- Remaining findings and browser limitations are reported.

## Publication gate

- Human approval is recorded for major visual direction changes.
- Documentation and source links are accurate.
- `git diff --check` passes.
- The complete diff contains no secrets, generated runtime state, or
  unrelated UI changes.
- The PR states the screenshot environment, visual findings, limitations, and
  approval status. A build passing alone is insufficient.
