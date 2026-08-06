#define MyAppName "Presenta Bridge"
#define MyAppVersion "0.5.0"
#define MyAppPublisher "Presenta"
#define MyAppExeName "PresentaBridge.exe"

[Setup]
AppId={{2C8E60D2-4B4C-4B57-9A30-878AD0B4C712}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Presenta Bridge
DefaultGroupName=Presenta Bridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=PresentaBridgeSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Instalador de Presenta Bridge para Windows
VersionInfoProductName={#MyAppName}

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "startup"; Description: "Iniciar Presenta Bridge con Windows"; GroupDescription: "Opciones adicionales:"; Flags: checkedonce
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Opciones adicionales:"; Flags: unchecked

[Files]
Source: "dist\PresentaBridge.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Presenta Bridge"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Presenta Bridge"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\Presenta Bridge"; Filename: "{app}\{#MyAppExeName}"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir Presenta Bridge"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Presenta Bridge permanece en segundo plano. Lo cerramos antes de reemplazarlo. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM PresentaBridge.exe /T /F',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Result := '';
end;
