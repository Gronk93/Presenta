$ErrorActionPreference = "Stop"

$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$buildTools = Join-Path $sdk "build-tools\36.1.0"
$androidJar = Join-Path $sdk "platforms\android-36.1\android.jar"
$javaHome = "C:\Program Files\Android\Android Studio\jbr"
$env:JAVA_HOME = $javaHome
$javac = Join-Path $javaHome "bin\javac.exe"
$jar = Join-Path $javaHome "bin\jar.exe"
$keytool = Join-Path $javaHome "bin\keytool.exe"
$aapt = Join-Path $buildTools "aapt.exe"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$d8 = Join-Path $buildTools "d8.bat"
$zipalign = Join-Path $buildTools "zipalign.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"

@($androidJar, $javac, $jar, $keytool, $aapt, $aapt2, $d8, $zipalign, $apksigner) | ForEach-Object {
    if (-not (Test-Path -LiteralPath $_)) { throw "Falta la herramienta requerida: $_" }
}

$nativeRoot = "C:\tmp\presenta-android-build"
$resolvedTemp = [IO.Path]::GetFullPath($nativeRoot)
if (-not $resolvedTemp.StartsWith("C:\tmp\", [StringComparison]::OrdinalIgnoreCase)) { throw "Ruta temporal no segura." }
if (Test-Path -LiteralPath $resolvedTemp) { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
New-Item -ItemType Directory -Path $resolvedTemp -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "src") -Destination (Join-Path $resolvedTemp "src") -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "res") -Destination (Join-Path $resolvedTemp "res") -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "AndroidManifest.xml") -Destination (Join-Path $resolvedTemp "AndroidManifest.xml")

$build = Join-Path $nativeRoot "build"
$classes = Join-Path $build "classes"
$dex = Join-Path $build "dex"
$dist = Join-Path $PSScriptRoot "dist"
$signing = Join-Path $PSScriptRoot ".signing"
$compiledResources = Join-Path $build "resources.zip"
$classJar = Join-Path $build "classes.jar"
$baseApk = Join-Path $build "PresentaAndroid-base.apk"
$alignedApk = Join-Path $build "PresentaAndroid-aligned.apk"
$nativeFinalApk = Join-Path $nativeRoot "PresentaAndroid.apk"
$finalApk = Join-Path $dist "PresentaAndroid.apk"
$keyStore = Join-Path $signing "presenta-android.keystore"
$passwordFile = Join-Path $signing "password.txt"
$keyPasswordFile = Join-Path $signing "key-password.txt"

if (Test-Path -LiteralPath $build) { Remove-Item -LiteralPath $build -Recurse -Force }
New-Item -ItemType Directory -Path $classes, $dex, $dist, $signing -Force | Out-Null

if (-not (Test-Path -LiteralPath $keyStore)) {
    $keyPassword = [Guid]::NewGuid().ToString("N")
    [IO.File]::WriteAllText($passwordFile, $keyPassword)
    & $keytool -genkeypair -keystore $keyStore -storepass $keyPassword -keypass $keyPassword -alias presenta -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Presenta Android, O=Presenta, C=MX"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la firma del APK." }
}
if (-not (Test-Path -LiteralPath $passwordFile)) { throw "Falta android\.signing\password.txt; conserva este archivo junto con la firma." }
Copy-Item -LiteralPath $passwordFile -Destination $keyPasswordFile -Force

& $aapt2 compile --dir (Join-Path $nativeRoot "res") -o $compiledResources
if ($LASTEXITCODE -ne 0) { throw "Falló la compilación de recursos Android." }

& $aapt2 link -o $baseApk -I $androidJar --manifest (Join-Path $nativeRoot "AndroidManifest.xml") --min-sdk-version 26 --target-sdk-version 36 --version-code 6 --version-name "0.6.0" $compiledResources
if ($LASTEXITCODE -ne 0) { throw "Falló el empaquetado base del APK." }

$sources = Get-ChildItem -LiteralPath (Join-Path $nativeRoot "src") -Filter "*.java" -Recurse | ForEach-Object FullName
& $javac -encoding UTF-8 -source 11 -target 11 -classpath $androidJar -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw "Falló la compilación Java de Presenta Android." }

& $jar cf $classJar -C $classes .
if ($LASTEXITCODE -ne 0) { throw "No se pudieron agrupar las clases Android." }
& $d8 --lib $androidJar --min-api 26 --output $dex $classJar
if ($LASTEXITCODE -ne 0) { throw "Falló la conversión DEX." }

Push-Location $dex
try {
    & $aapt add $baseApk "classes.dex"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo agregar classes.dex al APK." }
}
finally { Pop-Location }

& $zipalign -f -p 4 $baseApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "Falló zipalign." }
& $apksigner sign --ks $keyStore --ks-key-alias presenta --ks-pass "file:$passwordFile" --key-pass "file:$keyPasswordFile" --out $nativeFinalApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "Falló la firma del APK." }
& $apksigner verify --verbose $nativeFinalApk
if ($LASTEXITCODE -ne 0) { throw "La verificación de firma del APK falló." }

$null = New-Item -ItemType Directory -Path $dist -Force
Copy-Item -LiteralPath $nativeFinalApk -Destination $finalApk -Force
$publicDownload = Join-Path (Split-Path $PSScriptRoot -Parent) "public\downloads\PresentaAndroid.apk"
Copy-Item -LiteralPath $finalApk -Destination $publicDownload -Force
Write-Output $finalApk
Write-Output $publicDownload
