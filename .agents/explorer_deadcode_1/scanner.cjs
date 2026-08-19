const fs = require('fs');
const path = require('path');

function getAllFiles(dir, exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git", "dist", "dist-electron", ".agents", "release", ".tmp", ".mimosa", "build"].includes(entry.name)) {
        results = results.concat(getAllFiles(full, exts));
      }
    } else if (exts.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

exports.getAllFiles = getAllFiles;