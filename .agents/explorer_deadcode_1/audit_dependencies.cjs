const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const allCode = [
  ...getAllFiles(path.join(rootDir, 'src')),
  ...getAllFiles(path.join(rootDir, 'electron')),
  ...getAllFiles(path.join(rootDir, 'scripts')),
  path.join(rootDir, 'vite.config.ts'),
  path.join(rootDir, 'vitest.config.ts'),
  path.join(rootDir, 'tailwind.config.cjs'),
  path.join(rootDir, 'postcss.config.cjs'),
  path.join(rootDir, 'biome.json'),
  path.join(rootDir, 'electron-builder.json5')
];

function checkDeps(depsObj, type = 'dependencies') {
  console.log(`\n=== CHECKING ${type} ===`);
  for (const dep of Object.keys(depsObj || {})) {
    let usages = [];
    for (const file of allCode) {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(dep)) {
        usages.push(path.relative(rootDir, file));
      }
    }
    if (usages.length === 0) {
      console.log(`[UNUSED ${type}] ${dep}`);
    } else {
      console.log(`[USED] ${dep} (${usages.length} files)[ ${usages.slice(0, 2).join(', ')}${usages.length > 2 ? '...' : ''}]`);
    }
  }
}

checkDeps(pkg.dependencies, 'dependencies');
checkDeps(pkg.devDependencies, 'devDependencies');
