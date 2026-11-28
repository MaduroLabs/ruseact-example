# Research sources and evidence quality

Evidence labels used by the catalog:

- **E1 — established system/usability guidance:** accessibility, readability,
  hierarchy, semantics, and content guidance from maintained design systems.
- **E2 — practitioner/tool methodology:** documented heuristics or browser/DOM
  audit methods. Useful for repeatable review, not universal truth.
- **E3 — community observation:** designer discussion and recurring practical
  observations. Useful for hypothesis generation; subjective and often
  context-dependent.
- **E4 — project-owner policy:** explicit Ruseact Example requirements.

## Required sources

| Source | Contribution | Quality / caveat |
|---|---|---|
| [Impeccable: Slop](https://impeccable.style/slop/) | Separates detector findings from design-review patterns and catalogs recurring UI patterns such as card overload, redundant copy, decorative effects, and poor contrast. | E2. Maintainer guidance and heuristics; a finding requires context. |
| [Adrian Krebs: Design Slop](https://www.adriankrebs.ch/blog/design-slop/) | Reports a headless-browser/computed-style experiment and recurring practitioner patterns: centered generic heroes, all-caps labels, gradients, badges, identical cards, and arbitrary metrics. | E2. Author scoring experiment and observations, not an independent scientific study. |
| [design-slop-cop](https://github.com/AdrianKrebs/design-slop-cop) | Concrete open-source example of deterministic DOM/style checks. | E2. Tool methodology; thresholds and false positives require local validation. |
| [Slop Patterns](https://sloppatterns.com/) | Practitioner field guide for recognizing repeated AI-generated visual habits. | E3/E2. Curated aesthetic observations, not usability law. |
| [IBM Type basics](https://www.ibm.com/design/language/typography/type-basics/) | Typography hierarchy, consistency, tracking, alignment, leading, and case considerations. | E1. Design-system guidance; values are system-specific. |
| [Fluent 2 typography](https://fluent2.microsoft.design/typography/) | Semantic type ramps, hierarchy, and familiar system defaults. | E1. Product-system guidance; not a universal font prescription. |
| [USWDS typography](https://designsystem.digital.gov/components/typography/) | Readable measure, line-height, whitespace grouping, heading relationships, and cautions about long uppercase/bold text. | E1. Public-sector system guidance; recommendations still need context. |
| [Automattic: AI-assisted content](https://system.automattic.design/ai/how-to-write-effective-content-with-ai-assistance/) | Copy should earn its place; headings name things plainly, buttons name actions, and descriptions add information. | E1/E2. Editorial guidance rather than a controlled study. |

## Community discussions

| Discussion | Contribution | Quality / caveat |
|---|---|---|
| [Reddit: What makes AI design look like AI?](https://www.reddit.com/r/webdesign/comments/1s2x4pi/what_in_your_opinion_makes_ai_design_look_like_ai/) | Practitioners mention decorative dots, arbitrary numbering, icon containers, and purpose-free emphasis; replies stress task and intention. | E3. Recent informal discussion; preferences are not universal. |
| [Reddit: AI Slop UNSLOPED](https://www.reddit.com/r/UI_Design/comments/1sf3xmh/ai_slop_unsloped/) | Discusses huge type, mono labels, eyebrow headings, and casing patterns while noting subjectivity. | E3. Anecdotal design critique. |
| [Reddit: Preventing the AI slop look](https://www.reddit.com/r/webdesign/comments/1j9vcj0/preventing_the_ai_slop_look/) | Recurring combinations include purple gradients, accent-word typography, rounded corners, and animation; commenters raise accessibility and context. | E3. Practitioner observations, not a benchmark. |
| [Reddit: Websites looking like AI slop](https://www.reddit.com/r/UI_Design/comments/1s6k2qq/question_about_websites_looking_like_ai_slop/) | Frames slop as generic/thoughtless composition and inconsistency, not one isolated property. | E3. Subjective community discussion. |
| [HN: Scan any website for AI design patterns](https://news.ycombinator.com/item?id=48821493) | Community discussion of deterministic headless DOM/style audits and reported false positives. | E2/E3. Tool author/community report, not independently replicated. |
| [HN: Slopstrap](https://news.ycombinator.com/item?id=50576012) | Notes full-caps eyebrows, broken labels/spacing, and repetition as signals. | E3. Practitioner discussion. |
| [HN: vibe-coded website](https://news.ycombinator.com/item?id=49901973) | Reports gradients and em-dash-heavy copy as perceived tells. | E3. Anecdotal perception; not a universal rule. |

## Synthesis rule

E1 supports readability, semantics, contrast, and hierarchy checks. E2 supports
repeatable heuristics and audit mechanics. E3 supplies hypotheses and language
for contextual critique. E4 is binding for this project even when a pattern
would be acceptable elsewhere. No source supports the claim that a clean
detector result is design approval.
