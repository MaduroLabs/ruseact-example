# Ruseact consumer repository instructions

This repository is the independent consumer bootstrap for `MaduroLabs/ruseact`.

- Use only the reviewed, checksum-pinned Ruseact tarballs under `artifacts/`.
- The framework source repository is separate; do not modify framework internals here.
- Feature branches target `main` and require a reviewed pull request.
- Do not merge automatically, publish packages, deploy the examples, or create tags.
- Preserve Ruseact's explicit signal dependencies and manual `root.flush()` contract.
- Unsupported TSX syntax must be reported as a limitation, not emulated with another JSX transform.
- Run artifact verification, compilation, typechecking, production build, and browser tests before handoff.
- Keep artifact provenance and checksums synchronized with any intentional artifact replacement.

## Frontend design quality workflow

Tasks involving UI design, frontend implementation, visual redesign, landing
pages, application interfaces, or visual review must use the project-scoped
`$frontend-design-guardian` skill as the primary workflow and `$impeccable` as
the design critique, audit, and refinement layer.

Before implementation, read `PRODUCT.md`, `DESIGN.md`, the relevant page and
source, and the skill references. Inspect the existing interface, research
relevant real-world references, and establish a coherent art direction. Major
visual redesigns require explicit human approval before UI code changes.

After implementation, run the actual application, capture and inspect desktop
and mobile screenshots, perform an independent visual critique, and use
Impeccable's `critique`, `audit`, and `polish` capabilities as appropriate.
Build success or detector output alone is not visual approval. Record the
browser environment, screenshot evidence, findings, and remaining limitations
in the PR.

For critique-only tasks, do not modify application UI, content, assets,
framework code, or package artifacts. Do not automatically approve or enable
Impeccable provider hooks; inspect their commands and trust boundary first.

The package set is experimental and private. It is not an npm installation source.
