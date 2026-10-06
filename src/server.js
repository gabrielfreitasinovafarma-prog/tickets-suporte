'use strict';
const express = require('express'), path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const multer = require('multer'), bcrypt = require('bcryptjs');
const db = require('./db'), {processarTudo} = require('./processamento');
const ROOT = path.join(__dirname, '..'), UP = path.join(ROOT, 'uploads'); // uploads/ nunca é servida diretamente
const PORT = Number(process.env.PORT) || 3000, HOST = process.env.HOST || '0.0.0.0', SESSAO_MS = 8 * 3600 * 1000;
fs.mkdirSync(UP, {recursive:true});

const app = express(); app.disable('x-powered-by');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const getCookie = (req, n) => ((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(c => c[0] === n) || [])[1];
const isApi = req => req.originalUrl.startsWith('/api');

app.use((req, res, next) => {
  res.set({'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer'});
  if (isApi(req)) res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.headers.origin) {            // proteção CSRF extra (além de SameSite=Strict)
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({erro:'Origem não permitida.'}); }
    catch { return res.status(403).json({erro:'Origem inválida.'}); }
  }
  next();
});
app.use(express.json({limit:'100kb'}));

/* ----- autenticação / sessão ----- */
function auth(req, res, next){
  const t = getCookie(req, 'sid');
  const u = t && db.prepare('SELECT u.id, u.nome, u.login, u.perfil FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira_em > ?').get(sha(t), Date.now());
  if (u){ req.user = u; return next(); }
  return isApi(req) ? res.status(401).json({erro:'Sessão expirada. Faça login novamente.'}) : res.redirect('/login');
}
const adm = (req, res, next) => req.user.perfil === 'ADMIN' ? next() : (isApi(req) ? res.status(403).json({erro:'Acesso restrito ao administrador.'}) : res.redirect('/'));
function abrirSessao(res, uid){
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes VALUES (?,?,?)').run(sha(token), uid, Date.now() + SESSAO_MS);
  res.cookie('sid', token, {httpOnly:true, sameSite:'strict', maxAge:SESSAO_MS, path:'/'});
}
const limpar = () => db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
limpar(); setInterval(limpar, 3600 * 1000).unref();

const falhas = new Map();
const temAdmin = () => !!db.prepare("SELECT 1 FROM usuarios WHERE perfil = 'ADMIN'").get();
function validarNovo({nome, login, senha, perfil}){
  if (!String(nome || '').trim()) return 'Informe o nome.';
  if (!/^[\w.@-]{3,40}$/.test(String(login || ''))) return 'Login deve ter 3 a 40 caracteres (letras, números, . _ - @).';
  if (String(senha || '').length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!['ADMIN','USUARIO'].includes(perfil)) return 'Perfil inválido.';
}
function criarUsuario(b){
  const e = validarNovo(b); if (e) return {erro:e};
  try {
    const r = db.prepare('INSERT INTO usuarios(nome, login, senha_hash, perfil, criado_em) VALUES (?,?,?,?,?)')
      .run(String(b.nome).trim(), String(b.login), bcrypt.hashSync(String(b.senha), 10), b.perfil, new Date().toISOString());
    return {id:Number(r.lastInsertRowid)};
  } catch { return {erro:'Já existe um usuário com esse login.'}; }
}

app.get('/api/status', (q, r) => r.json({precisaSetup:!temAdmin()}));
app.post('/api/setup', (req, res) => {
  if (temAdmin()) return res.status(403).json({erro:'O administrador já foi criado.'});
  const c = criarUsuario({...req.body, perfil:'ADMIN'});
  if (c.erro) return res.status(400).json({erro:c.erro});
  abrirSessao(res, c.id); res.json({ok:true});
});
app.post('/api/login', (req, res) => {
  const f = falhas.get(req.ip);
  if (f && f.n >= 10 && f.ate > Date.now()) return res.status(429).json({erro:'Muitas tentativas. Aguarde 15 minutos.'});
  const {login = '', senha = ''} = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ?').get(String(login).trim());
  if (!u || !bcrypt.compareSync(String(senha), u.senha_hash)){
    falhas.set(req.ip, {n:(f && f.ate > Date.now() ? f.n : 0) + 1, ate:Date.now() + 15 * 60000});
    return res.status(401).json({erro:'Login ou senha incorretos.'});
  }
  falhas.delete(req.ip); abrirSessao(res, u.id); res.json({perfil:u.perfil});
});
app.post('/api/logout', (req, res) => {
  const t = getCookie(req, 'sid'); if (t) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(sha(t));
  res.clearCookie('sid'); res.json({ok:true});
});
app.get('/api/me', auth, (req, res) => res.json(req.user));

/* ----- dados do dashboard (qualquer usuário logado, somente leitura) ----- */
app.get('/api/dados', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM dados WHERE id = 1').get();
  if (!d) return res.status(404).json({erro:'Nenhum dado importado.'});
  res.json({...JSON.parse(d.json), atualizadoEm:d.atualizado_em, atualizadoPor:d.atualizado_por});
});

/* ----- administração ----- */
app.get('/api/admin/info', auth, adm, (req, res) => {
  const d = db.prepare('SELECT atualizado_em, atualizado_por FROM dados WHERE id = 1').get();
  res.json({atualizadoEm:d && d.atualizado_em, atualizadoPor:d && d.atualizado_por});
});
const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:20 * 1024 * 1024, files:3},
  fileFilter:(q, f, cb) => cb(null, /\.(xlsx|xls|csv)$/i.test(f.originalname))})
  .fields([{name:'f1', maxCount:1}, {name:'f2', maxCount:1}, {name:'sv', maxCount:1}]);
function conteudoValido(buf, ext){                 // confere o conteúdo real, não só a extensão
  if (ext === '.xlsx') return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B;
  if (ext === '.xls') return buf.length > 4 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
  return !buf.subarray(0, 4096).includes(0);
}
const NOMES = {f1:'fase1', f2:'fase2', sv:'servicos'};
app.post('/api/admin/atualizar', auth, adm, (req, res) => {
  upload(req, res, err => {
    if (err) return res.status(400).json({erro:'Falha no envio dos arquivos: ' + err.message});
    const bufs = {}, exts = {};
    for (const k of ['f1','f2','sv']){
      const f = req.files && req.files[k] && req.files[k][0];
      if (!f) return res.status(400).json({erro:'Envie as 3 planilhas (formatos aceitos: .xlsx, .xls, .csv).'});
      const ext = path.extname(f.originalname).toLowerCase();
      if (!conteudoValido(f.buffer, ext)) return res.status(400).json({erro:`O arquivo "${f.originalname}" não parece ser uma planilha ${ext} válida.`});
      bufs[k] = f.buffer; exts[k] = ext;
    }
    let out;
    try { out = processarTudo(bufs); }                 // se falhar, nada é alterado
    catch(e){ return res.status(422).json({erro:e.message}); }
    const agora = new Date().toISOString();
    db.prepare(`INSERT INTO dados(id, json, atualizado_em, atualizado_por) VALUES (1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`)
      .run(JSON.stringify(out), agora, req.user.login);
    try {                                              // guarda as planilhas originais (pasta protegida)
      for (const k of ['f1','f2','sv']){
        for (const e of ['.xlsx','.xls','.csv']) fs.rmSync(path.join(UP, NOMES[k] + e), {force:true});
        fs.writeFileSync(path.join(UP, NOMES[k] + exts[k]), bufs[k]);
      }
    } catch(e){ console.error('Aviso: não foi possível arquivar as planilhas:', e.message); }
    res.json({ok:true, atualizadoEm:agora, clientes:out.res.total, tickets:out.res.porSrv.reduce((a, s) => a + s.tickets, 0), servicos:out.cons.servicos.length, avisos:out.avisos});
  });
});
app.get('/api/admin/usuarios', auth, adm, (q, r) => r.json(db.prepare('SELECT id, nome, login, perfil, criado_em FROM usuarios ORDER BY nome').all()));
app.post('/api/admin/usuarios', auth, adm, (req, res) => {
  const c = criarUsuario(req.body || {}); c.erro ? res.status(400).json({erro:c.erro}) : res.json({ok:true});
});
app.post('/api/admin/usuarios/:id/senha', auth, adm, (req, res) => {
  const s = String((req.body || {}).senha || '');
  if (s.length < 8) return res.status(400).json({erro:'A senha deve ter pelo menos 8 caracteres.'});
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(s, 10), req.params.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(req.params.id); res.json({ok:true});
});
app.delete('/api/admin/usuarios/:id', auth, adm, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({erro:'Você não pode excluir o próprio usuário.'});
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id); res.json({ok:true});
});

/* ----- páginas ----- */
const page = (...p) => (q, r) => r.sendFile(path.join(ROOT, ...p));
app.get('/login', page('public', 'login.html'));
app.get('/', auth, page('views', 'dashboard.html'));
app.get('/admin', auth, adm, page('views', 'admin.html'));
app.get('/vendor/exceljs.min.js', page('node_modules', 'exceljs', 'dist', 'exceljs.min.js'));  // sem CDN: funciona sem internet
app.use(express.static(path.join(ROOT, 'public'), {index:false}));
app.use((q, r) => r.status(404).send('Não encontrado'));

app.listen(PORT, HOST, () => {
  console.log(`Central de Tickets rodando na porta ${PORT}`);
  if (HOST !== '0.0.0.0') return console.log(`  Acesse em: http://${HOST}:${PORT}`);
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`  Disponível em: http://${l.address}:${PORT}`);
});
