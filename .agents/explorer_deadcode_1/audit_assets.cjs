const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();

function getAllAssetFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllAssetFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const publicAssets = getAllAssetFiles(path.join(rootDir, 'public'));
const srcAssets = getAllAssetFiles(path.join(rootDir, 'src', 'assets'));
const brandingAssets = getAllAssetFiles(path.join(rootDir, 'branding'));
const iconsAssets = getAllAssetFiles(path.join(rootDir, 'icons'));

const allAssets = [...publicAssets, ...srcAssets, ...brandingAssets, ...iconsAssets];

const allSource = [
  ...getAllFiles(path.join(rootDir, 'src')),
  ...getAllFiles(path.join(rootDir, 'electron')),
  ...getAllFiles(path.join(rootDir, 'scripts')),
  path.join(rootDir, 'index.html'),
  path.join(rootDir, 'vite.config.ts'),
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'electron-builder.json5')
];

console.log('Total assets to check:', allAssets.length);

const orphanedAssets = [];

for (const assetPath of allAssets) {
  const relAsset = path.relative(rootDir, assetPath);
  const baseName = path.basename(assetPath);
  const relPosix = relAsset.replace(/\\/g, '/');
  const publicRel = relPosix.replace(/^public\//, '');

  let usages = [];

  for (const sfile of allSource) {
    if (!fs.existsSync(sfile)) continue;
    const content = fs.readFileSync(sfile, 'utf8');
    if (
      content.includes(baseName) ||
      content.includes(relPosix) ||
      content.includes('/' + publicRel) ||
      content.includes(publicRel)
    ) {
      usages.push(path.relative(rootDir, sfile));
    }
  }

  if (usages.length === 0) {
    orphanedAssets.push(relAsset);
  }
}

fs.writeFileSync('.agents/explorer_deadcode_1/orphaned_assets.json', JSON.stringify(orphanedAssets, null, 2));
console.log('Orphaned assets found:', orphanedAssets.length);
orphanedAssets.forEach(a => console.log('-  ' + a));
