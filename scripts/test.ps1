$ErrorActionPreference = 'Stop'

& .\node_modules\.bin\tsc.cmd --ignoreConfig --target ES2022 --module Node16 --moduleResolution Node16 --resolveJsonModule --esModuleInterop --skipLibCheck --strict --outDir .test-output src\domain.ts src\theme.ts src\i18n.ts src\desktopIntegration.ts src\courseSchedule.ts src\scheduleView.ts src\validation.ts src\courseImport.ts src\timetableParser.ts src\mobileTimetableParser.ts src\importParsers.ts src\backupFormat.ts src\backupFiles.ts src\database.ts
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$testTempDirectory = (Resolve-Path .\.test-output).Path
$env:TEMP = $testTempDirectory
$env:TMP = $testTempDirectory

node --test tests\*.test.cjs
exit $LASTEXITCODE
