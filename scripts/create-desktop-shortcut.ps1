# Cria um atalho na Area de Trabalho para iniciar o bot.
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1 -Instance loja1
#   powershell -ExecutionPolicy Bypass -File .\scripts\create-desktop-shortcut.ps1 -Instances loja1,loja2

param(
  # Modo compatível (cria 1 atalho)
  [string]$Instance = "",

  # Novo modo (cria vários atalhos de uma vez)
  [string[]]$Instances = @()
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Resolve-Path (Join-Path $ScriptDir "..")
$BatPath = Join-Path $ProjectDir "scripts\start-windows.bat"

if (!(Test-Path $BatPath)) {
  Write-Error "Nao encontrei: $BatPath"
  exit 1
}

$Desktop = [Environment]::GetFolderPath('Desktop')

function Normalize-Instance([string]$v) {
  if ($null -eq $v) { return "" }
  return $v.Trim()
}

$targets = @()
if ($Instances -and $Instances.Count -gt 0) {
  $targets = $Instances
} elseif ($Instance -and (Normalize-Instance $Instance).Length -gt 0) {
  $targets = @($Instance)
} else {
  # Padrão: cria os dois atalhos mais comuns
  $targets = @("loja1", "loja2")
}

# Normaliza/remove vazios/dup
$targets = $targets | ForEach-Object { Normalize-Instance $_ } | Where-Object { $_ -ne "" } | Select-Object -Unique

$WshShell = New-Object -ComObject WScript.Shell

foreach ($inst in $targets) {
  $isDefault = ($inst -eq "default")
  $ShortcutName = if (-not $isDefault) { "Upseller Bot ($inst)" } else { "Upseller Bot" }
  $ShortcutPath = Join-Path $Desktop ($ShortcutName + ".lnk")

  $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $BatPath
  $Shortcut.WorkingDirectory = $ProjectDir.Path
  $Shortcut.Arguments = if (-not $isDefault) { $inst } else { "" }
  $Shortcut.WindowStyle = 1
  $Shortcut.Description = "Inicia o Upseller Bot (npm start)"
  $Shortcut.Save()

  Write-Host "Atalho criado em: $ShortcutPath"
}
