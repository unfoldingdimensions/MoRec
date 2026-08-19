const fs = require('fs');
const path = require('path');

function getAllFiles(dir, exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'dist-electron', '.agents', 'release', '.mimosa', '.tmp', 'build'].includes(entry.name)) {
        results = results.concat(getAllFiles(full, exts));
      }
    } else if (exts.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const rootDir = process.cwd();
const allCodeFiles = getAllFiles(rootDir);
console.log('Scanned', allCodeFiles.length, 'code files');

// Regex for exports:
// export const/function/type/interface/enum/class X
// export { A, B, C }
// export default ...

const exportMap = [];

for (const filePath of allCodeFiles) {
  const relPath = path.relative(rootDir, filePath);
  if (relPath.includes('.test.') || relPath.endsWith('.d.ts')) continue;
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Match named exports
  const namedMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g);
  for (const match of namedMatches) {
    const symbol = match[1];
    exportMap.push({ symbol, file: relPath, fullPath: filePath, type: 'named' });
  }

  // Match export { x, y as z }
  const exportBlockMatches = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const block of exportBlockMatches) {
    const inner = block[1];
    const parts = inner.split(',');
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      if (part.includes(' as ')) {
        const [, alias] = part.split(/\s+as\s+/);
        exportMap.push({ symbol: alias.trim(), file: relPath, fullPath: filePath, type: 're-export' });
      } else if (part.includes('type ')) {
        const sym = part.replace(/^type\s+/, '').trim();
        exportMap.push({ symbol: sym, file: relPath, fullPath: filePath, type: 'type-export' });
      } else {
        exportMap.push({ symbol: part, file: relPath, fullPath: filePath, type: 'block-export' });
      }
    }
  }
}

console.log('Total exports found:', exportMap.length);

const deadExports = [];
for (const exp of exportMap) {
  const sym = exp.symbol;
  let usageCount = 0;
  let nonTestUsages = [];

  const symRegex = new RegExp('\\b' + sym + '\\b');

  for (const file of allCodeFiles) {
    if (file === exp.fullPath) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (symRegex.test(content)) {
      usageCount++;
      const r = path.relative(rootDir, file);
      if (!r.includes('.test.') && !r.includes('.spec.')) {
        nonTestUsages.push(r);
      }
    }
  }

  if (usageCount === 0) {
    deadExports.push({ ...exp, reason: 'zero_usages' });
  } else if (nonTestUsages.length === 0) {
    deadExports.push({ ...exp, reason: 'test_only_usages' });
  }
}

console.log('\n=== UNUSED EXPORTS (ZERO REPO REFERENCES) ===');
const strictlyZero = deadExports.filter(d => d.reason === 'zero_usages');
console.log('Count:', strictlyZero.length);
strictlyZero.forEach(d => {
  console.log(- []  ());
});

console.log('\n=== TEST-ONLY EXPORTS (USED ONLY IN TEST FILES) ===');
const testOnly = deadExports.filter(d => d.reason === 'test_only_usages');
console.log('Count:', testOnly.length);
testOnly.forEach(d => {
  console.log(- []  ());
});
