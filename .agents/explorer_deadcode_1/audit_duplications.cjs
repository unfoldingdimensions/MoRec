const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const allSrc = getAllFiles(path.join(rootDir, 'src'));
const allElectron = getAllFiles(path.join(rootDir, 'electron'));
const allFiles = [...allSrc, ...allElectron];

const functionsByName = new Map();

for (const file of allFiles) {
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const relPath = path.relative(rootDir, file);
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    let match = line.match(/function\s+([a-zA-Z0-9_$]+)\s*\(/);
    if (match) {
      const name = match[1];
      if (!functionsByName.has(name)) functionsByName.set(name, []);
      functionsByName.get(name).push({ file: relPath, line: idx + 1, sig: line.trim() });
    }

    match = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(?[^\)]*\)?\s+=>/);
    if (match) {
      const name = match[1];
      if (!functionsByName.has(name)) functionsByName.set(name, []);
      functionsByName.get(name).push({ file: relPath, line: idx + 1, sig: line.trim() });
    }
  });
}


fs.writeFileSync('.agents/explorer_deadcode_1/function_duplications.json', JSON.stringify(Array.from(functionsByName.entries()), null, 2));

for (const [fnName, occs] of functionsByName.entries()) {
  if (occs.length > 1) {
    console.log(`\n- function "${fnName}" (${occs.length} definitions):`);
    occs.forEach(o => console.log(`   [${o.file}:${o.line}] ${o.sig}`));
  }
}
