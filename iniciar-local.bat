@echo off
rem CatStudio - roda a versao local (sem internet depois da instalacao).
rem Requer Node.js 22 LTS (https://nodejs.org). Nao testado no Windows pelo autor do script.
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22 LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm ci || (pause & exit /b 1)
)
if not exist dist\index.html (
  echo Gerando o CatStudio...
  call npm run build || (pause & exit /b 1)
)
echo Abrindo o CatStudio em http://localhost:4173 ...
call npx vite preview --port 4173 --open
