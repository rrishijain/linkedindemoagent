' start-voice-server.vbs — launches the local Kokoro TTS server hidden.
' Drop a shortcut into shell:startup to run it at login (same pattern as
' the ARGUS runner).

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

' Wake word defaults OFF in the server itself (WAKE_DEFAULT in wakeword.py)
' — speaker bleed into the mic makes hands-free overlap with ARGUS's own
' replies unless you wear headphones. Uncomment to arm hands-free here, or
' set WAKE_WORD=on in ~/.claude/.env.
' WshShell.Environment("PROCESS")("WAKE_WORD") = "on"

WshShell.Run """" & dir & "\.venv\Scripts\python.exe"" """ & dir & "\server.py""", 0, False
Set WshShell = Nothing
