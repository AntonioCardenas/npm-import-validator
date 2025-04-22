import * as vscode from "vscode";
import type { ImportValidator, ImportResult } from "./importValidator";

export class ImportsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly importResult?: ImportResult,
    public readonly contextValue?: string,
    public readonly command?: vscode.Command,
  ) {
    super(label, collapsibleState);
  }
}

export class ImportsTreeDataProvider implements vscode.TreeDataProvider<ImportsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ImportsTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ImportsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ImportsTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  // Store the root items for potential use in reveal()
  private rootItems: ImportsTreeItem[] = [];

  constructor(private validator: ImportValidator) {}

  // Add this method to get a root item if needed for reveal()
  getRootItem(): ImportsTreeItem | undefined {
    return this.rootItems.length > 0 ? this.rootItems[0] : undefined;
  }

  // Fix the unused parameter warning by using underscore prefix
  // This tells ESLint that we intentionally don't use this parameter
  getParent(): vscode.ProviderResult<ImportsTreeItem> {
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
      // Root level - show current file and workspace
      const items: ImportsTreeItem[] = [];

      // Current file
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        items.push(
          new ImportsTreeItem("Current File", vscode.TreeItemCollapsibleState.Expanded, undefined, "currentFile"),
        );
      }

      // Workspace
      items.push(new ImportsTreeItem("Workspace", vscode.TreeItemCollapsibleState.Collapsed, undefined, "workspace"));

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

      // Group by validity
      const validImports = results.filter((r) => r.existsOnNpm);
      const invalidImports = results.filter((r) => !r.existsOnNpm);

      const items: ImportsTreeItem[] = [];

      if (validImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Valid Imports (${validImports.length})`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            "validImports",
          ),
        );
      }

      if (invalidImports.length > 0) {
        items.push(
          new ImportsTreeItem(
            `Invalid Imports (${invalidImports.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            "invalidImports",
          ),
        );
      }

      return items;
    } else if (element.contextValue === "validImports") {
      // Show valid imports
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const validImports = results.filter((r) => r.existsOnNpm);

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
          command,
        );

        item.description = result.packageInfo?.version || "";
        item.tooltip = result.packageInfo?.description || "";
        item.iconPath = new vscode.ThemeIcon("package");

        return item;
      });
    } else if (element.contextValue === "invalidImports") {
      // Show invalid imports
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return [];
      }

      const results = await this.validator.validateDocument(editor.document);
      const invalidImports = results.filter((r) => !r.existsOnNpm);

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
          command,
        );

        item.description = "Not found on npm";
        item.iconPath = new vscode.ThemeIcon("error");
        item.tooltip = "Package not found on npm registry";

        return item;
      });
    } else if (element.contextValue === "workspace") {
      // Show workspace stats
      const allImports = await this.validator.getAllImportsInWorkspace();

      let totalImports = 0;
      let validImports = 0;
      let invalidImports = 0;

      allImports.forEach((imports) => {
        totalImports += imports.length;
        validImports += imports.filter((i) => i.existsOnNpm).length;
        invalidImports += imports.filter((i) => !i.existsOnNpm).length;
      });

      return [
        new ImportsTreeItem(`Total Files: ${allImports.size}`, vscode.TreeItemCollapsibleState.None),
        new ImportsTreeItem(`Total Imports: ${totalImports}`, vscode.TreeItemCollapsibleState.None),
        new ImportsTreeItem(
          `Valid Imports: ${validImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.showAllImports",
            title: "Show All Imports",
            arguments: [],
          },
        ),
        new ImportsTreeItem(
          `Invalid Imports: ${invalidImports}`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          undefined,
          {
            command: "npm-import-validator.showAllImports",
            title: "Show All Imports",
            arguments: [],
          },
        ),
      ];
    }

    return [];
  }
}
