const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const allElectron = getAllFiles(path.join(rootDir, 'electron'));

const channelsToCheck = [
  "get-recorded-video-path",
  "get-system-cursor-assets",
  "clear-current-video-path",
  "load-project-file",
  "get-projects-directory",
  "open-projects-directory",
  "skip-update-version",
  "get-update-status-summary",
  "get-linux-window-system",
  "open-recordings-folder",
  "extensions:list",
  "extensions:get-directory",
  "extensions:marketplace-submit",
  "extensions:reviews-list",
  "extensions:review-update"
];

for (const ch of channelsToCheck) {
  let srcCount = 0;
  for (const f of allSrc) {
    if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
    const c = fs.readFileSync(f, 'utf8');
    if (c.includesFull ? c.includes(ch) : fs.readFileSync(f, 'utf8').includes(ch)) srcCount++;
  }
  let mainCount = 0;
  for (const f of allElectron) {
    if (f.endsWith('.test.ts')) continue;
    const c = fs.readFileSync(f, 'utf8');
    if (c.includesFull ? c.includes(ch) : fs.readFileSync(f, 'utf8').includes(ch)) mainCount++;
  }
  console.log(`[RPC] ${ch} | Src calls: ${srcCount} | Electron handlers: ${mainCount}`);
}
