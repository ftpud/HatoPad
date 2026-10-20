import { FocusModeButton } from "../FocusModeButton";
import { BranchPicker } from "../BranchPicker";
import { ConnectionMenu } from "../ConnectionMenu";
import { Settings } from "lucide-react";
import { hasWorkspaceSetting, readSetting, readSettingNumber, resetWorkspaceSetting } from "../settings";
import { SettingsMenu, type DesktopSettings } from "../SettingsMenu";
import { AiProvidersPanel } from "../AiProvidersPanel";
import { ToolsPanel } from "../ToolsPanel";
import { StoragePanel } from "../StoragePanel";
import { PluginsPanel } from "../PluginsPanel";
import { RunConfigurationToolbar } from "../RunConfigurationToolbar";
import type { AppViewContext } from "./view-types";

export function AppToolbar({ context }: { context: AppViewContext }) {
  const {
    activeWorkspace,
    sideLayout,
    status,
    clientRef,
    host,
    port,
    focusMode,
    projectName,
    gitBranch,
    branchMenu,
    toggleBranchMenu,
    setBranchMenu,
    loadBranchMenu,
    createBranch,
    checkoutBranch,
    renameBranch,
    deleteBranch,
    publishBranch,
    setBranchUpstream,
    storageOpen,
    setStorageOpen,
    aiProvidersOpen,
    setAiProvidersOpen,
    refreshAiProviders,
    pluginsOpen,
    setPluginsOpen,
    toolsOpen,
    setToolsOpen,
    changeFocusMode,
    cloudConnection,
    launchConfig,
    disconnect,
    settingsOpen,
    setSettingsOpen,
    changeSideLayout,
    commands,
    shortcutBindings,
    platform,
    changeShortcut,
    resetShortcuts,
    theme,
    highlightTheme,
    uiFontFamily,
    uiFontWeight,
    uiFontSize,
    uiLineHeight,
    workspaceDefaultsRef,
    setTheme,
    setHighlightTheme,
    setUiFontFamily,
    setUiFontWeight,
    setUiFontSize,
    setUiLineHeight,
    setSettingsRevision,
    runProjectActions,
  } = context;
  return (
    <header className="titlebar-actions" aria-label="Workspace toolbar">
      <div className="workspace-identity" title={activeWorkspace}>
        <span className="branding-mark titlebar-branding" aria-hidden="true" />
        <span>{projectName}</span>
      </div>
      <BranchPicker
        current={gitBranch}
        menu={branchMenu}
        onToggle={() => void toggleBranchMenu()}
        onClose={() => setBranchMenu(undefined)}
        onRefresh={() => void loadBranchMenu()}
        onCreate={() => void createBranch()}
        onCheckout={checkoutBranch}
        onRename={renameBranch}
        onDelete={deleteBranch}
        onPublish={publishBranch}
        onSetUpstream={setBranchUpstream}
      />
      <div className="titlebar-spacer" />
      <RunConfigurationToolbar {...runProjectActions} />
      {storageOpen && clientRef.current && (
        <StoragePanel client={clientRef.current} onClose={() => setStorageOpen(false)} />
      )}
      {aiProvidersOpen && clientRef.current && (
        <AiProvidersPanel
          client={clientRef.current}
          onClose={() => setAiProvidersOpen(false)}
          onChanged={() => void refreshAiProviders()}
        />
      )}
      {pluginsOpen && clientRef.current && (
        <PluginsPanel client={clientRef.current} onClose={() => setPluginsOpen(false)} />
      )}
      {toolsOpen && clientRef.current && <ToolsPanel client={clientRef.current} onClose={() => setToolsOpen(false)} />}
      <div className="workspace-utilities">
        <FocusModeButton active={focusMode} onChange={changeFocusMode} />
        <span className="workspace-utility-divider" aria-hidden="true" />
        <ConnectionMenu
          host={host}
          port={port}
          cloudOrigin={cloudConnection ? launchConfig.cloudOrigin : undefined}
          connected={status === "connected"}
          onDisconnect={disconnect}
        />
        <div className="settings-anchor">
          <button
            className="workspace-settings-button"
            aria-label="Settings"
            title="Settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
          {settingsOpen && (
            <SettingsMenu
              onClose={() => setSettingsOpen(false)}
              onStorage={() => {
                setSettingsOpen(false);
                setStorageOpen(true);
              }}
              onAiProviders={() => {
                setSettingsOpen(false);
                setAiProvidersOpen(true);
              }}
              onPlugins={() => {
                setSettingsOpen(false);
                setPluginsOpen(true);
              }}
              onTools={() => {
                setSettingsOpen(false);
                setToolsOpen(true);
              }}
              workspace={activeWorkspace}
              sideLayout={sideLayout}
              onSideLayoutChange={changeSideLayout}
              commands={commands}
              shortcutBindings={shortcutBindings}
              platform={platform}
              onShortcutChange={changeShortcut}
              onShortcutsReset={resetShortcuts}
              values={{ theme, highlightTheme, uiFontFamily, uiFontWeight, uiFontSize, uiLineHeight }}
              isWorkspaceOverride={(setting) => hasWorkspaceSetting(activeWorkspace, setting)}
              onChange={(setting, value) => {
                workspaceDefaultsRef.current.delete(setting);
                if (setting === "theme") setTheme(value as DesktopSettings["theme"]);
                else if (setting === "highlightTheme") setHighlightTheme(value as DesktopSettings["highlightTheme"]);
                else if (setting === "uiFontFamily") setUiFontFamily(value as DesktopSettings["uiFontFamily"]);
                else if (setting === "uiFontWeight") setUiFontWeight(value as number);
                else if (setting === "uiFontSize") setUiFontSize(value as number);
                else setUiLineHeight(value as number);
              }}
              onReset={(setting) => {
                resetWorkspaceSetting(activeWorkspace, setting);
                workspaceDefaultsRef.current.add(setting);
                const value = readSetting(setting);
                if (setting === "theme") setTheme(value === "dark" ? "dark" : "light");
                else if (setting === "highlightTheme")
                  setHighlightTheme(value === "ftpud" || value === "ftpud-dark" ? "ftpud" : "default");
                else if (setting === "uiFontFamily") setUiFontFamily(value === "jetbrains" ? "jetbrains" : "inter");
                else if (setting === "uiFontWeight") setUiFontWeight(readSettingNumber(setting, 450, 350, 600));
                else if (setting === "uiFontSize") setUiFontSize(readSettingNumber(setting, 13, 10, 20));
                else setUiLineHeight(readSettingNumber(setting, 1.2, 1, 2));
                setSettingsRevision((revision) => revision + 1);
              }}
            />
          )}
        </div>
      </div>
    </header>
  );
}
