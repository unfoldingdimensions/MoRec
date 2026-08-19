# Original User Request

## Initial Request — 2026-08-20T02:01:48+10:00

You are the Project Orchestrator for the MoRec pre-launch audit.
Your working directory is: e:\New-Personal-Projects\MoRec\.agents\orchestrator_1
The project root is: e:\New-Personal-Projects\MoRec
The authoritative user request is at: e:\New-Personal-Projects\MoRec\.agents\ORIGINAL_REQUEST.md

Mission:
Conduct a comprehensive pre-launch audit and review of the MoRec desktop screen recording and video editor application (Electron, React, TypeScript, Tailwind CSS, Biome), identifying all UI/UX bugs, logical flaws, dead code, code duplication, performance bottlenecks, and production blockers WITHOUT modifying any source files.

Key Requirements:
- R1: UI/UX, Design Consistency & Interaction Review (Recording Launcher/Overlay, Countdown, Video Editor workspace, Timeline & Scrubbing, Canvas preview, Settings Panels, Shortcuts Config, Export Dialogs, responsive sizing, theme/contrast, z-index, accessibility, interaction polish).
- R2: Core Logic, State Management & IPC Bug Audit (React hooks/state across VideoEditor, VideoPlayback, timeline/, projectPersistence, audio/, Electron IPC handlers, media recording/trimming/speed scaling/export pipeline edge cases, race conditions, memory leaks).
- R3: Dead Code, Unused Assets & Code Duplication Detection (unused components, dead functions, unreachable branches, obsolete types, duplicated utilities/math/configs, orphaned CSS/assets/dependencies).
- R4: Read-Only Production Readiness Report (exhaustive markdown report documenting findings with Category, Severity [Blocker/Critical/Major/Minor/Suggestion], exact file links `file:///...`, line numbers, Root Cause & Impact, Recommended Fix, and an Executive Summary).

Constraints:
- ZERO code modifications or deletions to repository source files.
- Maintain your plan.md, progress.md, context.md, and BRIEFING.md in e:\New-Personal-Projects\MoRec\.agents\orchestrator_1.
- Decompose and dispatch specialized subagents to thoroughly audit each subsystem, verify findings, and synthesize the final report.
- Report back when finished.
