const fs = require('fs');
const path = require('path');

const projectRoot = 'e:/New-Personal-Projects/MoRec';

function findFiles(dir, matchStr) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'dist-electron') {
        results = results.concat(findFiles(full, matchStr));
      }
    } else {
      if (entry.name.toLowerCase().includes(matchStr.toLowerCase())) {
        results.push(full);
      }
    }
  }
  return results;
}

console.log('Searching for TimelineToolbar:', findFiles(projectRoot, 'TimelineToolbar'));
console.log('Searching for popovers index:', findFiles(path.join(projectRoot, 'src/components/launch'), 'index'));
console.log('Searching for timeline index:', findFiles(path.join(projectRoot, 'src/components/video-editor/timeline'), 'index'));

