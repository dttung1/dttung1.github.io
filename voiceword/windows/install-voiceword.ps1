<#
  Cài add-in "Soạn bằng giọng nói" vào Word trên Windows (cách "thư mục dùng chung" - Shared Folder Catalog
  theo hướng dẫn của Microsoft cho việc thử nghiệm add-in).

  Cách chạy (PowerShell mở bằng "Run as administrator"):
      powershell -ExecutionPolicy Bypass -File .\install-voiceword.ps1
  Gỡ:
      powershell -ExecutionPolicy Bypass -File .\install-voiceword.ps1 -Remove
  Xóa bộ nhớ đệm add-in của Office (khi Word vẫn hiện giao diện cũ):
      powershell -ExecutionPolicy Bypass -File .\install-voiceword.ps1 -ClearCache
#>
param(
  [string]$ManifestUrl = "https://dttung1.github.io/voiceword/manifest.xml",
  [string]$ManifestPath = "",
  [switch]$Remove,
  [switch]$ClearCache
)

$ErrorActionPreference = "Stop"
$Folder    = Join-Path $env:ProgramData "VoiceWord\manifest"
$ShareName = "VoiceWordAddin"
$CatalogId = "{6C8A1F0E-2B5D-4E8B-9C41-7D3E5A9B0F12}"
$CatalogKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\$CatalogId"
$WefCache  = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef"

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Stop-Word {
  if (Get-Process WINWORD -ErrorAction SilentlyContinue) {
    Write-Warning "Word đang mở. Hãy lưu tài liệu và đóng Word, rồi nhấn Enter để tiếp tục."
    Read-Host | Out-Null
  }
}

if ($ClearCache) {
  Stop-Word
  if (Test-Path $WefCache) {
    Get-ChildItem $WefCache -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Đã xóa bộ nhớ đệm add-in của Office. Mở lại Word để tải giao diện mới." -ForegroundColor Green
  return
}

if (-not (Test-Admin)) {
  throw "Cần chạy PowerShell bằng quyền quản trị (Run as administrator) để tạo thư mục chia sẻ."
}

if ($Remove) {
  Stop-Word
  if (Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue) { Remove-SmbShare -Name $ShareName -Force }
  if (Test-Path $CatalogKey) { Remove-Item $CatalogKey -Recurse -Force }
  if (Test-Path $Folder) { Remove-Item $Folder -Recurse -Force }
  Write-Host "Đã gỡ VoiceWord. Mở lại Word để áp dụng." -ForegroundColor Green
  return
}

# 1. Lấy manifest
New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$target = Join-Path $Folder "voiceword-manifest.xml"
if ($ManifestPath) {
  Copy-Item $ManifestPath $target -Force
} else {
  Write-Host "Đang tải manifest từ $ManifestUrl ..."
  Invoke-WebRequest -Uri $ManifestUrl -OutFile $target -UseBasicParsing
}
[xml]$check = Get-Content $target -Encoding UTF8
if (-not $check.OfficeApp.Id) { throw "File manifest không hợp lệ: $target" }

# 2. Chia sẻ thư mục cho chính người dùng hiện tại (chỉ quyền đọc)
$user = "$env:USERDOMAIN\$env:USERNAME"
if (-not (Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue)) {
  New-SmbShare -Name $ShareName -Path $Folder -ReadAccess $user | Out-Null
}
$unc = "\\$env:COMPUTERNAME\$ShareName"

# 3. Khai báo thư mục chia sẻ là "danh mục add-in tin cậy" của Office
New-Item -Path $CatalogKey -Force | Out-Null
New-ItemProperty -Path $CatalogKey -Name "Id"    -Value $CatalogId -PropertyType String -Force | Out-Null
New-ItemProperty -Path $CatalogKey -Name "Url"   -Value $unc       -PropertyType String -Force | Out-Null
New-ItemProperty -Path $CatalogKey -Name "Flags" -Value 1          -PropertyType DWord  -Force | Out-Null

Write-Host ""
Write-Host "Đã cài xong danh mục add-in: $unc" -ForegroundColor Green
Write-Host "Bước tiếp theo trong Word:"
Write-Host "  1. Đóng hết cửa sổ Word rồi mở lại."
Write-Host "  2. Trang đầu (Home) -> Add-in -> Thêm add-in (More Add-ins) -> thẻ THƯ MỤC DÙNG CHUNG (SHARED FOLDER)."
Write-Host "  3. Chọn 'Soạn bằng giọng nói' -> Thêm. Nút mới xuất hiện ở thẻ Trang đầu, nhóm 'Giọng nói'."
