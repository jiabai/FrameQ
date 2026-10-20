; FrameQ 安装前检查：本地安全软件可能拦截安装程序写入文件
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro FrameQProbe PROCESSLISTFILE PROCESSNAME PRODUCTNAME
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

  StrCpy $R0 ""

  ; 静默安装与自动更新不弹窗，否则会卡住流程
  IfSilent frameq_security_done
  ${GetOptions} $CMDLINE "/P" $R1
  ${IfNot} ${Errors}
    Goto frameq_security_done
  ${EndIf}
  ${GetOptions} $CMDLINE "/UPDATE" $R1
  ${IfNot} ${Errors}
    Goto frameq_security_done
  ${EndIf}

  GetTempFileName $R2
  nsExec::Exec 'cmd /c tasklist /NH > "$R2"'
  Pop $R1

  !insertmacro FrameQProbe "$R2" "360tray.exe" "360 安全卫士"
  !insertmacro FrameQProbe "$R2" "360sd.exe" "360 杀毒"
  !insertmacro FrameQProbe "$R2" "360Safe.exe" "360 安全卫士"
  !insertmacro FrameQProbe "$R2" "ZhuDongFangYu.exe" "360 安全卫士"
  !insertmacro FrameQProbe "$R2" "HipsTray.exe" "火绒安全软件"
  !insertmacro FrameQProbe "$R2" "HipsDaemon.exe" "火绒安全软件"
  !insertmacro FrameQProbe "$R2" "usysdiag.exe" "火绒安全软件"
  !insertmacro FrameQProbe "$R2" "QQPCTray.exe" "腾讯电脑管家"

  Delete "$R2"

  ${If} $R0 != ""
    MessageBox MB_OK|MB_ICONINFORMATION "检测到 $R0 正在运行。$\r$\n$\r$\n它的实时防护可能拦截安装程序写入文件，安装到一半会提示 Error opening file for writing，并指向某个 .dll。$\r$\n$\r$\n如果被拦截，先点「中止」，把下面的目录加入信任区，再重新运行安装包。不要点「忽略」，跳过文件会让语音识别或说话人分离在后续运行时出错。$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\n建议使用默认安装位置，不要装到 Program Files。"
  ${EndIf}

  frameq_security_done:
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
