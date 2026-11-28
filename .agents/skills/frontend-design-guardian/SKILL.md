---
name: frontend-design-guardian
description: Review Ruseact consumer interfaces with evidence-based anti-slop heuristics, typography and copy gates, computed-style audits, real-browser screenshots, and human approval.
---

# Frontend Design Guardian

Use this skill for design review, frontend implementation, visual QA, and
quality-policy work in `MaduroLabs/ruseact-example`. It complements the
installed Impeccable skill; it does not replace it or approve a visual
direction on its own.

## Scope and trust boundary

- Read `PRODUCT.md`, `DESIGN.md`, `README.md`, `AGENTS.md`, and the relevant
  source before proposing or judging a change.
- Preserve the experimental product boundary. Do not claim React compatibility,
  performance superiority, or general browser support without evidence.
- For critique-only or policy-only work, do not edit application UI, CSS,
  content, assets, framework packages, or approved prototype artifacts.
- Preserve the upstream `.agents/skills/impeccable` skill unmodified.
- Hooks and provider integrations stay disabled unless the owner explicitly
  authorizes them. The audit script is a local, deterministic helper, not a
  privileged hook.
- A detector result, build, screenshot, or named concept is evidence—not human
  design approval.

## Required review gates

Every substantive UI review must include, as applicable:

1. Product/task and information-architecture review.
2. Separate typography review using [references/typography-policy.md](references/typography-policy.md).
3. Separate copywriting review using [references/copywriting.md](references/copywriting.md).
4. Visual hierarchy, layout, and responsive review using [references/visual-hierarchy.md](references/visual-hierarchy.md).
5. Accessibility and control-usability review.
6. Real browser screenshots at desktop and mobile sizes.
7. The computed-style audit in `scripts/audit-design.mjs` when a page can be
   served or loaded in a browser.
8. Impeccable detection/audit where the installed skill supports it.
9. Independent critique, including explicit second-order anti-slop review.
10. Human approval before a new visual direction is implemented or accepted.

Use [references/design-gates.md](references/design-gates.md) for the evidence
record. If independent sub-agents are not explicitly authorized, label the
critique `DEGRADED: single-context` rather than implying independent review.

## Review method

1. Establish the user task, audience, surface, and approval boundary.
2. Inspect actual source and rendered screenshots; do not infer a visual result
   from source alone.
3. Classify findings as `ERROR`, `WARNING`, or `OBSERVATION`. An aesthetic
   heuristic is not automatically an accessibility defect.
4. Run the project audit. It reports visible text runs, semantic elements,
   computed styles, measurable contrast, repeated structures, and responsive
   overflow. It deliberately excludes hidden text, code blocks, and contextual
   technical identifiers from casing heuristics. Ambiguous contrast and
   intentional scroll regions are reported for manual review rather than
   treated as objective failures.
5. Run Impeccable's detector separately. Treat its result as advisory and
   reconcile it with screenshots, task clarity, and human judgment.
6. Review second-order patterns: a style can be valid in isolation and still
   become slop when repeated mechanically without a product reason.
7. Record exact elements or screenshot regions, evidence quality, exceptions,
   and remaining subjective concerns.
8. Do not redesign a page merely to make a detector score better.

## Reproducible audit

From the repository root:

```sh
node .agents/skills/frontend-design-guardian/scripts/audit-design.mjs \
  --json --viewport=1440x900 path/to/page.html
node .agents/skills/frontend-design-guardian/scripts/test-audit-design.mjs
```

Static mode loads a temporary instrumented copy in installed Chromium and
emits findings plus element evidence. It is intentionally small and
dependency-free, and preserves static-fixture support even when browser-to-
localhost networking is blocked. For an initialized application, audit the
served route instead of copying its HTML:

```sh
corepack pnpm build:test
node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
# The low-level command below assumes dist-test is already served on port 4173:
corepack pnpm exec vite preview --outDir dist-test --host 127.0.0.1 --port 4173 --strictPort
node .agents/skills/frontend-design-guardian/scripts/audit-design.mjs \
  --json --viewport=1440x900 \
  --url=http://127.0.0.1:4173/hello.html?benchmark=1\&design-audit=1 \
  --ready-text="Hello, world!" \
  --ready-expression='Boolean(window.__ruseactAuditMount)'
```

The instrumented command must use `build:test` and the benchmark query because
the mount marker is intentionally excluded from the public build. For public
application auditing, use the application content as readiness evidence rather
than a test-only global:

```sh
corepack pnpm build
# Serve dist on port 4173 in another shell before using the low-level command:
corepack pnpm exec vite preview --outDir dist --host 127.0.0.1 --port 4173 --strictPort
RUSEACT_AUDIT_DIST=dist \
RUSEACT_AUDIT_QUERY= \
RUSEACT_AUDIT_READY_TEXT="Hello, world!" \
RUSEACT_AUDIT_READY_EXPRESSION='Boolean(document.querySelector("#app")?.textContent?.includes("Hello, world!"))' \
node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
```

`test-audit-app.mjs` serves the selected `dist` or `dist-test` directory and
audits both 1440x900 and 390x844. The served audit reports a mount based on
non-empty `#app` content; the instrumented marker remains an additional
readiness assertion, not the public application contract.

Served mode uses Chromium CDP device metrics override, waits for the declared
application-ready state, and fails closed when the mount marker, application
container, stylesheets, or asset loading evidence is incomplete. It reports
`requestedViewport`, `observedViewport` (including `devicePixelRatio`), and
`viewportMatched` separately. Use a second invocation at `390x844` for mobile
review; if the observed CSS viewport differs, report the mismatch rather than
claiming exact mobile measurements. Output is review evidence and should remain
outside commits unless the task calls for a report artifact.

The audit's typography findings are role-aware: body, navigation, labels,
metadata, controls, headings, and semantic emphasis are reviewed separately.
Text runs inherit that context through nested inline ancestors, so a span inside
a paragraph, link, button, label, or semantic emphasis element is not treated
as an unrelated `other` role.
Uppercase classification is contextual, so ordinary single-word labels can be
flagged while legitimate acronyms, code symbols, version strings, and
technical keys remain exceptions. Solid opaque contrast is measured for every
text role, including metadata; alpha, gradients, ancestor opacity, disabled
states, and unsupported backgrounds are manual-review observations.
Document-level overflow is separated from intentional accessible scroll
containers.

Run Impeccable after the page is available:

```sh
.agents/skills/impeccable/scripts/impeccable context
.agents/skills/impeccable/scripts/impeccable detect --json path/to/page.html
```

The context command is session setup; it does not enable hooks. The installed
Impeccable references remain authoritative for its own commands.

## Anti-slop policy

Use the expanded, evidence-labelled catalog in
[references/anti-patterns.md](references/anti-patterns.md), the typography
defaults in [references/typography-policy.md](references/typography-policy.md),
and the second-order review in
[references/second-order-slop.md](references/second-order-slop.md). These are
project defaults and review heuristics, not universal bans. Valid exceptions
must state the user need, accessibility rationale, product convention, or
technical reason.

## Deliverable evidence

Report the skill version/provenance, sources and evidence quality, browser and
viewport, screenshot paths, audit/detector commands and results, exact findings,
limitations, approval status, and whether production UI changed. For critique
or policy work, explicitly say that no design direction was approved.
