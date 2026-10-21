$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv')) {
  py -3 -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar ambiente Python.' }
  & .venv\Scripts\python.exe -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências.' }
}
if (Test-Path '.env') {
  Get-Content '.env' | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"').Trim("'"), 'Process')
    }
  }
}
& .venv\Scripts\python.exe -m service.app @args
exit $LASTEXITCODE
