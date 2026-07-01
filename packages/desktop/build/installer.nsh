; electron-builder's `protocols` option only writes the macOS Info.plist, so
; Windows installs must register the agendex:// URL scheme themselves. Without
; these registry keys the system browser cannot hand the OAuth callback
; (agendex://auth/callback?...) to the app before its first launch.
; SHCTX resolves to HKLM/HKCU based on the per-machine/per-user install choice.
!macro customInstall
  DeleteRegKey SHCTX "Software\Classes\agendex"
  WriteRegStr SHCTX "Software\Classes\agendex" "" "URL:Agendex Auth"
  WriteRegStr SHCTX "Software\Classes\agendex" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\agendex\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\agendex\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\agendex"
!macroend
