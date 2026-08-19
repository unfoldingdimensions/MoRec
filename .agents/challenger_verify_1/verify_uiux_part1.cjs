const fs = require('fs');
const path = require('path');

function checkFileLines(filePath, start, end) {
  const fullPath = path.resolve('e:/New-Personal-Projects/MoRec', filePath);
  if (!fs.existsSync(fullPath)) return { exists: false };
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const snippet = lines.slice(Math.max(0, start - 1), end).map((l, i) => (start + i) + ': ' + l).join('\n');
  return { exists: true, totalLines: lines.length, snippet };
}

const tests = [
  { id: 'UI-001', file: 'src/components/launch/popovers/ProjectPopover.tsx', start: 30, end: 46 },
  { id: 'UI-001b', file: 'src/components/video-editor/ProjectBrowserDialog.tsx', start: 170, end: 185 },
  { id: 'UI-002', file: 'src/components/video-editor/ProjectBrowserDialog.tsx', start: 180, end: 200 },
  { id: 'UI-003', file: 'src/components/launch/SourceSelector.module.css', start: 1, end: 25 },
  { id: 'UI-004', file: 'src/components/ui/audio-level-meter.tsx', start: 10, end: 25 },
  { id: 'UI-005', file: 'src/components/launch/SourceSelector.css', start: 130, end: 145 },
  { id: 'UI-006', file: 'src/components/countdown/CountdownOverlay.tsx', start: 40, end: 70 },
  { id: 'UI-007', file: 'src/components/launch/UpdateToastWindow.tsx', start: 90, end: 110 },
  { id: 'UI-008', file: 'src/components/video-editor/VideoEditor.tsx', start: 6265, end: 6280 },
  { id: 'UI-008b', file: 'src/components/video-editor/VideoEditor.tsx', start: 6835, end: 6850 },
  { id: 'UI-009', file: 'src/components/video-editor/TutorialHelp.tsx', start: 25, end: 40 },
  { id: 'UI-010', file: 'src/components/video-editor/KeyboardShortcutsHelp.tsx', start: 1, end: 25 },
  { id: 'UI-011', file: 'src/components/video-editor/timeline/components/playhead/PlaybackCursor.tsx', start: 35, end: 55 },
  { id: 'UI-012', file: 'src/components/video-editor/timeline/Item.tsx', start: 110, end: 130 },
  { id: 'UI-013', file: 'src/components/video-editor/CropControl.tsx', start: 15, end: 35 },
  { id: 'UI-014', file: 'src/components/video-editor/VideoPlayback.tsx', start: 3020, end: 3035 },
  { id: 'UI-015', file: 'src/components/video-editor/AnnotationSettingsPanel.tsx', start: 810, end: 825 },
  { id: 'UI-015b', file: 'src/components/video-editor/SettingsPanel.tsx', start: 4370, end: 4390 },
  { id: 'UI-016', file: 'src/components/video-editor/AnnotationSettingsPanel.tsx', start: 145, end: 160 },
  { id: 'UI-017', file: 'src/components/video-editor/SliderControl.tsx', start: 25, end: 40 },
  { id: 'UI-018a', file: 'src/components/video-editor/FormatSelector.tsx', start: 1, end: 20 },
  { id: 'UI-018b', file: 'src/components/video-editor/GifOptionsPanel.tsx', start: 1, end: 20 },
  { id: 'UI-019', file: 'src/components/video-editor/ExportSettingsMenu.tsx', start: 105, end: 125 },
  { id: 'UI-020a', file: 'src/components/ui/dialog.tsx', start: 15, end: 45 },
  { id: 'UI-020b', file: 'src/components/ui/select.tsx', start: 65, end: 80 },
];

tests.forEach(t => {
  const res = checkFileLines(t.file, t.start, t.end);
  console.log('\n--- [' + t.id + '] ' + t.file + ' (lines ' + t.start + '-' + t.end + ') ---');
  if (!res.exists) {
    console.log('FILE NOT FOUND!');
  } else {
    console.log(res.snippet);
  }
});
