const fs = require('fs');
const path = require('path');

const orphans = [
  "bluerays.jpeg",
  "cherrypop.jpg",
  "farmvalley.jpg",
  "lemonade.jpeg",
  "luisdelrio.jpg",
  "mountaintrees.jpg",
  "wallpaper1.jpg",
  "wallpaper2.jpg",
  "wallpaper7.jpg",
  "wallpaper9.jpg",
  "wallpaper11.jpg",
  "wallpaper12.jpg",
  "wallpaper13.jpg",
  "wallpaper15.jpg"
];

let totalBytes = 0;
orphans.forEach(f => {
  const p = path.join('public', 'wallpapers', f);
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    totalBytes += stat.size;
    console.log(f + ': ' + (stat.size / 1024).toFixed(1) + ' KB');
  }
});

console.log('Total orphaned wallpapers size: ' + (totalBytes / (1024 * 1024)).toFixed(2) + ' MB');
