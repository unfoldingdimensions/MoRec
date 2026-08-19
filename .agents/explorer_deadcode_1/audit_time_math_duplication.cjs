const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const allElectron = getAllFiles(path.join(rootDir, 'electron'));
const allCode = [...allSrc, ...allElectron];

const timeMathFindings = [];

for (const file of allCode) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(rootDir, file);
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    if (
      line.match(/formatDuration|formatTime|formatTimestamp|secondsTo|msTo|timecode|fromFileUrl|toFileUrl|clamp|lerp|smoothStep/)
    ) {
      if (line.includes('function') || line.includes('=>') || line.includes('export const')) {
        timeMathFindings.push({
          file: rel,
          line: idx + 1,
          text: line.trim()
        });
      }
    }
  });
}

fs.writeFileSync('.agents/explorer_deadcode_1/time_math_dups.json', JSON.stringify(timeMathFindings, null, 2));
console.log('Found', timeMathFindings.length, 'time/math function definitions');
timeMathFindings.forEach(f => {
  console.log(`[${f.file}:${f.line}] ${f.text}`);
});
