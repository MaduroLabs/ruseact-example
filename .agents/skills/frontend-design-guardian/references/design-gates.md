# Design quality gates

## Before implementation or acceptance

- Read PRODUCT.md, DESIGN.md, README.md, AGENTS.md, and relevant source.
- State whether the request is implementation, critique, or policy work.
- Record the user task, audience, constraints, and whether a direction is
  approved. DESIGN.md remains AWAITING HUMAN APPROVAL for a new direction.
- Identify factual claims and the evidence needed to support them.

## During review

- Capture real browser screenshots at a named desktop and mobile viewport.
- Review typography, copywriting, hierarchy, accessibility, responsiveness, and
  second-order anti-slop separately.
- Run the computed-style audit and record exact element-level evidence.
- Run Impeccable detection/audit where applicable. Detector findings are
  advisory; a clean result is not approval.
- Record ERROR, WARNING, and OBSERVATION separately.
- If independent sub-agents were not authorized, label the critique as
  DEGRADED: single-context.

## Before publication

- No unapproved production UI, framework, package, or dependency changes.
- Root README updated for implementation tasks; policy/critique work must state
  why the README update is relevant or why no product UI changed.
- git diff --check and applicable consumer checks pass.
- Reports include commands actually run, screenshot paths, environment, and
  known limitations.
- Human approval is required for a new visual direction, design acceptance, or
  deployment. Codex does not merge or auto-deploy.
