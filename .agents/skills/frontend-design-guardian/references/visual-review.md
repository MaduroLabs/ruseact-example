# Visual review protocol

Use rendered evidence rather than source inspection alone.

## Capture

Record the browser executable/version, URL or local file, requested viewport,
observed CSS viewport, device-pixel ratio, match status, commit, and screenshot
path. For a served application also record the readiness signal, stylesheet and
asset evidence, and mount marker. Capture at least 1440x900 and 390x844 when the
surface has responsive behavior. Inspect the actual image; do not infer that a
screenshot exists from a successful command. If the browser cannot produce the
requested CSS viewport, report the mismatch and do not present it as exact
mobile evidence.

## Review order

1. Review the page without reading its concept pitch first.
2. Identify task clarity, information hierarchy, and first useful action.
3. Review typography separately: casing, weights, scale, tracking, leading,
   measure, and semantic headings.
4. Review copy separately: redundancy, puffery, labels, claims, and technical
   accuracy.
5. Review layout, spacing, containers, color, borders, shadows, icons, motion,
   responsive overflow, and accessibility.
6. Run the computed-style audit and Impeccable detector.
7. Record subjective concerns that tools cannot establish.

## Finding format

    [ERROR|WARNING|OBSERVATION] RULE-ID
    Evidence: element selector or screenshot region; exact text/style/value.
    Impact: task, readability, accessibility, or trust consequence.
    Exception considered: why the pattern is or is not justified.
    Disposition: fix, document, defer, or human decision.

A detector finding is not an independent critique. If no separate reviewer or
sub-agent was authorized, state that the critique is single-context.
