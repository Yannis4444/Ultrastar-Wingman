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
#ifndef AppDir
  ; PyInstaller's folder build (build.ps1 runs the spec with --onedir): UltrastarWingman.exe
  ; beside the _internal folder it loads from. Not the portable one-file exe, which unpacks
  ; itself into %TEMP%\_MEI* on every start and leaves that behind when it is ended hard, as
  ; CloseApplications=force does on an update.
  #define AppDir SourcePath + "dist\UltrastarWingman"
#endif
#ifndef OutputDir
  #define OutputDir SourcePath + "dist"
#endif
#ifndef LongestPath
  ; How many characters the deepest path this setup installs runs below {app}, measured by
  ; build.ps1 over the payload (a folder counting 13 more, see FolderFits). The default is
  ; a conservative guess for the IDE; the measured values are about 100 and 110.
  #define LongestPath "130"
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

; Per user, never all users. Ultrastar Deluxe writes its config, database and songs next to
; its exe, so in Program Files the edition that bundles it would have to grant users-modify
; on the folder holding ultrastardx.exe and its DLLs: exactly what Inno's documentation of
; the [Dirs] Permissions parameter warns against (USDX's own installer does it, as a
; stopgap). Every update would also bring a UAC prompt for an unsigned setup, and Wingman
; keeps its own data per user anyway. Under "lowest", {autopf} is %LOCALAPPDATA%\Programs
; and the uninstall key lives in HKCU.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
; UsePreviousAppDir and DisableDirPage=auto are the defaults: an update lands where the
; first install went and does not ask for a folder again. The Ready page names the folder
; all the same, since on an update it is the only page left (ShouldSkipPage below).
AlwaysShowDirOnReadyPage=yes
DisableProgramGroupPage=yes
ShowLanguageDialog=no

; Windows 10 and newer. The bundled Python 3.12 would still start on 8.1, but Microsoft
; supports nothing older than 10 and nothing older is ever tested.
MinVersion=10.0
; The exe is a 64-bit Python build. Not arm64, and not 6.3's x64compatible (which admits
; ARM64 running x64 code under emulation): ARM64 is not tested.
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Restart Manager finds a Wingman running out of {app}, and the wizard lists it and asks
; before closing it (a sing stopped mid-song scores nothing). "force" rather than "yes" is
; measured, not a preference: Wingman is a console program, which Restart Manager cannot
; close gracefully, so "yes" ends the process all the same after a few seconds, then
; reports that it could not, and a silent update aborts with Wingman gone and the old exe
; in place. "force" ends it the same way and the update goes through. A script that must
; not stop a running Wingman passes /NOCLOSEAPPLICATIONS, and the update then aborts and
; rolls back, leaving the old Wingman as it was ([InstallDelete] below).
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
ReadyToUpdate=Ultrastar Wingman %1 is installed in the folder below. Click Install to replace it with version %2.
FolderTooLong=The folder%n%n%1%n%nis %2 characters long. Ultrastar Wingman puts files up to %3 characters deep inside it, and Windows allows 259 in all, so the folder can have at most %4.%n%nPick a shorter folder, such as C:\Karaoke\Ultrastar Wingman. To move an installed Wingman, uninstall it first: its data folder stays.
UsdxNowBundled=From now on, Wingman uses the Ultrastar Deluxe that comes with this setup, not the one in its settings.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Taking the desktop icon task away on an update takes the icon away too, instead of
; leaving the one the previous install made. Only that one: a shortcut of the same name
; the host made by hand (to the portable exe, say) is theirs.
Type: files; Name: "{autodesktop}\{#AppName}.lnk"; Tasks: not desktopicon; Check: PreviousInstallMadeDesktopIcon
; A newer build may drop a file of the last one's _internal, and one left there could still
; be imported, so the folder goes whole and [Files] brings it back. It runs after
; CloseApplications has closed a running Wingman. Inno does not roll [InstallDelete] back,
; so not while Wingman still runs (/NOCLOSEAPPLICATIONS, or "Do not close" in the wizard):
; it would take every file the server does not hold open, and the locked exe then aborts
; the update with an installation that no longer starts. Skipped, the abort rolls the
; files back and leaves the old Wingman whole. An update failing after it for another
; reason (a full disk) still needs the setup run again.
Type: filesandordirs; Name: "{app}\_internal"; Check: not WingmanRunning
#ifdef BundleUsdx
; Ultrastar Deluxe loads every *.usdx in plugins and every *.dll in webs, so one that a
; newer build no longer ships would go on loading. Those two kinds alone: Inno does not
; roll [InstallDelete] back, and an update that aborts after it must still leave a game
; that starts, so themes, languages and the DLLs beside the exe stay until overwritten.
Type: files; Name: "{app}\usdx\plugins\*.usdx"
Type: files; Name: "{app}\usdx\webs\*.dll"
#endif

#ifdef BundleUsdx
[Dirs]
; Created by the setup, so it is there to copy songs into before Wingman ever ran, and
; never removed by the uninstaller, even empty: the songs in it are the host's.
Name: "{app}\usdx\songs"; Flags: uninsneveruninstall
#endif

[Files]
; The folder build whole: {#AppExeName} at the top of {app}, where the shortcuts, [Run],
; UninstallDisplayIcon and the uninstaller's process check expect it, and _internal\ beside it.
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
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
#ifdef BundleUsdx
; The way to the songs folder, which sits under the hidden %LOCALAPPDATA%. USDX's own
; installer calls it "Songs" inside its Start menu folder; Wingman has no folder there.
Name: "{autoprograms}\{#AppName} songs"; Filename: "{app}\usdx\songs"
#endif

[Run]
; Wingman opens the host screen in the browser itself, so this only starts it. Never in a
; silent install: a scripted install decides on its own when Wingman runs.
Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

; No [UninstallDelete]: the data lives in %LOCALAPPDATA%\Ultrastar Wingman, outside {app},
; and anything else a user put into {app} (a .env, say) is theirs to keep.

[Code]
function IsDigit(const C: Char): Boolean;
begin
  Result := (C >= '0') and (C <= '9');
end;

function IsSeparator(const C: Char): Boolean;
begin
  Result := (C = '.') or (C = '-') or (C = '_');
end;

// A PEP 440 version string ("0.2.0", "0.2.0rc1", "0.2.0.dev3", "0.2.0.post1") as the four
// numbers StrToVersion wants: the first three release numbers, missing ones zero, and a
// fourth that orders what follows them the way PEP 440 does, .dev < a < b < rc < the
// release itself < .post. So a pre-release over its own release is a downgrade, and the
// release over its pre-release an update. The fourth is Stage * 4096 + the suffix's
// number; a fourth release number ranks above a .post, as in PEP 440. Only the first
// suffix counts (0.2.0rc1.dev2 reads as 0.2.0rc1), and one PEP 440 does not know reads as
// the release.
function PackedVersion(const Version: String; var Packed: Int64): Boolean;
var
  Numbers, Suffix, Count: String;
  Parts, I, Stage, Number: Integer;
begin
  Numbers := '';
  Parts := 1;
  I := 1;
  while I <= Length(Version) do
  begin
    if IsDigit(Version[I]) then
      Numbers := Numbers + Version[I]
    else if (Version[I] = '.') and (Parts < 3) and (Numbers <> '') and (I < Length(Version)) and IsDigit(Version[I + 1]) then
    begin
      Numbers := Numbers + '.';
      Parts := Parts + 1;
    end
    else
      Break;
    I := I + 1;
  end;
  if Numbers = '' then
  begin
    Result := False;
    Exit;
  end;
  while Parts < 3 do
  begin
    Numbers := Numbers + '.0';
    Parts := Parts + 1;
  end;

  if (I <= Length(Version)) and IsSeparator(Version[I]) then
    I := I + 1;
  Suffix := '';
  while (I <= Length(Version)) and not IsDigit(Version[I]) and not IsSeparator(Version[I]) and (Version[I] <> '+') do
  begin
    Suffix := Suffix + Version[I];
    I := I + 1;
  end;
  Suffix := Lowercase(Suffix);
  if (Suffix <> '') and (I <= Length(Version)) and IsSeparator(Version[I]) then
    I := I + 1;
  Count := '';
  while (I <= Length(Version)) and IsDigit(Version[I]) do
  begin
    Count := Count + Version[I];
    I := I + 1;
  end;
  Number := StrToIntDef(Count, 0);
  if (Number < 0) or (Length(Count) > 4) or (Number > 4095) then
    Number := 4095;

  if Suffix = 'dev' then
    Stage := 0
  else if (Suffix = 'a') or (Suffix = 'alpha') then
    Stage := 1
  else if (Suffix = 'b') or (Suffix = 'beta') then
    Stage := 2
  else if (Suffix = 'rc') or (Suffix = 'c') or (Suffix = 'pre') or (Suffix = 'preview') then
    Stage := 3
  else if (Suffix = 'post') or (Suffix = 'rev') or (Suffix = 'r') then
    Stage := 5
  else if (Suffix = '') and (Count <> '') then
    Stage := 6
  else
  begin
    Stage := 4;
    Number := 0;
  end;
  Result := StrToVersion(Numbers + '.' + IntToStr(Stage * 4096 + Number), Packed);
end;

const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1';

var
  DesktopIconInstalled: Boolean;
  // The version an installed Wingman reports, '' on a fresh install.
  InstalledVersion: String;

function PreviousInstallMadeDesktopIcon(): Boolean;
begin
  Result := DesktopIconInstalled;
end;

function IsUpdate(): Boolean;
begin
  Result := InstalledVersion <> '';
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
  InstalledVersion := Installed;
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

// An update asks nothing it already knows: the license was accepted when Wingman was
// installed, and UsePreviousTasks has the desktop icon answer, so the Ready page is all
// that is left (it is also where the folder checks run, FolderFits below). The cost: a
// wizard update cannot add or take away the desktop icon; /MERGETASKS still can.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpdate() and ((PageID = wpLicense) or (PageID = wpSelectTasks));
  if Result and (PageID = wpLicense) then
    Log(Format('Update from %s: License page skipped.', [InstalledVersion]))
  else if Result then
    Log(Format('Update from %s: Select Tasks page skipped.', [InstalledVersion]));
end;

const
  // Inno Setup 6.2 is not long-path aware: a path past MAX_PATH, 259 characters and the
  // terminating null, fails to install. Measured: the edition with Ultrastar Deluxe run over
  // a plain install in a 152-character folder failed on a 262-character projectM preset
  // (MoveFile, code 3), after [InstallDelete] had already swept _internal, leaving a
  // Wingman that did not start. So the folder is held to what the deepest path leaves.
  MaxFolderLength = 259 - 1 - {#LongestPath};

// Whether the deepest file this setup installs fits below the chosen folder. Asked on the
// directory page and again on the Ready page, the only page an update shows, so a folder
// that an earlier, shallower setup accepted is refused before anything is deleted. A folder
// needs 13 characters more than its own path: Setup writes each file into it as
// is-XXXXX.tmp before MoveFile names it, and CreateDirectory leaves room for an 8.3 name.
// build.ps1 counts that into LongestPath. A silent install logs the refusal and exits with
// code 1 (measured; the help only says that NextButtonClick returning False before the
// installation ends a silent setup), having written nothing.
function FolderFits(): Boolean;
var
  Dir: String;
begin
  Dir := WizardDirValue;
  Result := Length(Dir) <= MaxFolderLength;
  if not Result then
  begin
    // No continuation line may start with "[": ISCC reads that as a section tag.
    Log(Format('The folder %s is %d characters long; at most %d leave room for the deepest path, %d characters below it.', [
      Dir, Length(Dir), MaxFolderLength, {#LongestPath}]));
    SuppressibleMsgBox(FmtMessage(CustomMessage('FolderTooLong'), [
      Dir, IntToStr(Length(Dir)), '{#LongestPath}', IntToStr(MaxFolderLength)]), mbError, MB_OK, IDOK);
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Grown: Integer;
begin
  if (CurPageID = wpReady) and IsUpdate() then
  begin
    WizardForm.ReadyLabel.Caption := FmtMessage(CustomMessage('ReadyToUpdate'), [InstalledVersion, '{#AppVersion}']);
    // A caption that needs more lines than Inno's own pushes the list of settings down.
    Grown := WizardForm.ReadyLabel.AdjustHeight;
    WizardForm.ReadyMemo.Top := WizardForm.ReadyMemo.Top + Grown;
    WizardForm.ReadyMemo.Height := WizardForm.ReadyMemo.Height - Grown;
    Log(WizardForm.ReadyLabel.Caption);
  end;
end;

// Whether a program runs out of the given path. Wingman holds no mutex for AppMutex to
// find, and the uninstaller has no Restart Manager step, so the process list is asked
// directly. When it cannot tell, the answer is "running": a wrong "running" costs a
// skipped sweep of _internal or one more Retry in the uninstaller, a wrong "not running"
// deletes files under a live program.
function ProcessRunning(const Path: String): Boolean;
var
  Locator, Service, Processes: Variant;
  Literal: String;
  Probe: TFileStream;
begin
  Result := False;
  // A WQL string literal escapes backslashes and quotes with a backslash.
  Literal := Path;
  StringChangeEx(Literal, '\', '\\', True);
  StringChangeEx(Literal, '''', '\''', True);
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery(Format('SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = ''%s''', [Literal]));
    Result := Processes.Count > 0;
  except
    Log('Could not ask whether ' + Path + ' is running: ' + GetExceptionMessage);
    Result := True;
  end;
  // WMI leaves ExecutablePath empty for a process of higher integrity than the one asking,
  // so a Wingman started with "Run as administrator" is not found by its path. Windows
  // refuses to open the exe of any running process for writing, whoever started it, and
  // opening it changes nothing on an idle one.
  if not Result and FileExists(Path) then
    try
      Probe := TFileStream.Create(Path, fmOpenReadWrite or fmShareDenyNone);
      Probe.Free;
    except
      Log(Path + ' cannot be opened for writing, so it is taken as running: ' + GetExceptionMessage);
      Result := True;
    end;
end;

// The installed Wingman, still running when [InstallDelete] comes round: only when
// CloseApplications was told not to close it. Inno also asks while it lists the files for
// Restart Manager, before anything is closed, and then leaves _internal unregistered,
// which costs nothing: [Files] holds the exe every running Wingman keeps open (measured:
// the update still closes it, and the second ask, after the close, deletes the folder).
function WingmanRunning(): Boolean;
begin
  Result := ProcessRunning(ExpandConstant('{app}\{#AppExeName}'));
  if Result then
    Log('Ultrastar Wingman is running out of ' + ExpandConstant('{app}') + '.');
end;

// Uninstalling under a running Wingman removes everything but the exe and the files of
// _internal it holds open, and leaves the server running without an installation, so the
// host closes it first. The same goes for the Ultrastar Deluxe of the edition that brings
// one; asked by both editions, because the plain one run over it inherits the uninstall log
// that lists the game's files. A silent uninstall takes the default, Cancel: it never stops
// a party on its own.
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
  // Before the folder question: a folder too long to install into needs no other answer.
  if (CurPageID = wpSelectDir) or (CurPageID = wpReady) then
    Result := FolderFits();
  if not Result then
    Exit;
  if CurPageID = wpSelectDir then
    Result := ConfirmUsdxFolder()
  else if CurPageID = wpReady then
  begin
    if FileExists(ExpandConstant('{app}\usdx\ultrastardx.exe')) then
      Log('Ultrastar Deluxe is already in ' + ExpandConstant('{app}\usdx') + ': no question about the folder.')
    else
    begin
      Result := ConfirmUsdxFolder();
      // A plain Wingman getting the game for the first time: until now it drove the
      // Ultrastar Deluxe in its settings, and from now on it drives this one. (No word on
      // microphones: the new game says so itself when none is set up.)
      if Result and FileExists(ExpandConstant('{app}\{#AppExeName}')) then
      begin
        Log('Wingman is installed without Ultrastar Deluxe: from now on it uses the one this setup brings.');
        SuppressibleMsgBox(CustomMessage('UsdxNowBundled'), mbInformation, MB_OK, IDOK);
      end;
    end;
  end;
end;
#else
// The plain edition run over the bundled one leaves {app}\usdx where it is: those files
// are no part of this setup, Wingman goes on finding the folder next to its exe, and the
// uninstall log Inno appends to still lists them, so an uninstall removes them all the same.
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectDir) or (CurPageID = wpReady) then
    Result := FolderFits();
  if Result and (CurPageID = wpReady) and FileExists(ExpandConstant('{app}\usdx\ultrastardx.exe')) then
  begin
    Log('An Ultrastar Deluxe from an earlier Wingman setup is in ' + ExpandConstant('{app}\usdx') + ' and stays.');
    SuppressibleMsgBox(CustomMessage('UsdxKept'), mbInformation, MB_OK, IDOK);
  end;
end;
#endif
