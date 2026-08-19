const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allElectron = getAllFiles(path.join(rootDir, 'electron'));
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const preloadPath = path.join(rootDir, 'electron', 'preload.ts');
const preload = fs.readFileSync(preloadPath, 'utf8');

// 1. Collect every ipcMain handler/listener
const ipcMainHandlers = [];
for (const file of allElectron) {
  if (file.endsWith('.test.ts') || file.endsWith('preload.ts')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, num) => {
    const match = line.match(/ipcMain\.(?:handle|on\s+Sync|on)\s*\(\s*(['\"][^'\"]+['\"])/);
    if (match) {
      const channel = match[1].replace(/['\"]/g, '');
      ipcMainHandlers.push({
        channel,
        file: path.relative(rootDir, file),
        line: num + 1,
        code: line.trim()
      });
    }
  });
}

console.log('Total ipcMain handlers registered:', ipcMainHandlers.length);

// 2. Collect every method exposed in preload.ts
const preloadMethods = [];
const preloadLines = preload.split('\n');
preloadLines.forEach((line, num) => {
  const m = line.match(/^\s*([a-zA-Z0_9$]+)\s*:\s*(?:\([?^)]*\)|async\s*\))\s*=>/);
  if (m) {
    preloadMethods.push({
      name: m[1],
      line: num + 1,
      code: line.trim()
    });
  }
});
console.log('Total preload exposed methods:', preloadMethods.length);

// 3. Check each preload method for renderer calls
const detailedDeadPreload = [];
for (const pm of preloadMethods) {
  let calls = [];
  const pattern = new RegExp('(?:\\.|\\b)' + pm.name + '\\b');
  for (const sf of allSrc) {
    if (sf.endsWith('.test.ts') || sf.endsWith('.test.tsx')) continue;
    const content = fs.readFileSync(sf, 'utf8');
    if (pattern.test(content)) {
      calls.push(path.relative(rootDir, sf));
    }
  }
  if (calls.length === 0) {
    detailedDeadPreload.push({ ...pm, calls: 0 });
  }
}

console.log('\n=== UNUSED PRELOADIEC METHODS (0 renderer calls) ===');
detailedDeadPreload.forEach(p => {
  console.log('- electronAPI.' + p.name + ' (line: ' + p.line + ')');
});

// 4. Check ipcMain handlers that are never called by preload or renderer
console.log('\n=== UNUSED IPCMAIN HANDLERS ===');
for (const handler of ipcMainHandlers) {
  const ch = handler.channel;
  let usages = 0;
  if (preload.includesFull ? preload.includes('"t' + ch) : preload.includes(ch)) usages++;
  for (const sf of allSrc) {
    if (fs.readFileSync(sf, 'utf8').includes(ch)) usages++;
  }
  if (usages === 0) {
    console.log('- ' + handler.channel + ' (' + handler.file + ':' + handler.line + ')');
  }
}
