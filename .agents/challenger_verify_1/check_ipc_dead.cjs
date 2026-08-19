const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

const preloadContent = fs.readFileSync(path.resolve(projectRoot, 'electron/preload.ts'), 'utf8');

// Find all methods exposed on window.electronAPI in preload.ts
const preloadMethods = [];
const methodRegex = /([a-zA-Z0-9_]+)\s*:\s*(?:\([^)]*\)|async\s*\([^)]*\))\s*=>/g;
let match;
while ((match = methodRegex.exec(preloadContent)) !== null) {
  preloadMethods.push(match[1]);
}

console.log(`Exposed Electron API methods in preload.ts: ${preloadMethods.length}`);

// Get all src files
const srcFiles = [];
function findSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findSrc(full);
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(full);
  }
}
findSrc(path.resolve(projectRoot, 'src'));

console.log(`Scanning ${srcFiles.length} src files for electronAPI usages...`);

const unusedMethods = [];
preloadMethods.forEach(method => {
  const pattern = new RegExp(`(?:window\\.)?electronAPI(?:\\?)?\\.${method}\\b`);
  let usedIn = [];
  srcFiles.forEach(sf => {
    const content = fs.readFileSync(sf, 'utf8');
    if (pattern.test(content)) {
      usedIn.push(path.relative(projectRoot, sf));
    }
  });
  if (usedIn.length === 0) {
    unusedMethods.push(method);
    console.log(`[DEAD / UNUSED PRELOAD METHOD] electronAPI.${method}`);
  }
});

console.log(`\nTotal unused preload methods: ${unusedMethods.length}`);

// Check phantom getLinuxWindowSystem
console.log('\n--- Checking getLinuxWindowSystem ---');
console.log('In preload.ts:', preloadContent.includes('getLinuxWindowSystem'));
const ipcFiles = fs.readdirSync(path.resolve(projectRoot, 'electron/ipc/register'));
let foundInMain = false;
ipcFiles.forEach(f => {
  const c = fs.readFileSync(path.resolve(projectRoot, 'electron/ipc/register', f), 'utf8');
  if (c.includes('get-linux-window-system') || c.includes('getLinuxWindowSystem')) {
    foundInMain = true;
    console.log(`Found in electron/ipc/register/${f}`);
  }
});
if (!foundInMain) {
  console.log('NOT REGISTERED IN MAIN PROCESS IPC HANDLERS! (Phantom API)');
}

