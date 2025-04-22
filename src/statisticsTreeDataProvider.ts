import * as vscode from "vscode";
import type { FileProcessor } from "./fileProcessor";

export class StatisticsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue?: string,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }
}

export class StatisticsTreeDataProvider
  implements vscode.TreeDataProvider<StatisticsTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    StatisticsTreeItem | undefined | null | void
  > = new vscode.EventEmitter<StatisticsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    StatisticsTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(public fileProcessor: FileProcessor) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StatisticsTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(
    _element: StatisticsTreeItem
  ): vscode.ProviderResult<StatisticsTreeItem> {
    return null;
  }

  async getChildren(
    element?: StatisticsTreeItem
  ): Promise<StatisticsTreeItem[]> {
    if (!element) {
      // Root level - show statistics categories

      return [
        new StatisticsTreeItem(
          "File Statistics",
          vscode.TreeItemCollapsibleState.Expanded,
          "fileStats"
        ),
        new StatisticsTreeItem(
          "Import Statistics",
          vscode.TreeItemCollapsibleState.Expanded,
          "importStats"
        ),
        new StatisticsTreeItem(
          "Framework Statistics",
          vscode.TreeItemCollapsibleState.Expanded,
          "frameworkStats"
        ),
        new StatisticsTreeItem(
          "Performance",
          vscode.TreeItemCollapsibleState.Expanded,
          "performanceStats"
        ),
        new StatisticsTreeItem(
          "View Detailed Dashboard",
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.showStats",
            title: "Show Statistics Dashboard",
            arguments: [],
          }
        ),
      ];
    } else if (element.contextValue === "fileStats") {
      // File statistics
      const stats = this.fileProcessor.getStats();

      return [
        new StatisticsTreeItem(
          `Total Files: ${stats.totalFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Processed Files: ${stats.processedFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Skipped Files: ${stats.skippedFiles}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    } else if (element.contextValue === "importStats") {
      // Import statistics
      const stats = this.fileProcessor.getStats();

      return [
        new StatisticsTreeItem(
          `Total Imports: ${stats.totalImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Valid Imports: ${stats.validImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Invalid Imports: ${stats.invalidImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    } else if (element.contextValue === "frameworkStats") {
      // Framework statistics - we'll need to calculate these
      const editor = vscode.window.activeTextEditor;
      let frameworkCount = 0;
      let validFrameworkCount = 0;
      let invalidFrameworkCount = 0;

      if (editor) {
        const results = await this.fileProcessor.validator.validateDocument(
          editor.document
        );
        const frameworkImports = results.filter((r) => r.isFramework);
        frameworkCount = frameworkImports.length;
        validFrameworkCount = frameworkImports.filter(
          (r) => r.existsOnNpm
        ).length;
        invalidFrameworkCount = frameworkImports.filter(
          (r) => !r.existsOnNpm
        ).length;
      }

      return [
        new StatisticsTreeItem(
          `Framework Imports: ${frameworkCount}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Valid Framework: ${validFrameworkCount}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Invalid Framework: ${invalidFrameworkCount}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    } else if (element.contextValue === "performanceStats") {
      // Performance statistics
      const stats = this.fileProcessor.getStats();

      return [
        new StatisticsTreeItem(
          `Processing Time: ${Math.round(stats.processingTime)}ms`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Scan Workspace Again`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.validateWorkspace",
            title: "Scan Workspace",
            arguments: [],
          }
        ),
      ];
    }

    return [];
  }
}
