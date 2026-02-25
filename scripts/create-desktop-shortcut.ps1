# Cria um atalho na Area de Trabalho para iniciar o bot.
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1

param(
  [string]$Instance = ""
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Resolve-Path (Join-Path $ScriptDir "..")
$BatPath = Join-Path $ProjectDir "scripts\start-windows.bat"

if (!(Test-Path $BatPath)) {
  Write-Error "Nao encontrei: $BatPath"
  exit 1
}

$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutName = if ($Instance -and $Instance.Trim().Length -gt 0 -and $Instance -ne "default") { "Upseller Bot ($Instance)" } else { "Upseller Bot" }
$ShortcutPath = Join-Path $Desktop ($ShortcutName + ".lnk")

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatPath
$Shortcut.WorkingDirectory = $ProjectDir.Path
$Shortcut.Arguments = if ($Instance -and $Instance.Trim().Length -gt 0 -and $Instance -ne "default") { $Instance } else { "" }
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Inicia o Upseller Bot (npm start)"
$Shortcut.Save()

Write-Host "Atalho criado em: $ShortcutPath"
