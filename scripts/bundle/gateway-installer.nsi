Unicode true
Name "HatoPad Gateway"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\HatoPad Gateway"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "HatoPad Gateway"
VIAddVersionKey "FileDescription" "HatoPad Gateway Early Access Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "HatoPad contributors"

!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current
  ; Replace a pre-rename installation (the previous product name) so only one entry remains.
  Delete "$SMPROGRAMS\Vibe Gateway.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VibeGateway"
  RMDir /r "$LOCALAPPDATA\Programs\Vibe Gateway"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE}\*"
  IfErrors 0 +2
    Abort "Could not install Gateway. Close HatoPad Gateway and HatoPad, then retry."
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\HatoPad Gateway.lnk" "$INSTDIR\HatoPad Gateway.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "DisplayName" "HatoPad Gateway (Early Access)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\HatoPad Gateway.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HatoPadGateway"
  RMDir /r "$INSTDIR"
SectionEnd
