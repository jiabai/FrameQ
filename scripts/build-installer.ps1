param(
    [ValidateSet("windows-x64", "macos-arm64", "macos-x64")]
    [string]$Target = "windows-x64",

    [string]$PythonStandaloneUrl = $env:FRAMEQ_PYTHON_STANDALONE_URL,
    [string]$FfmpegArchiveUrl = $env:FRAMEQ_FFMPEG_ARCHIVE_URL,
    [switch]$SkipDownloads,
    [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appRoot = Join-Path $repoRoot "app"
$tauriRoot = Join-Path $appRoot "src-tauri"
$resourcesRoot = Join-Path $tauriRoot "resources"
$buildRoot = Join-Path (Join-Path (Join-Path $repoRoot "build") "installer-runtime") $Target
$pythonRoot = Join-Path $resourcesRoot "python"
$workerRoot = Join-Path $resourcesRoot "worker"
$binRoot = Join-Path $resourcesRoot "bin"

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

function Assert-LastCommandSucceeded {
    param([string]$Description)

    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Join-PathParts {
    param(
        [string]$Root,
        [string[]]$Parts
    )

    $resolved = $Root
    foreach ($part in $Parts) {
        $resolved = Join-Path $resolved $part
    }
    return $resolved
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

function Ensure-GitKeep {
    param([string]$Path)

    [System.IO.File]::WriteAllText((Join-Path $Path ".gitkeep"), "`r`n")
}

function Find-PythonExecutable {
    param([string]$Root)
    $windowsPython = Join-Path $Root "python.exe"
    $unixPython = Join-Path (Join-Path $Root "bin") "python3"
    if (Test-Path $windowsPython) {
        return $windowsPython
    }
    if (Test-Path $unixPython) {
        return $unixPython
    }
    throw "Could not find bundled Python executable under $Root"
}

function Resolve-TauriTargetTriple {
    param([string]$Target)
    switch ($Target) {
        "windows-x64" { "x86_64-pc-windows-msvc" }
        "macos-arm64" { "aarch64-apple-darwin" }
        "macos-x64" { "x86_64-apple-darwin" }
        default { throw "Unsupported target: $Target" }
    }
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

function Prune-BundledPythonRuntime {
    param([string]$PythonRoot)

    foreach ($pattern in @("*.pdb", "*.lib", "*.pyc", "*.pyo", "*.h", "*.hpp")) {
        Get-ChildItem -LiteralPath $PythonRoot -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
            Remove-Item -Force
    }

    foreach ($directoryName in @("__pycache__", "tests", "test")) {
        Get-ChildItem -LiteralPath $PythonRoot -Recurse -Directory -Filter $directoryName -ErrorAction SilentlyContinue |
            Sort-Object { $_.FullName.Length } -Descending |
            Remove-Item -Recurse -Force
    }

    foreach ($relativePath in @(
        @("Lib", "site-packages", "torch", "include"),
        @("Lib", "site-packages", "torch", "share")
    )) {
        $path = Join-PathParts $PythonRoot $relativePath
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force
        }
    }
}

Reset-Directory $resourcesRoot
Reset-Directory $buildRoot
New-Item -ItemType Directory -Force -Path $pythonRoot, $workerRoot, $binRoot | Out-Null
Ensure-GitKeep $resourcesRoot
Ensure-GitKeep $pythonRoot
Ensure-GitKeep $workerRoot
Ensure-GitKeep $binRoot

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

$pythonExe = Find-PythonExecutable $pythonRoot
$requirementsPath = Join-Path $buildRoot "requirements.txt"
uv export --no-dev --format requirements-txt --output-file $requirementsPath
Assert-LastCommandSucceeded "Export Python requirements"
& $pythonExe -m ensurepip --upgrade
Assert-LastCommandSucceeded "Install bundled Python pip"
& $pythonExe -m pip install --upgrade pip
Assert-LastCommandSucceeded "Upgrade bundled Python pip"
& $pythonExe -m pip install -r $requirementsPath
Assert-LastCommandSucceeded "Install bundled Python dependencies"
Prune-BundledPythonRuntime $pythonRoot
$env:PYTHONPATH = $workerRoot
& $pythonExe -c "import funasr, modelscope, yt_dlp; import frameq_worker"
Assert-LastCommandSucceeded "Python runtime smoke test"

if (!$SkipTauriBuild) {
    $tauriTarget = Resolve-TauriTargetTriple $Target
    npm --prefix $appRoot install
    Assert-LastCommandSucceeded "Install app dependencies"
    npm --prefix $appRoot run tauri -- build --target $tauriTarget
    Assert-LastCommandSucceeded "Build Tauri installer"
}

Write-Host "FrameQ installer resources prepared at $resourcesRoot"
