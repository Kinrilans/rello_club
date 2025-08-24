param([string]$Conn)
if (-not $Conn) { $Conn = $env:DATABASE_URL }
if (-not $Conn) { throw "Set DATABASE_URL in .env or pass -Conn" }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$fname = "backup_$stamp.dump"
& pg_dump --no-owner --format=custom $Conn -f $fname
Write-Host "Backup: $fname"