<#
  Khởi động VoiceWord trên Windows bằng MỘT lệnh: máy chủ + đường hầm https (cloudflared).
  Không cần quyền quản trị. Chạy:
      powershell -ExecutionPolicy Bypass -File .\start-voiceword.ps1
  Lần đầu, script tạo file cấu hình %APPDATA%\VoiceWord\config.json (mã truy cập, các khóa).
  Muốn thêm khóa Claude hoặc Azure: mở file đó bằng Notepad, điền vào, chạy lại script.
#>
$ErrorActionPreference = "Stop"
$ServerDir  = Join-Path (Split-Path $PSScriptRoot -Parent) "server"
$ConfigDir  = Join-Path $env:APPDATA "VoiceWord"
$ConfigFile = Join-Path $ConfigDir "config.json"
$LogDir     = Join-Path $ConfigDir "logs"
$Port       = 8787

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

if (-not (Test-Path (Join-Path $ServerDir "server.js"))) { throw "Không thấy thư mục máy chủ: $ServerDir" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Chưa cài Node.js. Tải bản LTS ở https://nodejs.org rồi chạy lại." }
New-Item -ItemType Directory -Force -Path $ConfigDir, $LogDir | Out-Null

# 1. Cấu hình: tạo lần đầu với mã truy cập ngẫu nhiên
if (-not (Test-Path $ConfigFile)) {
  $cfg = [ordered]@{
    APP_TOKEN           = [guid]::NewGuid().ToString("N")
    ANTHROPIC_API_KEY   = ""
    AZURE_SPEECH_KEY    = ""
    AZURE_SPEECH_REGION = "southeastasia"
  }
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
  Say "Đã tạo file cấu hình: $ConfigFile" "Yellow"
}
$cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($name in "APP_TOKEN", "ANTHROPIC_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION") {
  $value = $cfg.$name
  if ($value) { Set-Item -Path "Env:$name" -Value $value } else { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
}
$env:PORT = "$Port"

# 2. Thư viện máy chủ (chỉ cài lần đầu). Dùng npm.cmd để không vướng chính sách chạy script.
if (-not (Test-Path (Join-Path $ServerDir "node_modules"))) {
  Say "Đang cài thư viện cho máy chủ (lần đầu)..."
  Push-Location $ServerDir
  try { & npm.cmd install --no-audit --no-fund | Out-Host } finally { Pop-Location }
}

# 3. cloudflared
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Say "Đang cài cloudflared bằng winget..."
  & winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) { throw "Không cài được cloudflared. Hãy đóng PowerShell, mở lại rồi chạy lại script." }
}

# 4. Chạy máy chủ và đường hầm, ghi log ra file
$serverLog = Join-Path $LogDir "server.log"
$tunnelLog = Join-Path $LogDir "tunnel.log"
Remove-Item $serverLog, "$serverLog.err", $tunnelLog, "$tunnelLog.out" -ErrorAction SilentlyContinue

$server = Start-Process -FilePath (Get-Command node).Source -ArgumentList "server.js" -WorkingDirectory $ServerDir `
  -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err" -NoNewWindow -PassThru
Start-Sleep -Seconds 2
if ($server.HasExited) {
  Get-Content "$serverLog.err" -ErrorAction SilentlyContinue | Out-Host
  throw "Máy chủ không chạy được (có thể cổng $Port đang bị chiếm). Xem log ở trên."
}

$tunnel = Start-Process -FilePath $cf.Source -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:$Port" `
  -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out" -NoNewWindow -PassThru

# 5. Đợi địa chỉ https
Say "Đang mở đường hầm https..."
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  $text = (Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue)
  if ($text -match "https://[a-z0-9-]+\.trycloudflare\.com") { $url = $Matches[0] }
}
if (-not $url) {
  Stop-Process -Id $server.Id, $tunnel.Id -ErrorAction SilentlyContinue
  throw "Không lấy được địa chỉ https. Xem log: $tunnelLog"
}

# 6. Kiểm tra /health (DNS của địa chỉ mới có thể cần vài giây)
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  try { $h = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 5; $ok = $h.ok } catch { Start-Sleep -Seconds 2 }
}

try { Set-Clipboard -Value $url } catch { }
Say ""
Say "================ VoiceWord đang chạy ================" "Green"
Say "Địa chỉ máy chủ : $url   (đã chép vào clipboard)" "Green"
Say "Mã truy cập     : $($env:APP_TOKEN)" "Green"
if ($ok) { Say "Kiểm tra /health: tốt (Azure: $($h.speech))" "Green" } else { Say "Kiểm tra /health: chưa trả lời, thử mở $url/health bằng trình duyệt sau ít giây." "Yellow" }
Say "Trong Word: Cài đặt -> dán địa chỉ máy chủ và mã truy cập -> Lưu."
Say "GIỮ CỬA SỔ NÀY MỞ khi dùng. Nhấn Enter (hoặc đóng cửa sổ) để dừng VoiceWord." "Yellow"
Read-Host | Out-Null

Stop-Process -Id $server.Id, $tunnel.Id -ErrorAction SilentlyContinue
Say "Đã dừng VoiceWord."
