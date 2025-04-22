import * as vscode from "vscode";
import type { ImportValidator, ImportResult } from "./importValidator";
import type { FileProcessor } from "./fileProcessor";

export class ImportsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly importResult?: ImportResult,
    public readonly contextValue?: string,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }
}

export class ImportsTreeDataProvider
  implements vscode.TreeDataProvider<ImportsTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ImportsTreeItem | undefined | null | void
  > = new vscode.EventEmitter<ImportsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ImportsTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // Store the root items for potential use in reveal()
  private rootItems: ImportsTreeItem[] = [];

  constructor(
    private validator: ImportValidator,
    private fileProcessor: FileProcessor
  ) {}

  // Add this method to get a root item if needed for reveal()
  getRootItem(): ImportsTreeItem | undefined {
    return this.rootItems.length > 0 ? this.rootItems[0] : undefined;
  }

  // Fix the unused parameter warning by using underscore prefix
  // This tells ESLint that we intentionally don't use this parameter
  getParent(_element: ImportsTreeItem): vscode.ProviderResult<ImportsTreeItem> {
    return null; // Simple implementation - can be enhanced for better navigation
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ImportsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ImportsTreeItem): Promise<ImportsTreeItem[]> {
    if (!element) {
      // Root level - show current file, workspace, and stats
      const items: ImportsTreeItem[] = [];

      // Current file
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        items.push(
          new ImportsTreeItem(
            "Current File",
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            "currentFile"
          )
        );
      }

      // Workspace
      items.push(
        new ImportsTreeItem(
          "Workspace",
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          "workspace"
        )
      );

      // Stats
      items.push(
        new ImportsTreeItem(
          "Statistics",
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          "stats",
          {
            command: "npm-import-validator.showStats",
            title: "Show Statistics",
            arguments: [],
          }
        )
      );

      // Store the root items
      this.rootItems = items;

      return items;
    } else if (element.contextValue === "currentFile") {
      // Show imports in current file
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);

      // Group by validity, type, and framework status
      const validImports = results.filter(
        (r) => r.existsOnNpm && !r.isFramework
      );
      const invalidImports = results.filter(
        (r) => !r.existsOnNpm && !r.isFramework
      );
      const frameworkImports = results.filter((r) => r.isFramework);
      const _validFrameworkImports = frameworkImports.filter(
        (r) => r.existsOnNpm
      );
      const _invalidFrameworkImports = frameworkImports.filter(
        (r) => !r.existsOnNpm
      );

      // Count by type
      const esImports = results.filter((r) => r.importType === "import").length;
      const requireImports = results.filter(
        (r) => r.importType === "require"
      ).length;

      const items: ImportsTreeItem[] = [];

      // Add import type counts
      if (esImports > 0 || requireImports > 0) {
        const typesItem = new ImportsTreeItem(
          `Import Types`,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          "importTypes"
        );
        typesItem.tooltip = "Breakdown of import types in this file";
        items.push(typesItem);
      }

      // Add framework imports section
      if (frameworkImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Framework Imports (${frameworkImports.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            "frameworkImports"
          )
        );
      }

      if (validImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Valid Imports (${validImports.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            "validImports"
          )
        );
      }

      if (invalidImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Invalid Imports (${invalidImports.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            "invalidImports"
          )
        );
      }

      return items;
    } else if (element.contextValue === "frameworkImports") {
      // Show framework imports
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const frameworkImports = results.filter((r) => r.isFramework);

      // Separate valid and invalid framework imports
      const validFrameworkImports = frameworkImports.filter(
        (r) => r.existsOnNpm
      );
      const invalidFrameworkImports = frameworkImports.filter(
        (r) => !r.existsOnNpm
      );

      const items: ImportsTreeItem[] = [];

      if (validFrameworkImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Valid Framework (${validFrameworkImports.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            "validFrameworkImports"
          )
        );
      }

      if (invalidFrameworkImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Invalid Framework (${invalidFrameworkImports.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            "invalidFrameworkImports"
          )
        );
      }

      return items;
    } else if (element.contextValue === "validFrameworkImports") {
      // Show valid framework imports
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const validFrameworkImports = results.filter(
        (r) => r.isFramework && r.existsOnNpm
      );

      return validFrameworkImports.map((result) => {
        const command = {
          command: "npm-import-validator.showPackageInfo",
          title: "Show Package Info",
          arguments: [result.importName],
        };

        const item = new ImportsTreeItem(
          result.importName,
          vscode.TreeItemCollapsibleState.None,
          result,
          "frameworkImport",
          command
        );

        item.description = `${result.packageInfo?.version || ""} (${
          result.importType
        })`;
        item.tooltip = result.packageInfo?.description || "";
        item.iconPath = new vscode.ThemeIcon("library");

        return item;
      });
    } else if (element.contextValue === "invalidFrameworkImports") {
      // Show invalid framework imports
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const invalidFrameworkImports = results.filter(
        (r) => r.isFramework && !r.existsOnNpm
      );

      return invalidFrameworkImports.map((result) => {
        const command = {
          command: "npm-import-validator.showPackageInfo",
          title: "Show Package Info",
          arguments: [result.importName],
        };

        const item = new ImportsTreeItem(
          result.importName,
          vscode.TreeItemCollapsibleState.None,
          result,
          "invalidFrameworkImport",
          command
        );

        item.description = `Not found (${result.importType})`;
        item.iconPath = new vscode.ThemeIcon("warning");
        item.tooltip =
          "Framework package not found on npm registry - may be misspelled or deprecated";

        return item;
      });
    } else if (element.contextValue === "importTypes") {
      // Show import type breakdown
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);

      // Count by type
      const esImports = results.filter((r) => r.importType === "import").length;
      const requireImports = results.filter(
        (r) => r.importType === "require"
      ).length;

      return [
        new ImportsTreeItem(
          `ES6 Imports: ${esImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          "importTypeCount"
        ),
        new ImportsTreeItem(
          `CommonJS Requires: ${requireImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          "importTypeCount"
        ),
      ];
    } else if (element.contextValue === "validImports") {
      // Show valid imports (excluding framework imports)
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const validImports = results.filter(
        (r) => r.existsOnNpm && !r.isFramework
      );

      return validImports.map((result) => {
        const command = {
          command: "npm-import-validator.showPackageInfo",
          title: "Show Package Info",
          arguments: [result.importName],
        };

        const item = new ImportsTreeItem(
          result.importName,
          vscode.TreeItemCollapsibleState.None,
          result,
          "import",
          command
        );

        item.description = `${result.packageInfo?.version || ""} (${
          result.importType
        })`;
        item.tooltip = result.packageInfo?.description || "";
        item.iconPath = new vscode.ThemeIcon("package");

        return item;
      });
    } else if (element.contextValue === "invalidImports") {
      // Show invalid imports (excluding framework imports)
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const invalidImports = results.filter(
        (r) => !r.existsOnNpm && !r.isFramework
      );

      return invalidImports.map((result) => {
        const command = {
          command: "npm-import-validator.showPackageInfo",
          title: "Show Package Info",
          arguments: [result.importName],
        };

        const item = new ImportsTreeItem(
          result.importName,
          vscode.TreeItemCollapsibleState.None,
          result,
          "invalidImport",
          command
        );

        item.description = `Not found (${result.importType})`;
        item.iconPath = new vscode.ThemeIcon("error");
        item.tooltip = "Package not found on npm registry";

        return item;
      });
    } else if (element.contextValue === "workspace") {
      // Show workspace stats
      const stats = this.fileProcessor.getStats();

      return [
        new ImportsTreeItem(
          `Scan Workspace`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.validateWorkspace",
            title: "Scan Workspace",
            arguments: [],
          }
        ),
        new ImportsTreeItem(
          `Total Files: ${stats.totalFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new ImportsTreeItem(
          `Processed Files: ${stats.processedFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new ImportsTreeItem(
          `Total Imports: ${stats.totalImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new ImportsTreeItem(
          `Valid Imports: ${stats.validImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.showAllImports",
            title: "Show All Imports",
            arguments: [],
          }
        ),
        new ImportsTreeItem(
          `Invalid Imports: ${stats.invalidImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.showAllImports",
            title: "Show All Imports",
            arguments: [],
          }
        ),
      ];
    } else if (element.contextValue === "stats") {
      // Show detailed stats
      const stats = this.fileProcessor.getStats();

      return [
        new ImportsTreeItem(
          `View Detailed Statistics`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.showStats",
            title: "Show Statistics",
            arguments: [],
          }
        ),
        new ImportsTreeItem(
          `Processing Time: ${Math.round(stats.processingTime)}ms`,
          vscode.TreeItemCollapsibleState.None
        ),
        new ImportsTreeItem(
          `Skipped Files: ${stats.skippedFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    return [];
  }
}
