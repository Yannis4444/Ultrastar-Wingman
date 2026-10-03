; Inno Setup 6.2 script for the Windows installer. installer\build.ps1 compiles it and passes
; every path and the version as /D defines; the defaults below only exist so the script
; still compiles from the Inno IDE against a build already sitting in installer\dist.
;
; Two editions out of this one script. Plain, and /DBundleUsdx: the edition that also
; carries Ultrastar Deluxe under {app}\usdx, taken whole from /DUsdxStage, the allowlisted
; copy of a built USDX that build.ps1 -UsdxDir stages into installer\build\usdx. Wingman
; finds that folder next to its exe on its own (config.bundled_usdx_dir), so nothing here
; tells it. Every edition keeps the AppId, so whichever one is run updates the same
; installation.

#ifndef AppVersion
  ; The string ultrastar_wingman.__version__ reports, out of backend\pyproject.toml.
  #define AppVersion "0.0.0"
#endif
#ifndef FileVersion
  ; VersionInfoVersion only takes four numbers, so build.ps1 derives them from AppVersion.
  #define FileVersion "0.0.0.0"
#endif
#ifndef ExeDir
  #define ExeDir SourcePath + "dist"
#endif
#ifndef OutputDir
  #define OutputDir SourcePath + "dist"
#endif
#ifdef BundleUsdx
  #ifndef UsdxStage
    #define UsdxStage SourcePath + "build\usdx"
  #endif
  #define OutputName "UltrastarWingman-" + AppVersion + "-with-usdx-setup"
#else
  #define OutputName "UltrastarWingman-" + AppVersion + "-setup"
#endif

#define AppName "Ultrastar Wingman"
#define AppExeName "UltrastarWingman.exe"
#define AppPublisher "Yannis Vierkoetter"
#define AppUrl "https://github.com/Yannis4444/Ultrastar-Wingman"
; The GUID behind AppId. Never change it: it is how Setup finds an installed Wingman to
; update in place, and how Windows lists it under Apps & features.
#define AppGuid "66ABF566-D476-4D71-97CE-158493516D4E"

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
AppCopyright=Copyright (C) {#AppPublisher}
VersionInfoVersion={#FileVersion}
VersionInfoProductName={#AppName}
VersionInfoProductTextVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup

; Per user, never all users: the edition that bundles Ultrastar Deluxe writes its config,
; database and songs next to its exe, which has to be a folder the user can write to.
; Under "lowest", {autopf} is %LOCALAPPDATA%\Programs and the uninstall key lives in HKCU.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
; UsePreviousAppDir and DisableDirPage=auto are the defaults: an update lands where the
; first install went and does not ask for a folder again.
DisableProgramGroupPage=yes
ShowLanguageDialog=no

; Windows 10 and newer. The bundled Python 3.12 would still start on 8.1, but Microsoft
; supports nothing older than 10 and nothing older is ever tested.
MinVersion=10.0
; The exe is a 64-bit Python build. (Inno 6.3 renamed this to x64compatible, which would
; also admit ARM64 under emulation; 6.2 only knows x64.)
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Restart Manager finds a Wingman running out of {app}, and the wizard lists it and asks
; before closing it (a sing stopped mid-song scores nothing). "force" rather than "yes" is
; measured, not a preference: Wingman is a console program, which Restart Manager cannot
; close gracefully, so "yes" ends the process all the same after a few seconds, then
; reports that it could not, and a silent update aborts with Wingman gone and the old exe
; in place. "force" ends it the same way and the update goes through. A script that must
; not stop a running Wingman passes /NOCLOSEAPPLICATIONS, and the update then aborts.
CloseApplications=force
; Wingman never calls RegisterApplicationRestart, so it cannot be restarted anyway, and an
; installer must not start a server behind the host's back.
RestartApplications=no
; Keeps a second copy of this Setup from running alongside the first.
SetupMutex=UltrastarWingmanSetup,Global\UltrastarWingmanSetup

OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile=UltrastarWingman.ico
LicenseFile=..\LICENSE
WizardStyle=modern
; Generated from the logo by installer\make_icon.py: 100 % and 200 % DPI.
WizardImageFile=wizard-image.bmp,wizard-image-2x.bmp
WizardSmallImageFile=wizard-small.bmp,wizard-small-2x.bmp
Compression=lzma2/ultra64
SolidCompression=yes
; Setup writes a log to %TEMP% every run, so a failed install can be diagnosed afterwards.
SetupLogging=yes

UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
DowngradeWarning=Ultrastar Wingman %1 is installed, and this is the older version %2.%n%nAn older Wingman cannot open a database that a newer one has already updated, so it may not start at all.%n%nInstall the older version anyway?
UninstallWhileRunning=Ultrastar Wingman is running. Close its console window, then click Retry.%n%nA song that is running when Wingman closes scores nothing.
UninstallWhileUsdxRunning=Ultrastar Deluxe is running. Close it, then click Retry.
NonAsciiFolder=The folder%n%n%1%n%nhas characters other than plain English letters, digits and punctuation in it, such as a letter beyond A to Z in a Windows user name. Ultrastar Deluxe cannot start songs from a folder like that.%n%nInstall here anyway?
UsdxKept=This folder holds the Ultrastar Deluxe that an earlier Wingman setup installed. It stays where it is, and Wingman keeps using it.%n%nThis setup updates Wingman alone.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Taking the desktop icon task away on an update takes the icon away too, instead of
; leaving the one the previous install made. Only that one: a shortcut of the same name
; the host made by hand (to the portable exe, say) is theirs.
Type: files; Name: "{autodesktop}\{#AppName}.lnk"; Tasks: not desktopicon; Check: PreviousInstallMadeDesktopIcon

[Files]
Source: "{#ExeDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; The GPL asks for the license to travel with the program.
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
#ifdef BundleUsdx
; The staged Ultrastar Deluxe, whole: build.ps1 already left out everything that is a
; host's runtime state. ignoreversion, so an update replaces the game's files outright.
; config.ini, Ultrastar.db, songs\ and the rest of what the game and Wingman write in there
; are no installed files, so an update leaves them alone and an uninstall leaves them
; behind. CloseApplications covers a running ultrastardx.exe out of {app}\usdx too.
Source: "{#UsdxStage}\*"; DestDir: "{app}\usdx"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif

[Icons]
; The working directory is {app} so a .env placed beside the exe is read on a double-click
; of the shortcut too.
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Wingman opens the host screen in the browser itself, so this only starts it. Never in a
; silent install: a scripted install decides on its own when Wingman runs.
Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; No [UninstallDelete]: the data lives in %LOCALAPPDATA%\Ultrastar Wingman, outside {app},
; and anything else a user put into {app} (a .env, say) is theirs to keep.

[Code]
// Version strings like "0.2.0" or "0.2.0.dev1" as the four numbers StrToVersion wants;
// anything past the numbers is ignored, missing parts are zero.
function PackedVersion(const Version: String; var Packed: Int64): Boolean;
var
  Numbers: String;
  Parts, I: Integer;
begin
  Numbers := '';
  Parts := 1;
  for I := 1 to Length(Version) do
  begin
    if (Version[I] >= '0') and (Version[I] <= '9') then
      Numbers := Numbers + Version[I]
    else if (Version[I] = '.') and (Parts < 4) and (Numbers <> '') and (Numbers[Length(Numbers)] <> '.') then
    begin
      Numbers := Numbers + '.';
      Parts := Parts + 1;
    end
    else
      Break;
  end;
  if (Numbers <> '') and (Numbers[Length(Numbers)] = '.') then
  begin
    Delete(Numbers, Length(Numbers), 1);
    Parts := Parts - 1;
  end;
  while Parts < 4 do
  begin
    Numbers := Numbers + '.0';
    Parts := Parts + 1;
  end;
  Result := StrToVersion(Numbers, Packed);
end;

const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1';

var
  DesktopIconInstalled: Boolean;

function PreviousInstallMadeDesktopIcon(): Boolean;
begin
  Result := DesktopIconInstalled;
end;

function InitializeSetup(): Boolean;
var
  Installed, Tasks: String;
  InstalledPacked, ThisPacked: Int64;
begin
  Result := True;
  // Inno records the tasks an install ran under its uninstall key.
  if RegQueryStringValue(HKA, UninstallKey, 'Inno Setup: Selected Tasks', Tasks) then
    DesktopIconInstalled := Pos('desktopicon', Lowercase(Tasks)) > 0;
  if not RegQueryStringValue(HKA, UninstallKey, 'DisplayVersion', Installed) then
    Exit;
  if not (PackedVersion(Installed, InstalledPacked) and PackedVersion('{#AppVersion}', ThisPacked)) then
    Exit;
  if ComparePackedVersion(ThisPacked, InstalledPacked) < 0 then
  begin
    Log(Format('Installed version %s is newer than this setup''s %s.', [Installed, '{#AppVersion}']));
    // A scripted install (/SUPPRESSMSGBOXES) takes the default, Yes: whoever runs an
    // older setup on purpose from a script meant it.
    Result := SuppressibleMsgBox(FmtMessage(CustomMessage('DowngradeWarning'), [Installed, '{#AppVersion}']),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDYES) = IDYES;
  end;
end;

// Whether a program runs out of the given path. Wingman holds no mutex for AppMutex to
// find, and the uninstaller has no Restart Manager step, so the process list is asked
// directly.
function ProcessRunning(Path: String): Boolean;
var
  Locator, Service, Processes: Variant;
begin
  Result := False;
  // A WQL string literal escapes backslashes and quotes with a backslash.
  StringChangeEx(Path, '\', '\\', True);
  StringChangeEx(Path, '''', '\''', True);
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery(Format('SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = ''%s''', [Path]));
    Result := Processes.Count > 0;
  except
    Log('Could not ask whether ' + Path + ' is running: ' + GetExceptionMessage);
  end;
end;

// Uninstalling under a running Wingman removes everything but the locked exe and leaves
// the server running without an installation, so the host closes it first. The same goes
// for the Ultrastar Deluxe of the edition that brings one; asked by both editions, because
// the plain one run over it inherits the uninstall log that lists the game's files. A
// silent uninstall takes the default, Cancel: it never stops a party on its own.
function InitializeUninstall(): Boolean;
begin
  Result := True;
  while Result and ProcessRunning(ExpandConstant('{app}\{#AppExeName}')) do
  begin
    Log('Ultrastar Wingman is running.');
    Result := SuppressibleMsgBox(CustomMessage('UninstallWhileRunning'), mbError, MB_RETRYCANCEL, IDCANCEL) = IDRETRY;
  end;
  while Result and ProcessRunning(ExpandConstant('{app}\usdx\ultrastardx.exe')) do
  begin
    Log('Ultrastar Deluxe is running out of ' + ExpandConstant('{app}\usdx') + '.');
    Result := SuppressibleMsgBox(CustomMessage('UninstallWhileUsdxRunning'), mbError, MB_RETRYCANCEL, IDCANCEL) = IDRETRY;
  end;
end;

#ifdef BundleUsdx
var
  // The folder the host already said yes to (or that needed no question), so the Ready
  // page does not ask a second time about the folder the directory page just asked about.
  AcceptedDir: String;

function IsPlainAscii(const S: String): Boolean;
var
  I: Integer;
begin
  Result := True;
  for I := 1 to Length(S) do
    if Ord(S[I]) > 127 then
    begin
      Result := False;
      Exit;
    end;
end;

// Ultrastar Deluxe cannot start a song out of a path with characters beyond ASCII in it
// (Wingman copies an oddly named song folder to a plain name, but the folders above the
// game are what they are), and a per-user install lands under the Windows user name.
// Asked on the directory page. An update reuses its folder without showing that page, so
// the Ready page asks instead, and only while {app}\usdx\ultrastardx.exe is not there yet:
// a host who already said yes to the folder is not asked again on every update (with no
// folder page to go back to, No would leave them stuck), but the game landing in such a
// folder for the first time still is. A silent install logs it and goes on.
function ConfirmUsdxFolder(): Boolean;
var
  Dir: String;
begin
  Result := True;
  Dir := WizardDirValue;
  if Dir = AcceptedDir then
    Exit;
  if not IsPlainAscii(Dir) then
  begin
    Log(Format('The folder %s is not plain ASCII: Ultrastar Deluxe cannot start songs from it.', [Dir]));
    Result := SuppressibleMsgBox(FmtMessage(CustomMessage('NonAsciiFolder'), [Dir]),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDYES) = IDYES;
  end;
  if Result then
    AcceptedDir := Dir;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpSelectDir then
    Result := ConfirmUsdxFolder()
  else if CurPageID = wpReady then
  begin
    if FileExists(ExpandConstant('{app}\usdx\ultrastardx.exe')) then
      Log('Ultrastar Deluxe is already in ' + ExpandConstant('{app}\usdx') + ': no question about the folder.')
    else
      Result := ConfirmUsdxFolder();
  end;
end;
#else
// The plain edition run over the bundled one leaves {app}\usdx where it is: those files
// are no part of this setup, Wingman goes on finding the folder next to its exe, and the
// uninstall log Inno appends to still lists them, so an uninstall removes them all the same.
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpReady) and FileExists(ExpandConstant('{app}\usdx\ultrastardx.exe')) then
  begin
    Log('An Ultrastar Deluxe from an earlier Wingman setup is in ' + ExpandConstant('{app}\usdx') + ' and stays.');
    SuppressibleMsgBox(CustomMessage('UsdxKept'), mbInformation, MB_OK, IDOK);
  end;
end;
#endif
