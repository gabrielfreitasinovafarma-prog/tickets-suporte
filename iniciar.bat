@echo off
rem Para mudar a porta, altere o numero abaixo
set PORT=3000
rem Para atender somente um IP (ex.: o da rede da empresa), troque 0.0.0.0 pelo IP do servidor
set HOST=0.0.0.0
cd /d "%~dp0"
node src\server.js >> servidor.log 2>&1
