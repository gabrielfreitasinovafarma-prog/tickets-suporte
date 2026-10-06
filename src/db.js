const Database = require('better-sqlite3'), path = require('path'), fs = require('fs');
const dir = path.join(__dirname, '..', 'database');
fs.mkdirSync(dir, {recursive:true});
const db = new Database(path.join(dir, 'dashboard.db'));   // criado automaticamente se não existir
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL, perfil TEXT NOT NULL CHECK(perfil IN ('ADMIN','USUARIO')), criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessoes(token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, expira_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dados(id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL, atualizado_em TEXT NOT NULL, atualizado_por TEXT);
`);
module.exports = db;
