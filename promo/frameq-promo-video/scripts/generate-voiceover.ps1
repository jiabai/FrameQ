$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot "src\promoData.json"
$publicDir = Join-Path $projectRoot "public"
$outputPath = Join-Path $publicDir "voiceover.wav"

New-Item -ItemType Directory -Force -Path $publicDir | Out-Null

$data = Get-Content -Raw -Encoding UTF8 $dataPath | ConvertFrom-Json
$script = ($data.voiceover -join "`n`n")

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$mandarinVoice = $voices |
  Where-Object {
    $_.Culture.Name -match "^zh" -or
    $_.Name -match "Huihui|Yaoyao|Kangkang|Xiaoxiao|Yunxi|Yunyang|Xiaochen|Xiaoyi|Chinese|Mandarin"
  } |
  Select-Object -First 1

if ($mandarinVoice) {
  $synth.SelectVoice($mandarinVoice.Name)
  Write-Host "Using voice: $($mandarinVoice.Name)"
} else {
  Write-Warning "No Mandarin Windows voice found. Using default installed voice."
}

$synth.Rate = 1
$synth.Volume = 100
$synth.SetOutputToWaveFile($outputPath)
$synth.Speak($script)
$synth.SetOutputToDefaultAudioDevice()
$synth.Dispose()

$file = Get-Item $outputPath
if ($file.Length -lt 1024) {
  throw "Generated voiceover is unexpectedly small: $($file.Length) bytes"
}

Write-Host "Voiceover written to $outputPath"
