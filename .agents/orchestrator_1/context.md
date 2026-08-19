# MoRec Audit Context

## Application Overview
- **App Name**: MoRec
- **Domain**: Desktop screen recording and video editing application.
- **Stack**: Electron, React, TypeScript, Tailwind CSS, Biome.
- **Root Directory**: `e:\New-Personal-Projects\MoRec`

## Audit Focus Areas
1. **R1: UI/UX, Design Consistency & Interaction Review**
   - Recording Launcher/Overlay, Countdown, Video Editor workspace, Timeline & Scrubbing, Canvas preview, Settings Panels, Shortcuts Config, Export Dialogs, responsive sizing, theme/contrast, z-index, accessibility, interaction polish.
2. **R2: Core Logic, State Management & IPC Bug Audit**
   - React hooks/state across VideoEditor, VideoPlayback, timeline/, projectPersistence, audio/, Electron IPC handlers, media recording/trimming/speed scaling/export pipeline edge cases, race conditions, memory leaks.
3. **R3: Dead Code, Unused Assets & Code Duplication Detection**
   - Unused components, dead functions, unreachable branches, obsolete types, duplicated utilities/math/configs, orphaned CSS/assets/dependencies.
4. **R4: Read-Only Production Readiness Report**
   - Exhaustive markdown report documenting findings with Category, Severity [Blocker/Critical/Major/Minor/Suggestion], exact file links `file:///...`, line numbers, Root Cause & Impact, Recommended Fix, and Executive Summary.

## Operational Constraints
- STRICT READ-ONLY: ZERO code modifications or file deletions.
- All code inspection done by delegated subagents.
