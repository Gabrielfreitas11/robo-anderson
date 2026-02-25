@echo off
setlocal

REM Inicia o Upseller bot a partir da raiz do projeto.
REM Dica: crie um atalho deste .bat na Área de Trabalho.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."

set "INSTANCE=%~1"

if not "%INSTANCE%"=="" (
	set "UPSELLER_INSTANCE=%INSTANCE%"
)

echo [upseller] Diretorio: %cd%
if not "%INSTANCE%"=="" (
	echo [upseller] Instancia: %INSTANCE%
)
echo [upseller] Iniciando com: npm start
echo.

if not "%INSTANCE%"=="" (
	call npm start -- --instance %INSTANCE%
) else (
	call npm start
)

echo.
echo [upseller] O processo terminou.
pause
