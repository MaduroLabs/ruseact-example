# Screenshot-based visual review

## Capture protocol

1. Run the documented consumer build/server without changing application code
   for a critique-only task.
2. Capture the landing page and representative application surfaces at a
   desktop viewport and a mobile viewport. Include the first viewport and the
   key interactive state when relevant.
3. Record browser/version, viewport dimensions, route, build mode, and whether
   the screenshot is from a local or deployed page.
4. Inspect the actual pixels: hierarchy, alignment, density, contrast, focus,
   copy rhythm, responsive overflow, and whether the intended Ruseact behavior
   is visually understandable.

## Independent critique format

For each finding include:

- severity: blocker, high, medium, or polish;
- screenshot and region;
- observed evidence;
- user/developer impact;
- safe recommendation;
- whether it requires human direction approval.

Review before reading an implementation summary when possible. A screenshot
can reveal hierarchy and responsive failures that source review misses.

## Impeccable pass

Run the installed Impeccable command appropriate to the stage:

```sh
.agents/skills/impeccable/scripts/impeccable critique <target>
.agents/skills/impeccable/scripts/impeccable audit <target>
.agents/skills/impeccable/scripts/impeccable detect <target>
```

Use `critique` for design judgment, `audit` for technical quality, and
`detect` for deterministic anti-pattern evidence. A detector finding is not an
approval decision. Reconcile false positives with a narrow, documented reason;
do not broadly suppress rules to obtain a clean result.

After any approved refinement, recapture both viewport classes and inspect the
new images. Keep review captures ignored unless the task explicitly requires
durable visual evidence.
