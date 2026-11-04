$ErrorActionPreference = 'Stop'
$state = Join-Path $env:LOCALAPPDATA 'swapper-vod-harvest'
New-Item -ItemType Directory -Force -Path $state | Out-Null
# An OS file handle releases on crash/reboot; the file's age never decides ownership.
try { $lock = [IO.File]::Open((Join-Path $state 'harvest.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { exit 0 }
try {
    & (Get-Command node.exe).Source (Join-Path $PSScriptRoot 'harvest-loop.mjs') *>> (Join-Path $state 'harvest.log')
    exit $LASTEXITCODE
} finally { $lock.Dispose() }
