# Cria um atalho na Area de Trabalho para iniciar o bot.
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Resolve-Path (Join-Path $ScriptDir "..")
$BatPath = Join-Path $ProjectDir "scripts\start-windows.bat"

if (!(Test-Path $BatPath)) {
  Write-Error "Nao encontrei: $BatPath"
  exit 1
}

$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop "Upseller Bot.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatPath
$Shortcut.WorkingDirectory = $ProjectDir.Path
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Inicia o Upseller Bot (npm start)"
$Shortcut.Save()

Write-Host "Atalho criado em: $ShortcutPath"
