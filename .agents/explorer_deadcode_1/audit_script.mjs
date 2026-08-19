import fs from fs;
import path from path;

function getAllFiles(dir, exts = [.ts, .tsx, .js, .jsx, .mjs, .cjs, .css, .json, .html]) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (![node_modules, .git, dist, dist-electron, .agents, release, .mimosa, .tmp, build].includes(file)) {
        results = results.concat(getAllFiles(fullPath, exts));
      }
    } else {
      if (exts.some(ext => file.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const rootDir = process.cwd();
const allFiles = getAllFiles(rootDir);
console.log(Total scanned files in repo:, allFiles.length);

const allCodeFiles = allFiles.filter(f => /\.(tsx?|jsx?|mjs|cjs|html)$/.test(f));

// 1. Check all UI components in src/components/ui
const uiDir = path.join(rootDir, src, components, ui);
const uiFiles = fs.readdirSync(uiDir);
console.log(\n=== UI COMPONENTS USAGE ===);
for (const uiFile of uiFiles) {
  const baseName = uiFile.replace(/\.tsx?$/, ");
 const occurrences = [];
 for (const codeFile of allCodeFiles) {
 if (path.resolve(codeFile) === path.resolve(path.join(uiDir, uiFile))) continue;
 const content = fs.readFileSync(codeFile, utf8);
 if (content.includes(components/ui/) || content.includes(components/ui/) || content.includes(/ui/)) {
 occurrences.push(path.relative(rootDir, codeFile));
 }
 }
 console.log(${uiFile}: imports -> );
}
