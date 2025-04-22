import * as vscode from "vscode";

export class SettingsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue?: string,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }
}

export class SettingsTreeDataProvider
  implements vscode.TreeDataProvider<SettingsTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    SettingsTreeItem | undefined | null | void
  > = new vscode.EventEmitter<SettingsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    SettingsTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SettingsTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(
    _element: SettingsTreeItem
  ): vscode.ProviderResult<SettingsTreeItem> {
    return null;
  }

  async getChildren(element?: SettingsTreeItem): Promise<SettingsTreeItem[]> {
    if (!element) {
      // Root level - show setting categories
      return [
        new SettingsTreeItem(
          "Validation Settings",
          vscode.TreeItemCollapsibleState.Expanded,
          "validationSettings"
        ),
        new SettingsTreeItem(
          "Framework Settings",
          vscode.TreeItemCollapsibleState.Expanded,
          "frameworkSettings"
        ),
        new SettingsTreeItem(
          "Performance Settings",
          vscode.TreeItemCollapsibleState.Expanded,
          "performanceSettings"
        ),
        new SettingsTreeItem(
          "Exclusion Settings",
          vscode.TreeItemCollapsibleState.Expanded,
          "exclusionSettings"
        ),
        new SettingsTreeItem(
          "Open Extension Settings",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "workbench.action.openSettings",
            title: "Open Settings",
            arguments: ["npmImportValidator"],
          }
        ),
      ];
    } else if (element.contextValue === "validationSettings") {
      // Validation settings
      const config = vscode.workspace.getConfiguration("npmImportValidator");
      const validateOnSave = config.get<boolean>("validateOnSave")
        ? "Enabled"
        : "Disabled";
      const validateOnOpen = config.get<boolean>("validateOnOpen")
        ? "Enabled"
        : "Disabled";
      const severityLevel = config.get<string>("severityLevel") || "warning";

      return [
        new SettingsTreeItem(
          `Validate on Save: ${validateOnSave}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Validate on Open: ${validateOnOpen}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Severity Level: ${severityLevel}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    } else if (element.contextValue === "frameworkSettings") {
      // Framework settings
      const config = vscode.workspace.getConfiguration("npmImportValidator");
      const frameworkSeverityLevel =
        config.get<string>("frameworkSeverityLevel") || "info";
      const ignoredPackages = config.get<string[]>("ignoredPackages") || [];

      return [
        new SettingsTreeItem(
          `Framework Severity: ${frameworkSeverityLevel}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Framework Packages: ${ignoredPackages.length}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Manage Framework Packages`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "workbench.action.openSettings",
            title: "Manage Framework Packages",
            arguments: ["npmImportValidator.ignoredPackages"],
          }
        ),
      ];
    } else if (element.contextValue === "performanceSettings") {
      // Performance settings
      const config = vscode.workspace.getConfiguration("npmImportValidator");
      const maxFiles = config.get<number>("maxFilesToProcess") || 1000;
      const batchSize = config.get<number>("processingBatchSize") || 20;
      const cacheTimeout = config.get<number>("cacheTimeout") || 86400;

      return [
        new SettingsTreeItem(
          `Max Files: ${maxFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Batch Size: ${batchSize}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Batch Size: ${batchSize}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Cache Timeout: ${cacheTimeout}s`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          "Clear Cache",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.clearCache",
            title: "Clear Cache",
            arguments: [],
          }
        ),
      ];
    } else if (element.contextValue === "exclusionSettings") {
      // Exclusion settings
      const config = vscode.workspace.getConfiguration("npmImportValidator");
      const excludeReactNextjs = config.get<boolean>("excludeReactNextjs")
        ? "Enabled"
        : "Disabled";
      const excludeOtherExtensions = config.get<boolean>(
        "excludeOtherExtensions"
      )
        ? "Enabled"
        : "Disabled";
      const excludeCommonFrameworks = config.get<boolean>(
        "excludeCommonFrameworks"
      )
        ? "Enabled"
        : "Disabled";

      return [
        new SettingsTreeItem(
          `Exclude React/Next.js: ${excludeReactNextjs}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Exclude Common Frameworks: ${excludeCommonFrameworks}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Exclude Other Extensions: ${excludeOtherExtensions}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new SettingsTreeItem(
          `Manage Exclude Patterns`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "workbench.action.openSettings",
            title: "Manage Exclude Patterns",
            arguments: ["npmImportValidator.excludePatterns"],
          }
        ),
      ];
    }

    return [];
  }
}
