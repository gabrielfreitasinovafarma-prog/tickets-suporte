# Central de Tickets (dashboard interno)

## 1. O que é
Dashboard web interno que cruza 3 planilhas (Fase 1, Fase 2, Tickets por Serviço) pelo CNPJ. O **ADMIN** envia as planilhas e atualiza os dados; os **USUÁRIOS** só visualizam o dashboard (com os mesmos filtros, gráficos e exportação para Excel). Tudo roda no servidor da empresa, sem internet depois de instalado. As permissões são verificadas no backend.

## 2. Tecnologias
Node.js + Express, SQLite (biblioteca `better-sqlite3`, embutida no projeto), bcryptjs (hash de senhas), multer (upload), SheetJS (`xlsx`, leitura das planilhas), ExcelJS (gera o Excel no navegador). Nenhuma biblioteca é carregada da internet pelo navegador.

## 3. Requisitos
- **Node.js 20 ou superior** (recomendado: versão LTS 22) — https://nodejs.org
- **Internet apenas durante o `npm install`** (uma vez). Se o servidor não tiver internet: rode `npm install` em outro computador com o mesmo sistema operacional e a mesma versão do Node, e copie a pasta inteira, incluindo `node_modules`.
- Não é preciso instalar SQLite, MySQL ou qualquer servidor de banco.

## 4–5. Instalação
1. Copie a pasta do projeto para o servidor (ex.: `C:\central-tickets` ou `/opt/central-tickets`).
2. Abra o terminal nessa pasta e rode:
```
npm install --omit=dev
```

## 6. Banco SQLite
Ao iniciar, o sistema cria sozinho `database/dashboard.db` e todas as tabelas (usuários, sessões, dados). Nada a configurar. As planilhas enviadas ficam em `uploads/`, que **não é servida pelo site** (acesso apenas pelo sistema de arquivos do servidor).

## 7–9. Primeiro uso
```
npm start
```
O terminal mostra os endereços, por exemplo `http://192.168.0.10:3000`. Abra esse endereço em um navegador da rede: como ainda não existe administrador, a tela pedirá a criação do **primeiro administrador** (nome, login, senha com 8+ caracteres). Depois disso, essa tela deixa de existir e todos entram com login e senha.

Os funcionários acessam o mesmo endereço pela rede interna, sem instalar nada. Se não abrir de outro computador, libere a porta no firewall:
- Windows (PowerShell como administrador): `New-NetFirewallRule -DisplayName "Central de Tickets" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Domain,Private`
- Linux (ufw): `sudo ufw allow from 192.168.0.0/24 to any port 3000`

## 10. Cadastrar usuários
Entre como admin → **Nova importação** (painel administrativo) → seção **Usuários**: cadastre, redefina senha ou exclua. Perfis: *Usuário* (só dashboard) e *Administrador*.

## 11. Enviar as planilhas
Painel administrativo → selecione as 3 planilhas (.xlsx, .xls ou .csv, até 20 MB cada) → **Atualizar Dashboard**. O sistema valida e processa tudo; só se as 3 estiverem corretas os dados são substituídos. Em caso de erro, aparece a mensagem (ex.: coluna faltando) e **os dados anteriores continuam intactos**. A data/hora da última atualização aparece no painel e no dashboard.

## 12. Backup
```
npm run backup
```
Cria `backups/AAAA-MM-DD-HH-MM/` com `dashboard.db` e a pasta `uploads`. Copie essa pasta `backups` para outro local/máquina. Fazer backup é copiar: `database/` (usuários + dados) e `uploads/` (planilhas originais, opcional).

## 13. Restaurar
1. Pare o sistema. 2. Apague `database/` do projeto e crie-a novamente com o `dashboard.db` do backup dentro (e restaure `uploads/`, se quiser). 3. Inicie o sistema.

## 14. Iniciar automaticamente
**Windows** (PowerShell como administrador; ajuste o caminho):
```
schtasks /create /tn "Central de Tickets" /tr "C:\central-tickets\iniciar.bat" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "Central de Tickets"
```
Log em `servidor.log`. Para parar: `taskkill /f /im node.exe`.

**Linux (systemd)**: ajuste `WorkingDirectory`, `User` e o caminho do node (`which node`) em `deploy/central-tickets.service`, e rode:
```
sudo cp deploy/central-tickets.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now central-tickets
```
Logs: `journalctl -u central-tickets -f`.

## 15. Alterar a porta
- Teste manual — Linux: `PORT=8080 npm start`; Windows (PowerShell): `$env:PORT=8080; npm start`.
- Permanente — Windows: altere `set PORT=3000` em `iniciar.bat`; Linux: `Environment=PORT=3000` no arquivo `.service`.

### Escolher o IP de acesso (HOST)
Por padrão o sistema atende em **todos** os IPs do servidor (rede da empresa, VPN, etc.); é a mesma aplicação e as mesmas telas em todos eles. Para atender somente um IP: `HOST=192.168.0.10 npm start` (Linux), `$env:HOST="192.168.0.10"; npm start` (PowerShell) ou altere `set HOST=` no `iniciar.bat`.

## 16. Problemas comuns
- **`npm install` falha em better-sqlite3**: use Node 20/22 LTS e confirme acesso à internet; ou instale em outra máquina do mesmo SO e copie `node_modules`.
- **Não abre de outro computador**: firewall (item 7–9) ou IP errado; confira o IP impresso ao iniciar.
- **"Porta em uso" (EADDRINUSE)**: outra aplicação usa a porta; troque (item 15).
- **Esqueci a senha do admin**: com outro admin, redefina em Usuários. Se for o único: pare o sistema, apague `database/dashboard.db` (perde usuários e dados; ou restaure um backup) e recrie o admin.
- **"coluna obrigatória não encontrada"**: confira os cabeçalhos da primeira linha da planilha.
- **Sessão expirada**: as sessões duram 8 horas; basta entrar de novo.

## Segurança — observações
Senhas com bcrypt; sessões em cookie HttpOnly/SameSite=Strict; bloqueio após 10 logins errados (15 min); upload validado por extensão, conteúdo e tamanho; rotas administrativas só para ADMIN. O acesso é **HTTP** (sem criptografia) — adequado para rede interna confiável; para HTTPS, coloque um proxy reverso (nginx/Caddy) na frente.
