---
name: frontend-design-guardian
description: Govern Ruseact consumer UI design work with deliberate art direction, anti-slop checks, real browser screenshots, Impeccable critique/audit/polish, and explicit human approval before visual redesigns.
---

# Frontend Design Guardian

Use this skill for UI design, frontend implementation, landing pages,
application interfaces, visual redesigns, or visual review in
`MaduroLabs/ruseact-example`. It is a quality workflow around the installed
`impeccable` skill, not a replacement for its design vocabulary.

## Non-negotiable boundaries

- Read `PRODUCT.md`, `DESIGN.md`, `README.md`, `AGENTS.md`, and the relevant
  existing page/source before proposing direction.
- Preserve application behavior, Ruseact contracts, accessibility, and the
  experimental status. Do not modify framework source or package artifacts.
- Do not make a major visual redesign, replace factual copy, add brand claims,
  or introduce dependencies without explicit human approval of the direction.
- A successful build, detector scan, or score is not visual approval. Human
  review of rendered screenshots remains the final gate.
- For critique-only requests, do not edit UI code, CSS, content, assets, or
  framework files.

## Required workflow

1. Understand the product, audience, user task, surface mode, and constraints.
   Record uncertainties rather than inventing positioning.
2. Inspect existing source, documentation, live behavior, and current visual
   system. Identify anti-patterns using
   [references/anti-patterns.md](references/anti-patterns.md).
3. Research a small set of relevant real-world references. Explain what each
   reference contributes and avoid copying a competitor's identity. Use
   [references/art-direction.md](references/art-direction.md) to form one
   coherent direction with a clear hierarchy, type, color, spacing, and layout
   system.
4. Present the proposed direction and approval boundary. Mark
   `DESIGN.md` as awaiting human approval for a redesign; refinement within an
   already approved system may proceed only when the request authorizes it.
5. Use Impeccable for the requested review stage:
   - `$impeccable critique <target>` for visual/UX critique;
   - `$impeccable audit <target>` for accessibility, responsive, and technical
     quality checks; and
   - `$impeccable polish <target>` only after direction is approved and the
     implementation exists.
   Read the matching installed Impeccable reference before invoking a command.
6. Implement only the approved scope. Keep changes product-specific; reject
   template-like composition, decorative effects without a job, and generic
   marketing language.
7. Run the actual application and capture inspected screenshots at a desktop
   and mobile viewport. Store review-only captures under the ignored
   `.impeccable/review/` convention when available; never claim screenshot
   review from source inspection alone.
8. Perform an independent critique after implementation, then run Impeccable
   detection/audit and reconcile findings. Detector output is advisory and
   cannot override human judgment. Use
   [references/visual-review.md](references/visual-review.md).
9. Refine only issues supported by the evidence. Re-capture desktop and mobile
   screenshots and inspect them before publication.
10. Before opening a PR, complete the gates in
    [references/design-gates.md](references/design-gates.md), including human
    approval for a major redesign and `git diff --check`.

## Writing and anti-slop standards

Use [references/copywriting.md](references/copywriting.md) for concise,
truthful interface language. Use [references/anti-patterns.md](references/anti-patterns.md)
to reject generic SaaS heroes, repetitive card grids, nested cards, decorative
gradients/glows, excessive pills or badges, oversized headings, low contrast,
meaningless animation, and redundant explanation when they do not serve this
product. These are contextual warnings, not universal bans.

## Impeccable trust boundary

The project installation is reviewed and checksum-aware, but its optional
hook executes a local engine with the agent's environment and network access.
Do not approve or enable provider hooks automatically. If a hook is requested,
inspect its manifest, command, timeout, scope, and trust requirements first;
then obtain explicit approval. Manual `$impeccable critique`, `$impeccable audit`,
and `$impeccable polish` invocations are preferred for this repository's review
workflow.

## Deliverable evidence

Report the actual skill version/provenance, references used, approval state,
browser/viewport environment, screenshot paths, critique findings, detector
results, remaining limitations, and whether UI code changed. Never report a
design as passed without inspected rendered screenshots and human approval.
