const fs = require('fs');
const path = require('path');

console.log('=== VERIFYING DEAD CODE & DUPLICATION FINDINGS ===');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

// 1. Check unused UI components
const deadComponents = [
  'src/components/ui/accordion.tsx',
  'src/components/ui/card.tsx',
  'src/components/ui/content-clamp.tsx',
  'src/components/ui/item-content.tsx',
  'src/components/video-editor/FormatSelector.tsx',
  'src/components/video-editor/GifOptionsPanel.tsx',
  'src/components/video-editor/KeyboardShortcutsHelp.tsx',
  'src/components/video-editor/timeline/TimelineToolbar.tsx',
  'src/components/launch/popovers/index.ts',
  'src/components/video-editor/timeline/components/index.ts',
  'src/lib/exporter/nativeFrameCapture.ts',
  'electron/ipc/export/nativeStaticLayoutRoutePlan.ts'
];

deadComponents.forEach(file => {
  const fullPath = path.resolve(projectRoot, file);
  const exists = fs.existsSync(fullPath);
  console.log(`File: ${file} -> exists: ${exists}`);
});

// Check package.json dependencies
const pkg = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8'));
const checkDeps = [
  'emoji-picker-react',
  '@radix-ui/react-accordion',
  'react-resizable-panels',
  '@radix-ui/react-dialog',
  '@radix-ui/react-select'
];
console.log('\n--- Package.json Dependencies Check ---');
checkDeps.forEach(dep => {
  const inDeps = pkg.dependencies?.[dep] || pkg.devDependencies?.[dep];
  console.log(`${dep}: ${inDeps || 'NOT FOUND'}`);
});

// Check wallpaper directory sizes
const wallpaperDir = path.resolve(projectRoot, 'public/wallpapers');
if (fs.existsSync(wallpaperDir)) {
  const files = fs.readdirSync(wallpaperDir);
  let totalBytes = 0;
  files.forEach(f => {
    const stats = fs.statSync(path.join(wallpaperDir, f));
    totalBytes += stats.size;
  });
  console.log(`\n--- Wallpaper directory: ${files.length} files, ${(totalBytes / (1024*1024)).toFixed(2)} MB ---`);
}

