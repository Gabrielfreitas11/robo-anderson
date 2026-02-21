@echo off
setlocal

REM Inicia o Upseller bot a partir da raiz do projeto.
REM Dica: crie um atalho deste .bat na Área de Trabalho.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."

echo [upseller] Diretorio: %cd%
echo [upseller] Iniciando com: npm start
echo.

call npm start

echo.
echo [upseller] O processo terminou.
pause
