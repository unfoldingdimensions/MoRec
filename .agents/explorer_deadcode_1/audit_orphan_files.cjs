const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const allElectron = getAllFiles(path.join(rootDir, 'electron'));
const allFiles = [...allSrc, ...allElectron];

const entryPoints = [
  "src/main.tsx",
  "src/App.tsx",
  'electron/main.ts',
  'electron/preload.ts',
  'vite.config.ts',
  'vitest.config.ts'
];

for (const file of allFiles) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx') || file.endsWith('.d.ts')) continue;
  const rel = path.relative(rootDir, file).split(path.sep).join('/');
  if (entryPoints.includes(rel)) continue;

  const baseName = path.basename(file, path.extname(file));
  let importedBy = [];

  for (const otherFile of allFiles) {
    if (otherFile === file) continue;
    const content = fs.readFileSync(otherFile, 'utf8');
    if (
      content.includes('"./' + baseName + '"') ||
      content.includes('\'./' + baseName + '\'') ||
      content.includes('/' + baseName + '"') ||
      content.includes('/' + baseName + '\'')
    ) {
      importedBy.push(path.relative(rootDir, otherFile));
    }
  }

  if (importedBy.length === 0) {
    console.log('[ORPHAN FILE] ' + rel);
  } else if (importedBy.every(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'))) {
    console.log('tTEST-ONLY FILE] ' + rel + ' (Tests: ' + importedBy.join(', ') + ')');
  }
}
