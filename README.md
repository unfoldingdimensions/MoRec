# Mo Rec

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-AGPL3.0-2563eb?style=for-the-badge" alt="AGPL 3.0 license" />
</p>

### Create polished demo videos in minutes
**Mo Rec** is an **open-source screen recorder** and video editor for **walkthroughs, demos, product videos**, and tutorials.

---

## What is Mo Rec?

Mo Rec is a desktop app for recording and editing screen captures with motion-driven presentation tools built in. Instead of sending raw footage to a motion designer just to add zooms, cursor polish, or a styled background, Mo Rec handles that workflow in one place.

Mo Rec runs on:
- **macOS** 14.0+
- **Windows** 10 Build 19041+
- **Linux** on modern distros

---

## Core Features

### Auto-zooms, cursor polish, and styled frames
Mo Rec can automatically emphasize activity with zoom suggestions, smooth cursor movement, add motion effects, and place the final composition inside a styled frame with wallpapers, colors, gradients, blur, padding, and shadows.

### Dynamic webcam bubble overlays
Add webcam footage as an overlay bubble, position it with presets or custom coordinates, mirror it, control shadow and roundness, and optionally make it react to zoom so it stays visually balanced during motion.

### Timeline editing built for demos
Use drag-and-drop timeline tools for zooms, trims, speed regions, annotations, extra audio regions, and crop-aware edits. Save and reopen work as `.morec` project files.

### Extensions & Customization
Mo Rec features an extension architecture supporting custom frames, wallpapers, themes, and render hooks.

---

## All Features

### Recording
- Record an entire display or a single app window
- Jump directly from recording into the editor
- Capture microphone audio and system audio
- Use native capture backends where supported
- Resume editing from saved `.morec` project files
- Open existing recordings or existing project files from the app

### Timeline and Editing
- Drag-and-drop timeline editing
- Trim unwanted sections
- Add manual zoom regions
- Use automatic zoom suggestions based on cursor activity
- Add speed-up and slow-down regions
- Add text, image, and figure annotations
- Add extra audio regions on the timeline
- Crop the recorded frame
- Save and reopen projects with editor state preserved

### Cursor Controls
- Show or hide the rendered cursor overlay
- Cursor size adjustment
- Motion smoothing
- Click effects (ripple, spotlight, echo)
- Click bounce and cursor sway

---

## Development

```bash
# Install dependencies
npm install

# Run the dev server
npm run dev

# Run tests
npm test
```

## License
Mo Rec is licensed under the **AGPL 3.0**.
