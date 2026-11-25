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

The package set is experimental and private. It is not an npm installation source.
