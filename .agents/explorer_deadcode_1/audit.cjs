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
console.log('Total source files:', allCodeFiles.length);

console.log('\n--- UI Components in src/components/ui/ ---');
const uiDir = path.join(rootDir, 'src', 'components', 'ui');
const uiFiles = fs.readdirSync(uiDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
for (const f of uiFiles) {
  const base = f.replace(/\.tsx?$/, '');
  let count = 0;
  for (const file of allCodeFiles) {
    if (path.resolve(file) === path.resolve(path.join(uiDir, f))) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('components/ui/' + base) || content.includes('/ui/' + base)) {
      count++;
    }
  }
  if (count === 0) {
    console.log('[UNUSED UI COMPONENT]', f);
  }
}

console.log('\n--- All Other Components in src/components/ ---');
const allComponents = getAllFiles(path.join(rootDir, 'src', 'components'), ['.tsx']);
for (const comp of allComponents) {
  const rel = path.relative(rootDir, comp);
  const base = path.basename(comp, '.tsx');
  if (comp.startsWith(uiDir)) continue;
  let count = 0;
  const matches = [];
  for (const file of allCodeFiles) {
    if (path.resolve(file) === path.resolve(comp)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(base)) {
      count++;
      matches.push(path.relative(rootDir, file));
    }
  }
  if (count === 0) {
    console.log('[UNUSED COMPONENT]', rel);
  }
}
