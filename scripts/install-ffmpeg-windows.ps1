[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$existingFfmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
$existingFfprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if ($existingFfmpeg -and $existingFfprobe) {
    ffmpeg -version
    ffprobe -version
    exit 0
}

if (-not $env:RUNNER_TEMP) {
    throw "RUNNER_TEMP is required to install the pinned Windows FFmpeg build."
}
if (-not $env:GITHUB_PATH) {
    throw "GITHUB_PATH is required to expose the pinned Windows FFmpeg build."
}

$version = "9.0.2"
$archiveUrl = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-$version-essentials_build.zip"
$expectedSha256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
$archivePath = Join-Path $env:RUNNER_TEMP "ffmpeg-$version-essentials_build.zip"
$extractRoot = Join-Path $env:RUNNER_TEMP "ffmpeg-$version"

$downloaded = $false
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
        Write-Host "Downloading pinned FFmpeg $version archive (attempt $attempt/3)..."
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
        $downloaded = $true
        break
    }
    catch {
        if ($attempt -eq 3) {
            throw
        }
        Start-Sleep -Seconds (5 * $attempt)
    }
}

if (-not $downloaded) {
    throw "Unable to download pinned FFmpeg $version archive."
}

$actualSha256 = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "FFmpeg archive SHA-256 mismatch. Expected $expectedSha256 but received $actualSha256."
}

if (Test-Path $extractRoot) {
    Remove-Item -Path $extractRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
Expand-Archive -Path $archivePath -DestinationPath $extractRoot -Force

$ffmpegExe = Get-ChildItem -Path $extractRoot -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
if (-not $ffmpegExe) {
    throw "Downloaded FFmpeg archive did not contain ffmpeg.exe."
}

$binDirectory = $ffmpegExe.Directory.FullName
$ffprobeExe = Join-Path $binDirectory "ffprobe.exe"
if (-not (Test-Path $ffprobeExe -PathType Leaf)) {
    throw "Downloaded FFmpeg archive did not contain ffprobe.exe beside ffmpeg.exe."
}

$binDirectory | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
$env:PATH = "$binDirectory;$env:PATH"

& $ffmpegExe.FullName -version
& $ffprobeExe -version
