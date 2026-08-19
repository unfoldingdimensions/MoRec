const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const allElectron = getAllFiles(path.join(rootDir, 'electron'));
const allCode = [...allSrc, ...allElectron];

const commentedOutBlocks = [];
for (const file of allCode) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(rootDir, file);
  const lines = content.split('\n');

  let consecutiveComments = 0;
  let startLine = 0;
  let commentBuffer = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Check for commented out code (not just english docs)
    if (trimmed.startsWith('//') && (trimmed.includes('const ') || trimmed.includes('let ') || trimmed.includes('import ') || trimmed.includes('return ') || trimmed.includes('<') || trimmed.includes('setO') || trimmed.includes('await '))) {
      if (consecutiveComments === 0) startLine = idx + 1;
      consecutiveComments++;
      commentBuffer.push(trimmed);
    } else {
      if (consecutiveComments >= 2) {
        commentedOutBlocks.push({
          file: rel,
          startLine,
          lines: consecutiveComments,
          snapshot: commentBuffer.slice(0, 3).join('\n')
        });
      }
      consecutiveComments = 0;
      commentBuffer = [];
    }
  });
}

console.log('Commented out code blocks found:', commentedOutBlocks.length);
for (const c of commentedOutBlocks) {
  console.log(`\n- [${c.file}:${c.startLine}] (${c.lines} lines):\n${c.snapshot}`);
}
