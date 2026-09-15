# NOTICE — MoRec

## License

MoRec is Copyright (C) 2026 Mo Rec Contributors, licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). The full license text is in [LICENSE.md](LICENSE.md).

## Modification notice (AGPLv3 §5(a))

MoRec is a modified version of the **Recordly** project.

- **Direct base:** Recordly — Copyright (C) 2026 webadderall, licensed under AGPLv3: <https://github.com/webadderallorg/Recordly>. Its full license text, including Recordly's additional terms, is preserved in [LICENSE.md](LICENSE.md).
- **Upstream origin:** Recordly itself started as a fork of the **OpenScreen** project — Copyright (c) 2025 Siddharth Vaddem, MIT License. The original MIT copyright and permission notice is preserved verbatim in Part 2 of [LICENSE.md](LICENSE.md), as the MIT License requires.
- **Modifications:** Copyright (C) 2026 Mo Rec Contributors. Modifications began **2026-08-19** and are ongoing; every commit to this repository after that date constitutes a modification of the original work, documented in the git history. All modified versions are released under the **AGPL-3.0-only**, as required by §5(c).
- **Recordly's additional license terms are honored:** the "Recordly" name and branding are not used (the project is branded MoRec), and Recordly is attributed both in this repository (here and in [README.md](README.md)) and in the application's user interface (launch menu, next to the version number).
- **Source offer:** this repository (<https://github.com/unfoldingdimensions/MoRec>) is the Complete Corresponding Source for every binary release published from it. For each tagged release (`v*`), the tag itself is the exact source the binaries were built from.

## Bundled third-party components (runtime dependencies)

| Component | License | Notes |
|-----------|---------|-------|
| ffmpeg-static | GPL-3.0-or-later | Ships a GPL build of the ffmpeg binary. Project source and build scripts: <https://github.com/eugeneware/ffmpeg-static> |
| ffprobe-static | MIT (package) | Bundles an ffprobe binary built from the same upstream ffmpeg sources; the binary's license follows that build |
| electron-updater | MIT | |
| uiohook-napi | MIT | Copyright (c) 2020 Alexander Drozdov |
| capturekit | MIT | |
| @phosphor-icons/react | MIT | Copyright (c) 2020 Phosphor Icons |
| mediabunny | MPL-2.0 | |

Build-time tooling (Vite, Vitest, Biome, TypeScript, React, Tailwind, Electron, electron-builder, and other `devDependencies`) is not distributed to end users; its licenses apply to the development toolchain only.

## Distribution requirements (maintainer checklist)

- Publishing a release (installer / DMG / AppImage) is **conveying** under AGPLv3 §6: keep this repository public, tag the exact source of each release, and ship `LICENSE.md` and `NOTICE.md` with the binary artifacts.
- The bundled ffmpeg binary carries its own GPL source obligation: keep ffmpeg-static's license text alongside the artifacts and keep the upstream source link above valid.
- If MoRec is ever operated as a hosted/network service offered to other people, AGPLv3 §13 (remote network interaction) requires offering those users the Corresponding Source of the version running there.
