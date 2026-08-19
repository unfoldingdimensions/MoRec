const fs = require('fs');
const path = require('path');
const file = 'electron/ipc/register/settings.ts';
const content = fs.readFileSync(path.resolve('e:/New-Personal-Projects/MoRec', file), 'utf8');
const lines = content.split('\n');
console.log(lines.slice(305, 370).map((l, i) => (306 + i) + ': ' + l).join('\n'));
