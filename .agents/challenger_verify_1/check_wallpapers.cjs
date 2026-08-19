const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';
const wallpaperDir = path.resolve(projectRoot, 'public/wallpapers');
const wallpaperFiles = fs.readdirSync(wallpaperDir);

// Find where wallpapers are defined in src
const allSrcFiles = [];
function findSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findSrc(full);
    else if (/\.(ts|tsx)$/.test(e.name)) allSrcFiles.push(full);
  }
}
findSrc(path.resolve(projectRoot, 'src'));

let references = new Map();
wallpaperFiles.forEach(wf => references.set(wf, []));

allSrcFiles.forEach(sf => {
  const content = fs.readFileSync(sf, 'utf8');
  wallpaperFiles.forEach(wf => {
    if (content.includes(wf)) {
      references.get(wf).push(path.relative(projectRoot, sf));
    }
  });
});

console.log('=== WALLPAPER ASSET AUDIT ===');
let indexedCount = 0;
let unindexedCount = 0;
let unindexedBytes = 0;
let totalBytes = 0;

wallpaperFiles.forEach(wf => {
  const stats = fs.statSync(path.join(wallpaperDir, wf));
  totalBytes += stats.size;
  const refs = references.get(wf);
  if (refs.length > 0) {
    indexedCount++;
    console.log(`[INDEXED] ${wf} (${(stats.size / 1024).toFixed(1)} KB) -> used in: ${refs.join(', ')}`);
  } else {
    unindexedCount++;
    unindexedBytes += stats.size;
    console.log(`[UNINDEXED/ORPHANED] ${wf} (${(stats.size / 1024 / 1024).toFixed(2)} MB) -> 0 references`);
  }
});

console.log(`\nSummary:`);
console.log(`Total Wallpapers: ${wallpaperFiles.length} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Indexed: ${indexedCount}`);
console.log(`Unindexed: ${unindexedCount} (${(unindexedBytes / 1024 / 1024).toFixed(2)} MB)`);

