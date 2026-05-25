!ifndef VERSION
  !error "VERSION must be defined: makensis -DVERSION=x.y.z installer-win.nsi"
!endif

!ifndef ARCH
  !error "ARCH must be defined: makensis -DARCH=x64 installer-win.nsi"
!endif

!include "WordFunc.nsh"

!define APPNAME "Egnyte CLI"
!define BINNAME "egnyte-win-${ARCH}.exe"
!define OUTFILE "egnyte-v${VERSION}-win-${ARCH}.exe"

Name "${APPNAME}"
OutFile "../dist/installers/${OUTFILE}"
InstallDir "$PROGRAMFILES64\Egnyte CLI"
RequestExecutionLevel admin
ShowInstDetails show

Section "Install"
  SetOutPath "$INSTDIR"
  File "../dist/binaries/${BINNAME}"
  Rename "$INSTDIR\${BINNAME}" "$INSTDIR\egnyte.exe"

  ; Add install dir to system PATH (dedupe-safe)
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${WordFind} "$0" ";" "+1{$INSTDIR}" $1
  StrCmp $1 "1" +3
    WriteRegStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" \
      "Path" "$0;$INSTDIR"
  SendMessage 65535 26 0 "STR:Environment" /TIMEOUT=5000

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgnyteCLI" \
    "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgnyteCLI" \
    "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgnyteCLI" \
    "DisplayVersion" "${VERSION}"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\egnyte.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  ; Remove install dir from system PATH
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${WordReplace} "$0" ";$INSTDIR" "" "+" $1
  ${WordReplace} "$1" "$INSTDIR;" "" "+" $2
  WriteRegStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
  SendMessage 65535 26 0 "STR:Environment" /TIMEOUT=5000

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\EgnyteCLI"
SectionEnd
