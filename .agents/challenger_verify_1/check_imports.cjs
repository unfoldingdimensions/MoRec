const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

function getAllSourceFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'dist-electron' && entry.name !== '.agents') {
        results = results.concat(getAllSourceFiles(full));
      }
    } else {
      if (/\.(ts|tsx|js|jsx|css|json)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

const allFiles = getAllSourceFiles(projectRoot);
console.log(`Total source files scanned: ${allFiles.length}`);

const targets = [
  { name: 'TimelineToolbar', pattern: /TimelineToolbar/ },
  { name: 'accordion.tsx', pattern: /from ["'].*\/accordion["']/ },
  { name: 'card.tsx', pattern: /from ["'].*\/card["']/ },
  { name: 'content-clamp.tsx', pattern: /from ["'].*\/content-clamp["']/ },
  { name: 'item-content.tsx', pattern: /from ["'].*\/item-content["']/ },
  { name: 'FormatSelector.tsx', pattern: /from ["'].*\/FormatSelector["']/ },
  { name: 'GifOptionsPanel.tsx', pattern: /from ["'].*\/GifOptionsPanel["']/ },
  { name: 'KeyboardShortcutsHelp.tsx', pattern: /from ["'].*\/KeyboardShortcutsHelp["']/ },
  { name: 'nativeFrameCapture.ts', pattern: /nativeFrameCapture/ },
  { name: 'nativeStaticLayoutRoutePlan.ts', pattern: /nativeStaticLayoutRoutePlan/ },
  { name: 'SourceSelector.module.css', pattern: /SourceSelector\.module\.css/ },
  { name: 'emoji-picker-react', pattern: /from ["']emoji-picker-react["']/ },
  { name: '@radix-ui/react-accordion', pattern: /from ["']@radix-ui\/react-accordion["']/ },
  { name: 'react-resizable-panels', pattern: /from ["']react-resizable-panels["']/ }
];

targets.forEach(t => {
  let matches = [];
  allFiles.forEach(f => {
    // skip the target file itself
    if (f.endsWith(t.name) || (t.name.includes('/') && f.endsWith(t.name.split('/').pop()))) return;
    const content = fs.readFileSync(f, 'utf8');
    if (t.pattern.test(content)) {
      matches.push(path.relative(projectRoot, f));
    }
  });
  console.log(`Target: ${t.name} -> Imported in ${matches.length} files: ${matches.join(', ') || 'NONE (0 imports)'}`);
});
