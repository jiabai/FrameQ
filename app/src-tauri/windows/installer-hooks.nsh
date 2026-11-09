; Locus 安装前检查：本地安全软件、目标卷可用空间与安装目录可写性，并记录安装步骤日志
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; 步骤日志固定放在临时目录：任何安装模式下都可写，且不进诊断包
!define APP_INSTALL_LOG "$TEMP\install.log"
!define APP_INSTALL_LOG_MAX_BYTES 65536
; 空间余量：估算体积只含负载，不含安装临时文件与 WebView2 引导程序
!define APP_FREE_SPACE_MARGIN_KB 262144

; 追加一行步骤日志。任何写入失败都只被忽略，绝不影响安装。
; ${LINE} 里的运行时变量必须在 ${GetTime} 之前固化，否则会被时间字段覆盖。
!macro AppLog LINE
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R8
  Push $R9

  StrCpy $R8 "${LINE}"

  ClearErrors
  FileOpen $R9 "${APP_INSTALL_LOG}" r
  ${IfNot} ${Errors}
    FileSeek $R9 0 END $R6
    FileClose $R9
    ${If} $R6 > ${APP_INSTALL_LOG_MAX_BYTES}
      Delete "${APP_INSTALL_LOG}"
    ${EndIf}
  ${EndIf}

  ClearErrors
  FileOpen $R9 "${APP_INSTALL_LOG}" a
  ${IfNot} ${Errors}
    FileSeek $R9 0 END
    ${GetTime} "" "L" $R0 $R1 $R2 $R3 $R4 $R5 $R6
    FileWrite $R9 "time=$R2-$R1-$R0 $R4:$R5:$R6 $R8$\r$\n"
    FileClose $R9
  ${EndIf}

  Pop $R9
  Pop $R8
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

; 取目标目录所在卷的剩余空间（MB）。目录不存在时退回到卷根；都取不到就返回 ""，
; 由调用方按「未知」放行。
!macro AppFreeSpaceMb PATH RESULT
  Push $R0
  ${DriveSpace} "${PATH}" "/D=F /S=M" ${RESULT}
  ${If} ${RESULT} == ""
    ${GetRoot} "${PATH}" $R0
    ${If} $R0 != ""
      ${DriveSpace} "$R0\" "/D=F /S=M" ${RESULT}
    ${EndIf}
  ${EndIf}
  Pop $R0
!macroend

; 在 $INSTDIR 里建一个探针文件再删掉。会先尝试创建目录，失败时回收自己建的目录。
!macro AppCheckWritability RESULT
  Push $R0
  Push $R1

  StrCpy ${RESULT} "ok"
  StrCpy $R0 "existing"
  IfFileExists "$INSTDIR\*.*" app_write_probe
    StrCpy $R0 "created"
    ClearErrors
    CreateDirectory "$INSTDIR"
    IfErrors app_write_fail

  app_write_probe:
    ClearErrors
    FileOpen $R1 "$INSTDIR\.install-probe" w
    IfErrors app_write_fail
    FileWriteByte $R1 "1"
    FileClose $R1
    Delete "$INSTDIR\.install-probe"
    Goto app_write_end

  app_write_fail:
    StrCpy ${RESULT} "fail"
    ${If} $R0 == "created"
      RMDir "$INSTDIR"
    ${EndIf}

  app_write_end:
  Pop $R1
  Pop $R0
!macroend

!macro AppProbe PROCESSLISTFILE PROCESSNAME PRODUCTNAME
  nsExec::Exec 'cmd /c findstr /I /C:"${PROCESSNAME}" "${PROCESSLISTFILE}" >nul'
  Pop $R1
  ${If} $R1 == "0"
  ${AndIf} $R0 == ""
    StrCpy $R0 "${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4

  ; 只有交互安装才允许弹窗或中止；静默、被动升级与自动更新一律只记录
  StrCpy $R3 "interactive"
  IfSilent app_mode_silent
  Goto app_mode_probe
  app_mode_silent:
    StrCpy $R3 "silent"
  app_mode_probe:
  ${GetOptions} $CMDLINE "/P" $R1
  ${IfNot} ${Errors}
    StrCpy $R3 "passive"
  ${EndIf}
  ${GetOptions} $CMDLINE "/UPDATE" $R1
  ${IfNot} ${Errors}
    StrCpy $R3 "update"
  ${EndIf}

  !insertmacro AppLog "step=preinstall start mode=$R3 instdir=$INSTDIR"

  ; 安全软件提示：探测与弹窗都只在交互安装里做
  StrCpy $R0 ""
  ${If} $R3 == "interactive"
    GetTempFileName $R2
    nsExec::Exec 'cmd /c tasklist /NH > "$R2"'
    Pop $R1

    !insertmacro AppProbe "$R2" "360tray.exe" "360 安全卫士"
    !insertmacro AppProbe "$R2" "360sd.exe" "360 杀毒"
    !insertmacro AppProbe "$R2" "360Safe.exe" "360 安全卫士"
    !insertmacro AppProbe "$R2" "ZhuDongFangYu.exe" "360 安全卫士"
    !insertmacro AppProbe "$R2" "HipsTray.exe" "火绒安全软件"
    !insertmacro AppProbe "$R2" "HipsDaemon.exe" "火绒安全软件"
    !insertmacro AppProbe "$R2" "usysdiag.exe" "火绒安全软件"
    !insertmacro AppProbe "$R2" "QQPCTray.exe" "腾讯电脑管家"

    Delete "$R2"
  ${EndIf}

  ${If} $R0 == ""
    !insertmacro AppLog "step=security product=none"
  ${Else}
    !insertmacro AppLog "step=security product=$R0"
    MessageBox MB_OK|MB_ICONINFORMATION "检测到 $R0 正在运行。$\r$\n$\r$\n它的实时防护可能拦截安装程序写入文件，安装到一半会提示 Error opening file for writing，并指向某个 .dll。$\r$\n$\r$\n如果被拦截，先点「中止」，把下面的目录加入信任区，再重新运行安装包。不要点「忽略」，跳过文件会让语音识别或说话人分离在后续运行时出错。$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\n建议使用默认安装位置，不要装到 Program Files。"
  ${EndIf}

  ; 空间预检：估算体积 + 余量，换算成 MB
  ; ESTIMATEDSIZE 由 Tauri 模板在本文件 include 之后才定义，所以回退必须在这里判断
  !ifdef ESTIMATEDSIZE
    IntOp $R2 ${ESTIMATEDSIZE} + ${APP_FREE_SPACE_MARGIN_KB}
  !else
    IntOp $R2 900000 + ${APP_FREE_SPACE_MARGIN_KB}
  !endif
  IntOp $R2 $R2 / 1024
  !insertmacro AppFreeSpaceMb "$INSTDIR" $R1
  ${If} $R1 == ""
    !insertmacro AppLog "step=freespace result=unknown required_mb=$R2"
  ${ElseIf} $R1 < $R2
    !insertmacro AppLog "step=freespace result=fail free_mb=$R1 required_mb=$R2"
    ${If} $R3 == "interactive"
      MessageBox MB_OK|MB_ICONSTOP "安装位置所在磁盘空间不足。$\r$\n$\r$\n需要约 $R2 MB，当前可用 $R1 MB。$\r$\n$\r$\n请清理磁盘空间，或换一个安装位置后重试。$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\n安装日志：${APP_INSTALL_LOG}"
      Abort
    ${EndIf}
  ${Else}
    !insertmacro AppLog "step=freespace result=ok free_mb=$R1 required_mb=$R2"
  ${EndIf}

  ; 可写性预检
  !insertmacro AppCheckWritability $R4
  ${If} $R4 == "ok"
    !insertmacro AppLog "step=writability result=ok"
  ${Else}
    !insertmacro AppLog "step=writability result=fail"
    ${If} $R3 == "interactive"
      MessageBox MB_OK|MB_ICONSTOP "安装程序无法写入下面的目录。$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\n常见原因是选到了受保护的系统目录，或安全软件拦截了写入。请换一个安装位置（建议使用默认位置），或把该目录加入安全软件信任区后重试。$\r$\n$\r$\n安装日志：${APP_INSTALL_LOG}"
      Abort
    ${EndIf}
  ${EndIf}

  !insertmacro AppLog "step=copy start"

  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro AppLog "step=install done"
!macroend
