const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

function findFiles(dir, ext) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results = results.concat(findFiles(full, ext));
    else if (full.endsWith(ext)) results.push(full);
  }
  return results;
}

const svgFiles = findFiles(path.resolve(projectRoot, 'public'), '.svg')
  .concat(findFiles(path.resolve(projectRoot, 'src'), '.svg'));

console.log(`Found ${svgFiles.length} SVG files.`);

const allCodeFiles = [];
function findCode(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'dist-electron', '.agents'].includes(e.name)) {
        findCode(full);
      }
    } else if (/\.(ts|tsx|js|jsx|json|css)$/.test(e.name)) {
      allCodeFiles.push(full);
    }
  }
}
findCode(projectRoot);

const unusedSvgs = [];
svgFiles.forEach(svgPath => {
  const baseName = path.basename(svgPath);
  const relPath = path.relative(projectRoot, svgPath).replace(/\\/g, '/');
  let used = false;
  for (const cf of allCodeFiles) {
    if (cf === svgPath) continue;
    const content = fs.readFileSync(cf, 'utf8');
    if (content.includes(baseName) || content.includes(relPath)) {
      used = true;
      break;
    }
  }
  if (!used) {
    unusedSvgs.push(relPath);
  }
});

console.log(`Unused SVGs: ${unusedSvgs.length} of ${svgFiles.length}`);
console.log(unusedSvgs.slice(0, 30));

