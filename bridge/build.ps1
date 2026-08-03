$ErrorActionPreference = "Stop"
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outputDirectory = Join-Path $PSScriptRoot "dist"
$output = Join-Path $outputDirectory "PresentaBridge.exe"
$setupOutput = Join-Path $outputDirectory "PresentaBridgeSetup.exe"
$innoCompiler = Join-Path (Split-Path $PSScriptRoot -Parent) ".tools\Inno Setup 6\ISCC.exe"

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "No se encontró el compilador de .NET Framework incluido con Windows."
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& $compiler /nologo /target:winexe /platform:x64 /optimize+ `
    "/out:$output" `
    "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll `
    /reference:System.Windows.Forms.dll `
    (Join-Path $PSScriptRoot "PresentaBridge.cs")

if ($LASTEXITCODE -ne 0) { throw "La compilación de Presenta Bridge falló." }

if (-not (Test-Path -LiteralPath $innoCompiler)) {
    throw "No se encontró Inno Setup. Instálalo en .tools\Inno Setup 6 antes de crear el instalador."
}

& $innoCompiler (Join-Path $PSScriptRoot "PresentaBridge.iss")
if ($LASTEXITCODE -ne 0) { throw "La compilación del instalador estándar falló." }
Write-Output $output
Write-Output $setupOutput
