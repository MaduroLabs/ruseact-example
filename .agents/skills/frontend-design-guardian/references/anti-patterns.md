# Anti-pattern review for Ruseact Example

Use this as a decision filter, not a universal style ban. A finding is valid
when the pattern makes the example less legible, less credible, less useful to
a developer evaluating an experimental framework, or less accessible.

## Reject unless justified

- Generic SaaS hero language or a hero that makes an experimental developer
  showcase look like a funded product launch.
- Repetitive card grids when a simple index, comparison, or narrative flow is
  clearer.
- Nested cards, excessive rounded containers, repeated badges, and decorative
  icon tiles that add chrome without hierarchy.
- Gradients, glows, glassmorphism, grid backgrounds, or animation used as
  decoration rather than to explain state, focus, or navigation.
- Oversized headings, excessive whitespace, cramped controls, low-contrast
  secondary text, or inconsistent type scales.
- Redundant explanatory copy that repeats the page title or hides the actual
  interaction.
- Meaningless motion, auto-playing effects, or motion that competes with the
  native interaction being demonstrated.

## Ruseact-specific checks

- Preserve visible distinctions between framework facts, experiment notes,
  controls, and observed browser behavior.
- Do not imply automatic scheduling, React compatibility, production
  readiness, or cross-browser guarantees.
- Do not hide a functional state behind CSS-only presentation when the example
  is intended to demonstrate structural rendering.
- Keep native focus indicators visible and do not restore focus manually just
  to satisfy a screenshot.
- Do not fabricate lifecycle, performance, or adoption metrics.

For each finding, record the affected surface, evidence, user impact, severity,
and the smallest safe remedy. If the pattern is intentional, document why in
the review rather than silently suppressing it.
