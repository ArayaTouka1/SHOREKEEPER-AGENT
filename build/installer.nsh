; Query the executable directly. The stock check pipes tasklist through find.
!macro customCheckAppRunning
  shorekeeper_retry:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R1
    Sleep 900
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY shorekeeper_retry
      Quit
    ${EndIf}
  ${EndIf}

  ; Upgrade in place. The old 0.23.0 uninstaller cannot be launched reliably
  ; from an installation on another drive. The stock install section consults
  ; these strings to decide whether to uninstall first; clearing them makes
  ; extraction overwrite the existing app files directly. At the end of a
  ; successful install, registryAddInstallInfo writes the new uninstall entry.
  !ifndef BUILD_UNINSTALLER
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    !endif
    ${If} $installMode == "all"
      DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
      DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
      !endif
    ${EndIf}
  !endif
!macroend
