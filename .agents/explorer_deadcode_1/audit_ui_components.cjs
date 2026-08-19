const fs = require('fs');
const path = require('path');
const { getAllFiles } = require('./scanner.cjs');

const rootDir = process.cwd();
const uiFiles = getAllFiles(path.join(rootDir, 'src', 'components', 'ui'));
const allSrc = getAllFiles(path.join(rootDir, 'src'));

for (const uiFile of uiFiles) {
  const baseName = path.basename(uiFile, path.extname(uiFile));
  let usages = [];
  for (const sfile of allSrc) {
    if (sfile === uiFile) continue;
    const content = fs.readFileSync(sfile, 'utf8');
    if (content.includes('components/ui/' + baseName) || content.includes('@/components/ui/' + baseName)) {
      usages.push(path.relative(rootDir, sfile));
    }
  }
  console.log(`[${ baseName }] Imported by ${usages.length} files`);
}
