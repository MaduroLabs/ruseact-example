# Frontend Design Guardian V2 review

Status: policy and evidence work only. No production application files, UI
styles, content, assets, prototypes, or design direction were changed. The
three existing directions remain unapproved and require human review.

## Scope and evidence

The review used the preserved prototype HTML and screenshots under
/tmp/ruseact-playground-directions/:

| Prototype | Desktop screenshot | Mobile screenshot |
|---|---|---|
| Tracebench | tracebench-desktop.png/1440x900.png | tracebench-mobile/390x844.png |
| Field Guide | fieldguide-shots/1440x900.png | fieldguide-mobile/390x844.png |
| Signal Atlas | atlas-shots/1440x900.png | atlas-mobile/390x844.png |

The PNGs were inspected directly before reading the concept pitches. The
corresponding HTML was then inspected for semantic structure and computed
styles. The comparison page previously created in /tmp was not copied into the
repository.

Browser evidence:

- Chromium 154.0.8037.57 on the InstaBox Linux environment.
- Desktop review target: 1440x900.
- Existing mobile screenshots: 390x844 and treated as the authoritative mobile
  visual evidence.
- Static fixture audits use a temporary instrumented file and Chromium's DOM
  dump because this environment blocks browser-to-localhost networking.
- The audit now also supports served application routes through Chromium CDP.
  The authoritative mounted Ruseact route is exercised in hosted CI, where the
  local HTTP server is reachable from Chromium.
- Headless Chromium enforces a 500px minimum CSS viewport for the local static
  audit; the mobile fixture therefore observed 500x701 for a requested 390x844.
  The report preserves both requested and observed values instead of replacing
  the observation. Exact 390x844 prototype conclusions below are supported by
  the captured screenshots and source inspection, not misrepresented as local
  390px computed-style output.

The critique is marked DEGRADED: single-context: independent sub-agents were
not explicitly authorized. Human approval remains required.

## Research synthesis

The catalog distinguishes evidence rather than presenting taste as science.

- E1 established system/usability guidance: IBM Type basics, Fluent 2
  typography, USWDS typography, and Automattic's AI-assisted content guidance.
  These support hierarchy, readable measure, line-height, semantics, contrast,
  familiar type ramps, sentence-case copy, and removing redundant text.
- E2 practitioner/tool methodology: Impeccable's slop catalog, Adrian Krebs's
  computed-style experiment, and design-slop-cop. These support repeatable
  inspection of DOM/style patterns, not universal judgments.
- E3 community observation: Slop Patterns, Reddit discussions, and Hacker News
  discussions. These identify recurring perceived tells such as arbitrary
  numbering, all-caps eyebrows, decorative dots, gradients, repeated cards,
  and generic templates; they are subjective hypotheses.
- E4 project policy: the owner requirements in this task. Sentence case,
  restrained emphasis, direct copy, no invented metrics, explicit exceptions,
  and human approval are binding for Ruseact Example.

Sources:

- https://impeccable.style/slop/
- https://www.adriankrebs.ch/blog/design-slop/
- https://github.com/AdrianKrebs/design-slop-cop
- https://sloppatterns.com/
- https://www.ibm.com/design/language/typography/type-basics/
- https://fluent2.microsoft.design/typography/
- https://designsystem.digital.gov/components/typography/
- https://system.automattic.design/ai/how-to-write-effective-content-with-ai-assistance/
- https://www.reddit.com/r/webdesign/comments/1s2x4pi/what_in_your_opinion_makes_ai_design_look_like_ai/
- https://www.reddit.com/r/UI_Design/comments/1sf3xmh/ai_slop_unsloped/
- https://www.reddit.com/r/webdesign/comments/1j9vcj0/preventing_the_ai_slop_look/
- https://www.reddit.com/r/UI_Design/comments/1s6k2qq/question_about_websites_looking_like_ai_slop/
- https://news.ycombinator.com/item?id=48821493
- https://news.ycombinator.com/item?id=50576012
- https://news.ycombinator.com/item?id=49901973

The detailed source classification is in
.agents/skills/frontend-design-guardian/references/research-sources.md.

## Policy changes

The custom guardian now includes stable IDs and evidence labels for:

- typography, weight, casing, tracking, line-height, heading hierarchy, and
  text density;
- UX writing, information architecture, layout, spacing, cards/containers,
  borders/radii/shadows, color/contrast, badges, icons, navigation, controls,
  motion, imagery, responsiveness, and accessibility;
- generic template composition, decorative metrics, and second-order patterns.

Every rule records the harm hypothesis, bad example, better alternative,
exceptions, detection method, severity, and evidence quality. The policy
explicitly allows justified technical acronyms, code, identifiers, real
sequences, meaningful status, established branding, and accessible technical
surfaces.

Typography defaults are documented as project proposals, not universal laws:

- Body 15–16px/400.
- Labels 13–14px/400–500.
- Buttons 14px/500.
- Section headings 18–20px/500–600.
- Page headings 26–32px/500–600.
- Secondary metadata 12–13px/400.

The policy requires sentence case, restrained heading emphasis, no bold
paragraphs, no arbitrary highlighted words, no tracked uppercase micro-labels,
no decorative numbering, no excessive negative tracking, and no monospace for
ordinary prose/navigation without a technical rationale.

Copy rules reject unsupported marketing vocabulary, redundant descriptions,
forced slogans, decorative labels, and invented metrics. The preferred form is
direct functional language such as Preview, Source, and Runtime state.

## Audit implementation and tests

Added or corrected:

- .agents/skills/frontend-design-guardian/scripts/audit-design.mjs
- .agents/skills/frontend-design-guardian/scripts/test-audit-design.mjs
- .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
- .agents/skills/frontend-design-guardian/fixtures/design-audit/positive.html
- .agents/skills/frontend-design-guardian/fixtures/design-audit/negative.html
- focused uppercase, semantic typography, contrast, overflow, and viewport
  regression fixtures

The audit uses installed Chromium and no new dependency. Static mode uses a
temporary instrumented copy; served mode uses CDP against an actual initialized
route. Served mode requires a declared ready text and expression, a mounted
`#app`, at least one stylesheet, no failed resource entries, and no application
error marker. It collects visible direct text runs, semantic headings and
controls, role-aware font family/size/weight, casing, tracking, line-height,
solid-color contrast, border radii, shadows, repeated text, element rectangles,
and viewport cropping. It excludes hidden elements and code/pre blocks. The
uppercase classifier excludes contextual technical identifiers rather than all
single-word uppercase labels. Ambiguous color alpha, gradients, disabled states,
and unsupported backgrounds are manual-review observations; intentional
accessible scroll containers are not treated as document overflow. It emits
exact element evidence and separates ERROR, WARNING, and OBSERVATION categories.

The thresholds and role rules are documented in the tool output as proposed
project heuristics:

- ERROR for any ordinary body, metadata, navigation, label, or control run at
  weight 700 or more; headings and semantic emphasis are contextual exceptions.
- WARNING for repeated semibold body text and heavy navigation; this is role-
  aware rather than a page-wide 75% threshold.
- WARNING for one ordinary uppercase run and ERROR for repeated or tracked
  ordinary uppercase runs.
- WARNING for headings at least 56px.
- ERROR for named non-disabled controls below 12px or measurable contrast below
  4.5:1 (3:1 for large text); ambiguous contrast is manual review.
- ERROR for document or visible-element horizontal cropping outside an
  intentional scroll container.

These thresholds are not accessibility law and do not replace review.

Fixture commands and results:

~~~sh
node .agents/skills/frontend-design-guardian/scripts/test-audit-design.mjs
~~~

`node .agents/skills/frontend-design-guardian/scripts/test-audit-design.mjs`
passes. The positive fixture produced zero errors. The negative fixture
produced the expected findings, including TYPO-01, TYPO-03, TYPO-04, TYPO-05,
LAY-03, COPY-01, COPY-02, A11Y-01, and COLOR-01. Focused fixtures pass for
ordinary single-word uppercase labels (literal and CSS-transformed), technical
acronym exclusions, bold body text, repeated semibold body text, heavy
navigation, tracked uppercase labels, eyebrow headings, monospace prose,
ambiguous/large-text contrast, intentional scroll containers, and mismatched
viewport metadata. A technical Uint32Array identifier did not produce a false
uppercase finding.

The served application check is:

```sh
corepack pnpm build:test
node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs
```

It audits the actual `dist-test/hello.html` route after the Hello World app
reports `window.__ruseactAuditMount`. It verifies the response served styles,
the mount marker, `#app`, no failed asset entries, visible content, and exact
1440x900 CDP viewport evidence. The same deterministic checks run after
Chromium installation in hosted CI; the local result is recorded below after
execution.

Local served-route result:

- `corepack pnpm build:test` completed and produced the instrumented Vite
  assets, including the Rust WASM module.
- `node .agents/skills/frontend-design-guardian/scripts/test-audit-app.mjs`
  passed against the actual `/hello.html` route in Chromium 154.0.8037.57.
- Both requested viewports, 1440x900 and 390x844, matched their observed CSS
  viewports at device-pixel ratio 1. Each run returned one stylesheet, no
  failed asset entries, a live `#app`, visible Hello World content, and
  `window.__ruseactAuditMount`. This is a real mounted application audit, not
  an HTML copy audit.
- Hosted PR validation run `46046001634` also passed on `ubuntu-latest` with
  Google Chrome 158.0.8127.88. Its `Run design audit regression tests` and
  `Audit mounted Ruseact page` steps both completed successfully, alongside
  the existing consumer browser verification. This confirms that the browser
  reached the served route in the network environment used for CI.
- The same command is a required hosted-CI check because the InstaBox browser
  cannot reach its local HTTP server reliably; the hosted job is the
  authoritative browser-network verification.

## Impeccable detector results

The installed Impeccable detector was run separately against each prototype
HTML file:

- Tracebench: exit 0, empty result.
- Field Guide: exit 2 with advisory low-contrast findings, extreme-negative-
  tracking, tight-leading, and cream-palette findings.
- Signal Atlas: exit 2 with advisory low-contrast, extreme-negative-tracking,
  tight-leading, and cream-palette findings.

Tracebench's empty detector result is not an approval. The project audit and
rendered screenshots still found policy and responsive issues.

## Prototype findings

### Tracebench

Desktop screenshot target 1440x900; corrected static-audit request observed
1440x757 locally:

- 29 visible text runs, 9 uppercase runs, and 2 bold runs.
- The h1 Tracebench is 56px/600 with -2.8px tracking and 53.2px line-height.
- Nine ordinary interface labels use uppercase or uppercase transformation,
  including RUSEACT / PLAYGROUND, alpha.1 · manual runtime, Experiments,
  PLAYGROUND / COUNTER, source / App.tsx, compiled, native output, live, and
  scalar signal / explicit flush.
- The page uses ui-monospace for most navigation, labels, code-adjacent copy,
  and body-like metadata. Contrast was measurable and strong for sampled
  controls; the issue is hierarchy and readability context, not automatically
  an accessibility failure.
- Corrected role-aware audit findings include TYPO-01 on the uppercase brand
  run, TYPO-05 on ordinary labels, TYPO-07 on mono navigation/metadata, TYPO-03
  on the 56px heading, and TYPO-04 on its negative tracking. The repeated
  uppercase treatment is now reported per evidence run rather than only through
  an aggregate page threshold.

Mobile screenshot evidence is 390x844; corrected static-audit request observed
500x701 locally:

- The captured 390x844 screenshot shows the horizontal experiment navigation
  cropped on the right.
- The audit found RESP-01 on the nav: the visible nav rect was wider than the
  observed mobile viewport and the 05 Hello item extended beyond it.
- The h1 reduces to 28px/600 with -1.4px tracking, so the main concern is not
  mobile headline size but the mono/uppercase treatment and navigation access.

Independent critique:

- The terminal style is coherent, but it is a second-order risk when mono is
  applied to nearly every text role rather than reserved for code/data.
- The 03 counter and metadata rows add instrumentation-like emphasis; their
  purpose should be verified rather than assumed.
- Impeccable's clean result demonstrates why detector cleanliness cannot be the
  project gate.

### Field Guide

Desktop screenshot target 1440x900; corrected static-audit request observed
1440x757 locally:

- 24 visible text runs, 4 uppercase runs, 5 bold runs, and 3 headings.
- The page heading See the update, not the machinery. is 86px/700 with
  -6.88px tracking and 77.4px line-height.
- Five studies is a 12px heading with 1.8px tracking; Study 01 / signals and
  the experimental-alpha label use similar tracked micro-label treatment.
- The nav controls 02 Conditional, 03 Todo, and 04 Reorder measured at 4.16:1
  against the page background, triggering the project audit COLOR-01 and
  matching Impeccable's low-contrast advisory.
- Corrected role-aware audit findings add TYPO-01 for the heavy brand/nav runs,
  TYPO-08 for repeated heavy navigation, TYPO-05 for ordinary tracked labels,
  TYPO-07 for the monospace source link, TYPO-03/04 for the heading, and
  COLOR-01 for the measurable low-contrast text/state cases.

Mobile screenshot evidence is 390x844; corrected static-audit request observed
500x701 locally:

- The captured 390x844 screenshot shows the long horizontal navigation cropped.
- The audit found RESP-01: the nav rect exceeded the observed mobile viewport
  and the 05 Hello item extended beyond it.
- The mobile h1 is 42px/700 with -3.36px tracking and 37.8px line-height.

Independent critique:

- The beige editorial composition, very large heavy headline, tracked labels,
  and numbered Study 01 treatment form the exact second-order combination the
  policy asks to question for a technical runtime guide.
- Five studies and What to notice add editorial framing, but the review should
  verify that each label helps a developer choose or understand a study.
- This is a contextual quality finding, not a claim that beige or editorial
  composition is universally wrong.

### Signal Atlas

Desktop screenshot target 1440x900; corrected static-audit request observed
1440x757 locally:

- 27 visible text runs, 6 uppercase runs, 11 bold runs, and 2 headings.
- The h1 Read the signal path. is 129.6px/900 with -14.256px tracking and
  101.088px line-height.
- The navigation uses repeated 01 / Counter through 05 / Hello markers. The
  project audit records LAY-03 because the numbers are not presented as a
  semantic ordered list or explicit step sequence.
- Impeccable measured 2.8:1 orange text on the cream background for one text
  case. The corrected custom audit also records COLOR-01 for the measurable
  `R` text, while retaining manual review for unsupported color configurations.
- Corrected role-aware audit findings add TYPO-01 for heavy navigation, TYPO-08
  for repeated heavy navigation, TYPO-05 for ordinary uppercase labels,
  TYPO-07 for mono navigation, TYPO-03/04 for the heading, and LAY-03 for the
  decorative numbered navigation.

Mobile screenshot evidence is 390x844; corrected static-audit request observed
500x701 locally:

- The captured 390x844 screenshot shows the map navigation extending beyond the
  viewport and the title wrapping under very tight tracking.
- The audit found RESP-01 on visible navigation items beyond the observed
  viewport; the 04 and 05 items extend past the right edge.
- The h1 is 48px/900 with -5.28px tracking and 37.44px line-height.

Independent critique:

- The atlas/Swiss/technical treatment is deliberate-looking, but thick borders,
  giant numerals, uppercase metadata, and loud accent colors need a product
  rationale rather than serving as generic atmosphere.
- The decorative 01 marker and oversized 03 output can compete with the actual
  signal task.
- The combination is a second-order warning, not a prohibition on grids,
  technical palettes, or accent colors.

## Limitations and next gate

- The audit is deterministic and evidence-bearing, but it cannot establish
  intention, usefulness, brand fit, or whether a metric is truthful.
- The local headless browser cannot expose exact 390px computed styles because
  of its 500px minimum viewport. Exact mobile screenshots were reviewed
  directly; a CI/browser harness with viewport emulation should be used before
  treating mobile computed values as final.
- The Impeccable detector was run; a full Impeccable critique was not substituted
  for human review. The critique is DEGRADED: single-context.
- No prototype is accepted, rejected, or redesigned by this task. The next step
  is owner review of this evidence and an explicit direction decision.
