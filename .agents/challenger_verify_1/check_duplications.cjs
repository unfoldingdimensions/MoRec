const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

const allCodeFiles = [];
function findCode(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'dist-electron', '.agents'].includes(e.name)) {
        findCode(full);
      }
    } else if (/\.(ts|tsx|js)$/.test(e.name)) {
      allCodeFiles.push(full);
    }
  }
}
findCode(projectRoot);

function searchFunctionDefinitions(fnName) {
  const matches = [];
  const regex = new RegExp(`(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=\\s*(?:\\([^)]*\\)|[a-zA-Z0-9_]+)\\s*=>)`, 'g');
  allCodeFiles.forEach(f => {
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (regex.test(line)) {
        matches.push({ file: path.relative(projectRoot, f).replace(/\\/g, '/'), line: idx + 1, content: line.trim() });
      }
    });
  });
  return matches;
}

console.log('=== CLAMP DEFINITIONS ===');
console.log(searchFunctionDefinitions('clamp'));

console.log('\n=== CLAMP01 DEFINITIONS ===');
console.log(searchFunctionDefinitions('clamp01'));

console.log('\n=== FORMATTIME / FORMATDURATION DEFINITIONS ===');
console.log(searchFunctionDefinitions('formatTime'));
console.log(searchFunctionDefinitions('formatDuration'));

