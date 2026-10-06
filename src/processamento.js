'use strict';
// Lógica de negócio do dashboard original (cruzamento por CNPJ, serviços dinâmicos, etc.), executada no servidor.
const XLSX = require('xlsx');
const FASE_COLS = {cnpj:'CNPJ', nome:'Nome da organização do solicitante', fase:'Fase da implantação', id:'ID do ticket', impl:'Implantador', tk:'Tickets'};
const CFG = {
  f1:{label:'Planilha Fase 1', titulo:'📄 Fase 1', cols:FASE_COLS},
  f2:{label:'Planilha Fase 2', titulo:'📄 Fase 2', cols:FASE_COLS},
  sv:{label:'Planilha Tickets por Serviço', titulo:'📄 Tickets por Serviço', cols:{cnpj:'CNPJ', srv:'N1-SERVIÇO 2° NIVEL', tk:'Tickets'}}
};
const state = {f1:null, f2:null, sv:null, out:null};
const $ = s => document.querySelector(s);
const fmt = n => Number(n).toLocaleString('pt-BR');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- Normalização ---------- */
function normTexto(s){ return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }

// CNPJ sempre como texto; se o Excel guardou como número, restaura zeros à esquerda (14 dígitos)
function normalizarCNPJ(v){
  let d = typeof v === 'number' ? String(Math.round(v)) : String(v ?? '').replace(/\D/g,'');
  if (!d) return '';
  return d.length < 14 ? d.padStart(14,'0') : d;
}
function formatarCNPJ(d){
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5') : d;
}
// Retorna número, ou NaN se inválido (vazio conta como 0)
function parseTickets(v){
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/\s/g,'');
  if (s === '') return 0;
  if (s.includes(',')) s = s.replace(/\./g,'').replace(',','.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/* ---------- Leitura e validação ---------- */
function lerBuffer(buf){
  const wb = XLSX.read(buf, {type:'buffer'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:'', blankrows:false});
}
function identificarColunas(header, cols){
  const nomes = header.map(normTexto), idx = {}, faltando = [];
  for (const k in cols){
    const i = nomes.indexOf(normTexto(cols[k]));
    if (i < 0) faltando.push(cols[k]); else idx[k] = i;
  }
  return {idx, faltando};
}
function validarPlanilha(key, rows){
  if (!rows.length) return {erro:'A planilha está vazia.'};
  const {idx, faltando} = identificarColunas(rows[0], CFG[key].cols);
  if (faltando.length) return {erro:`A coluna obrigatória "${faltando[0]}" não foi encontrada.` + (faltando.length>1 ? ` (Também faltam: ${faltando.slice(1).map(c=>'"'+c+'"').join(', ')}.)` : '')};
  return {idx, dados: rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''))};
}
/* ---------- Processamento ---------- */
function agruparPorCNPJ(key, label){
  const {idx, dados} = state[key], mapa = new Map(), avisos = {semCnpj:0, invalidos:[], conflitos:[]};
  dados.forEach((r, i) => {
    const linha = i + 2, cnpj = normalizarCNPJ(r[idx.cnpj]);
    if (!cnpj){ avisos.semCnpj++; return; }
    let tk = parseTickets(r[idx.tk]);
    if (isNaN(tk)){ avisos.invalidos.push(`${label}, linha ${linha}: Tickets = "${r[idx.tk]}"`); tk = 0; }
    const impl = String(r[idx.impl]).trim(), nome = String(r[idx.nome]).trim();
    const reg = mapa.get(cnpj) || {nome:'', impls:new Set(), tickets:0};
    if (!reg.nome) reg.nome = nome;
    if (impl) reg.impls.add(impl);
    reg.tickets += tk;
    mapa.set(cnpj, reg);
  });
  for (const [cnpj, reg] of mapa)
    if (reg.impls.size > 1) avisos.conflitos.push(`${label}: ${formatarCNPJ(cnpj)} tem implantadores diferentes (${[...reg.impls].join(' / ')})`);
  return {mapa, avisos};
}
const processarFase1 = () => agruparPorCNPJ('f1', 'Fase 1');
const processarFase2 = () => agruparPorCNPJ('f2', 'Fase 2');

function processarServicos(){
  const {idx, dados} = state.sv, porCnpj = new Map(), servicos = [], avisos = {semCnpj:0, invalidos:[]};
  dados.forEach((r, i) => {
    const cnpj = normalizarCNPJ(r[idx.cnpj]);
    if (!cnpj){ avisos.semCnpj++; return; }
    let tk = parseTickets(r[idx.tk]);
    if (isNaN(tk)){ avisos.invalidos.push(`Serviços, linha ${i+2}: Tickets = "${r[idx.tk]}"`); tk = 0; }
    const srv = String(r[idx.srv]).trim() || '(Sem serviço)';
    if (!servicos.includes(srv)) servicos.push(srv);
    if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, new Map());
    const m = porCnpj.get(cnpj);
    m.set(srv, (m.get(srv) || 0) + tk);
  });
  return {porCnpj, servicos, avisos};
}

function gerarConsolidado(f1, f2, sv){
  const cnpjs = new Set([...f1.mapa.keys(), ...f2.mapa.keys()]);
  const linhas = [...cnpjs].map(c => {
    const a = f1.mapa.get(c), b = f2.mapa.get(c), s = sv.porCnpj.get(c);
    const t1 = a ? a.tickets : 0, t2 = b ? b.tickets : 0;
    return {
      cnpj:formatarCNPJ(c), nome:(a && a.nome) || (b && b.nome) || '',
      fase: a && b ? 'Fase 1 + Fase 2' : a ? 'Fase 1' : 'Fase 2',
      r1:a ? [...a.impls].join(' / ') : '', t1, r2:b ? [...b.impls].join(' / ') : '', t2, total:t1 + t2,
      srv:sv.servicos.map(n => (s && s.get(n)) || 0), _a:!!a, _b:!!b, _c:c
    };
  }).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  return {linhas, servicos:sv.servicos};
}

function gerarResumo(cons, sv){
  const L = cons.linhas, soma = f => L.reduce((s, l) => s + f(l), 0);
  const porSrv = cons.servicos.map((n, i) => ({nome:n, tickets:soma(l => l.srv[i])})).sort((a, b) => b.tickets - a.tickets);
  const t1 = soma(l => l.t1), t2 = soma(l => l.t2);
  return {total:L.length, c1:L.filter(l => l._a).length, c2:L.filter(l => l._b).length, ambas:L.filter(l => l._a && l._b).length, t1, t2, geral:t1 + t2, porSrv};
}


function processarTudo(bufs){
  for (const k of ['f1','f2','sv']){
    state[k] = null;
    let rows;
    try { rows = lerBuffer(bufs[k]); }
    catch(e){ throw new Error(`⚠️ Não foi possível ler a ${CFG[k].label}. Verifique se é um arquivo .xlsx, .xls ou .csv válido.`); }
    const v = validarPlanilha(k, rows);
    if (v.erro) throw new Error(`⚠️ Não foi possível processar a ${CFG[k].label}. ${v.erro}`);
    state[k] = v;
  }
  const f1 = processarFase1(), f2 = processarFase2(), sv = processarServicos();
  const cons = gerarConsolidado(f1, f2, sv), res = gerarResumo(cons, sv), avisos = [];
  [['Fase 1', f1.avisos], ['Fase 2', f2.avisos], ['Serviços', sv.avisos]].forEach(([n, a]) => {
    if (a.semCnpj) avisos.push(`${n}: ${a.semCnpj} linha(s) ignorada(s) por falta de CNPJ.`);
    a.invalidos.slice(0, 10).forEach(x => avisos.push(`Valor de Tickets inválido (tratado como 0) — ${x}`));
    if (a.invalidos.length > 10) avisos.push(`${n}: mais ${a.invalidos.length - 10} valores de Tickets inválidos.`);
    (a.conflitos || []).slice(0, 10).forEach(x => avisos.push(`Conflito de responsável — ${x}`));
    if ((a.conflitos || []).length > 10) avisos.push(`${n}: mais ${a.conflitos.length - 10} conflitos de responsável.`);
  });
  const fora = [...sv.porCnpj.keys()].filter(c => !f1.mapa.has(c) && !f2.mapa.has(c));
  if (fora.length) avisos.push(`${fora.length} CNPJ(s) da planilha de serviços não constam na Fase 1 nem na Fase 2; aparecem como "Sem fase" (os tickets deles estão contados nos serviços).`);
  // CNPJs que só existem na planilha de serviços: entram nos totais por serviço, como "Sem fase"
  cons.foraFases = fora.sort().map(c => { const m = sv.porCnpj.get(c); return {cnpj:formatarCNPJ(c), nome:'(não consta na Fase 1 nem na Fase 2)', fase:'Sem fase', r1:'', t1:0, r2:'', t2:0, total:0, srv:sv.servicos.map(n => m.get(n) || 0), _a:false, _b:false, _c:c}; });
  const todos = cons.linhas.concat(cons.foraFases);
  res.porSrv = sv.servicos.map((n, i) => ({nome:n, tickets:todos.reduce((a, l) => a + l.srv[i], 0)})).sort((a, b) => b.tickets - a.tickets);
  todos.forEach((l, i) => { l._i = i; l._s = l.srv.reduce((a, b) => a + b, 0); });
  return {cons, res, avisos};
}
module.exports = {processarTudo};
