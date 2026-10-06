// Uso: npm run backup  -> cria backups/AAAA-MM-DD-HH-MM/ com dashboard.db e a pasta uploads
const path = require('path'), fs = require('fs'), db = require('./db');
const ROOT = path.join(__dirname, '..');
const dest = path.join(ROOT, 'backups', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
fs.mkdirSync(dest, {recursive:true});
db.exec(`VACUUM INTO '${path.join(dest, 'dashboard.db').replace(/'/g, "''")}'`);
if (fs.existsSync(path.join(ROOT, 'uploads'))) fs.cpSync(path.join(ROOT, 'uploads'), path.join(dest, 'uploads'), {recursive:true});
console.log('Backup criado em: ' + dest);
