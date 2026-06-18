param(
    [ValidateSet("windows-x64", "macos-arm64", "macos-x64")]
    [string]$Target = "windows-x64",

    [string]$PythonStandaloneUrl = $env:FRAMEQ_PYTHON_STANDALONE_URL,
    [string]$FfmpegArchiveUrl = $env:FRAMEQ_FFMPEG_ARCHIVE_URL,
    [string]$SenseVoiceModelDir = $env:FRAMEQ_SENSEVOICE_MODEL_DIR,
    [switch]$SkipDownloads,
    [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appRoot = Join-Path $repoRoot "app"
$tauriRoot = Join-Path $appRoot "src-tauri"
$resourcesRoot = Join-Path $tauriRoot "resources"
$buildRoot = Join-Path $repoRoot "build" "installer-runtime" $Target
$pythonRoot = Join-Path $resourcesRoot "python"
$workerRoot = Join-Path $resourcesRoot "worker"
$binRoot = Join-Path $resourcesRoot "bin"
$modelsRoot = Join-Path $resourcesRoot "models"

function Reset-Directory {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Require-FileOrUrl {
    param(
        [string]$Value,
        [string]$Name
    )
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required. Pass the parameter or set the matching FRAMEQ_* environment variable."
    }
}

function Download-Archive {
    param(
        [string]$Url,
        [string]$Destination
    )
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Get-ArchiveLeafName {
    param(
        [string]$Value,
        [string]$FallbackName
    )

    if (Test-Path -LiteralPath $Value) {
        $leaf = Split-Path -Leaf $Value
    } else {
        try {
            $leaf = [System.IO.Path]::GetFileName(([Uri]$Value).LocalPath)
        } catch {
            $leaf = ""
        }
    }

    if ([string]::IsNullOrWhiteSpace($leaf)) {
        return $FallbackName
    }
    return $leaf
}

function Prepare-ArchiveInput {
    param(
        [string]$Value,
        [string]$DestinationDirectory,
        [string]$FallbackName
    )

    $archivePath = Join-Path $DestinationDirectory (Get-ArchiveLeafName $Value $FallbackName)
    if (Test-Path -LiteralPath $Value) {
        Copy-Item -LiteralPath $Value -Destination $archivePath -Force
    } else {
        Download-Archive $Value $archivePath
    }
    return $archivePath
}

function Expand-ArchiveFile {
    param(
        [string]$Archive,
        [string]$Destination
    )
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    if ($Archive.ToLowerInvariant().EndsWith(".zip")) {
        Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
        return
    }

    tar -xf $Archive -C $Destination
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract archive with tar: $Archive"
    }
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )
    if (!(Test-Path $Source)) {
        throw "Source directory not found: $Source"
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Find-PythonExecutable {
    param([string]$Root)
    $windowsPython = Join-Path $Root "python.exe"
    $unixPython = Join-Path $Root "bin" "python3"
    if (Test-Path $windowsPython) {
        return $windowsPython
    }
    if (Test-Path $unixPython) {
        return $unixPython
    }
    throw "Could not find bundled Python executable under $Root"
}

function Copy-StandalonePythonFromArchive {
    param(
        [string]$Archive,
        [string]$Destination
    )

    $extractRoot = Join-Path (Split-Path -Parent $Archive) "python-extract"
    Reset-Directory $extractRoot
    Expand-ArchiveFile $Archive $extractRoot

    $pythonExe = Get-ChildItem -Path $extractRoot -Recurse -File |
        Where-Object { $_.Name -eq "python.exe" -or $_.Name -eq "python3" } |
        Select-Object -First 1
    if ($null -eq $pythonExe) {
        throw "Python executable was not found in the standalone archive."
    }

    if ($pythonExe.Directory.Name -eq "bin") {
        $runtimeRoot = $pythonExe.Directory.Parent.FullName
    } else {
        $runtimeRoot = $pythonExe.Directory.FullName
    }

    Copy-DirectoryContents $runtimeRoot $Destination
}

function Copy-FfmpegFromArchive {
    param(
        [string]$Archive,
        [string]$Destination,
        [string]$Target
    )

    $extractRoot = Join-Path (Split-Path -Parent $Archive) "ffmpeg"
    Reset-Directory $extractRoot
    Expand-ArchiveFile $Archive $extractRoot

    if ($Target -eq "windows-x64") {
        $requiredBinaries = @("ffmpeg.exe", "ffprobe.exe")
    } else {
        $requiredBinaries = @("ffmpeg", "ffprobe")
    }

    foreach ($binaryName in $requiredBinaries) {
        $binary = Get-ChildItem -Path $extractRoot -Recurse -File |
            Where-Object { $_.Name -eq $binaryName } |
            Select-Object -First 1
        if ($null -eq $binary) {
            throw "$binaryName was not found in the ffmpeg archive."
        }
        Copy-Item -LiteralPath $binary.FullName -Destination $Destination -Force
    }

    if ($Target -ne "windows-x64" -and (Get-Command chmod -ErrorAction SilentlyContinue)) {
        chmod +x (Join-Path $Destination "ffmpeg") (Join-Path $Destination "ffprobe")
    }
}

Reset-Directory $resourcesRoot
Reset-Directory $buildRoot
New-Item -ItemType Directory -Force -Path $pythonRoot, $workerRoot, $binRoot, $modelsRoot | Out-Null

if (!$SkipDownloads) {
    Require-FileOrUrl $PythonStandaloneUrl "PythonStandaloneUrl"
    $pythonArchive = Prepare-ArchiveInput $PythonStandaloneUrl $buildRoot "python-standalone.archive"
    Copy-StandalonePythonFromArchive $pythonArchive $pythonRoot

    Require-FileOrUrl $FfmpegArchiveUrl "FfmpegArchiveUrl"
    $ffmpegArchive = Prepare-ArchiveInput $FfmpegArchiveUrl $buildRoot "ffmpeg.archive"
    Copy-FfmpegFromArchive $ffmpegArchive $binRoot $Target
}

Copy-DirectoryContents (Join-Path $repoRoot "worker") $workerRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "pyproject.toml") -Destination (Join-Path $resourcesRoot "pyproject.toml") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot ".env.example") -Destination (Join-Path $resourcesRoot ".env.template") -Force

if ([string]::IsNullOrWhiteSpace($SenseVoiceModelDir)) {
    Write-Host "FRAMEQ_SENSEVOICE_MODEL_DIR not set. Model resources will be empty; clean-machine ASR smoke will fail until models are copied."
} else {
    Copy-DirectoryContents $SenseVoiceModelDir $modelsRoot
    "model=iic/SenseVoiceSmall`ntarget=$Target`nbuilt_at=$(Get-Date -Format o)" |
        Set-Content -Encoding UTF8 -Path (Join-Path $modelsRoot "MODEL_VERSION.txt")
}

$pythonExe = Find-PythonExecutable $pythonRoot
$requirementsPath = Join-Path $buildRoot "requirements.txt"
uv export --no-dev --format requirements-txt --output-file $requirementsPath
& $pythonExe -m ensurepip --upgrade
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r $requirementsPath
$env:PYTHONPATH = $workerRoot
& $pythonExe -c "import funasr, modelscope, yt_dlp; import frameq_worker"

if (!$SkipTauriBuild) {
    npm --prefix $appRoot install
    npm --prefix $appRoot run tauri -- build
}

Write-Host "FrameQ installer resources prepared at $resourcesRoot"
