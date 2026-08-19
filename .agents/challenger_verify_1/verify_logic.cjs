const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING LOGIC / IPC FINDINGS ===');

function checkFileLines(filePath, start, end) {
  const fullPath = path.resolve('e:/New-Personal-Projects/MoRec', filePath);
  if (!fs.existsSync(fullPath)) return { exists: false };
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const snippet = lines.slice(Math.max(0, start - 1), end).map((l, i) => (start + i) + ': ' + l).join('\n');
  return { exists: true, totalLines: lines.length, snippet };
}

const tests = [
  { id: 'LOGIC-001a', file: 'electron/ipc/register/settings.ts', start: 305, end: 335 },
  { id: 'LOGIC-001b', file: 'electron/ipc/register/settings.ts', start: 345, end: 370 },
  { id: 'LOGIC-002a', file: 'src/components/video-editor/VideoPlayback.tsx', start: 490, end: 505 },
  { id: 'LOGIC-002b', file: 'src/components/video-editor/VideoPlayback.tsx', start: 2360, end: 2385 },
  { id: 'LOGIC-002c', file: 'src/components/video-editor/VideoPlayback.tsx', start: 3315, end: 3330 },
  { id: 'LOGIC-003a', file: 'electron/preload.ts', start: 925, end: 950 },
  { id: 'LOGIC-003b', file: 'electron/ipc/register/settings.ts', start: 140, end: 175 },
  { id: 'LOGIC-004a', file: 'src/components/video-editor/VideoEditor.tsx', start: 3555, end: 3580 },
  { id: 'LOGIC-004b', file: 'src/components/video-editor/VideoEditor.tsx', start: 6525, end: 6545 },
  { id: 'LOGIC-004c', file: 'src/components/video-editor/VideoPlayback.tsx', start: 3345, end: 3365 },
  { id: 'LOGIC-004d', file: 'src/lib/exporter/modernFrameRenderer.ts', start: 1560, end: 1575 },
  { id: 'LOGIC-004e', file: 'src/lib/exporter/modernFrameRenderer.ts', start: 3265, end: 3285 },
  { id: 'LOGIC-005', file: 'src/hooks/useScreenRecorder.ts', start: 1305, end: 1405 },
  { id: 'LOGIC-006', file: 'src/components/video-editor/VideoEditor.tsx', start: 4080, end: 4150 },
  { id: 'LOGIC-007', file: 'src/components/video-editor/audio/waveform/WaveformGenerator.ts', start: 85, end: 130 },
  { id: 'LOGIC-008a', file: 'src/components/video-editor/editorHistory.ts', start: 1, end: 40 },
  { id: 'LOGIC-008b', file: 'src/components/video-editor/VideoEditor.tsx', start: 1970, end: 2010 },
  { id: 'LOGIC-009', file: 'src/components/video-editor/timeline/hooks/actions/useTimelineAudioActions.ts', start: 35, end: 70 },
  { id: 'LOGIC-010a', file: 'src/components/launch/popovers/PopoverScaffold.tsx', start: 40, end: 60 },
  { id: 'LOGIC-010b', file: 'src/hooks/useAudioLevelMeter.ts', start: 45, end: 65 },
  { id: 'LOGIC-011a', file: 'src/components/video-editor/projectPersistence.ts', start: 280, end: 315 },
  { id: 'LOGIC-011b', file: 'electron/ipc/utils.ts', start: 30, end: 55 },
  { id: 'LOGIC-011c', file: 'src/components/video-editor/VideoEditor.tsx', start: 2575, end: 2595 },
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
