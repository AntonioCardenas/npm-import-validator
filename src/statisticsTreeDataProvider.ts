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

  constructor(private fileProcessor: FileProcessor) {}

  refresh(): void {
    // Get fresh stats from the file processor for logging
    const stats = this.fileProcessor.getStats();
    console.log(`Statistics refreshed: Total imports: ${stats.totalImports}`);

    this._onDidChangeTreeData.fire();
  }

  // Add this method to handle explicit refresh requests
  forceRefresh(): void {
    console.log("Force refreshing statistics tree view");
    // Recalculate statistics if needed
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
      const stats = this.fileProcessor.getStats();

      // Log statistics for debugging
      console.log(
        `Displaying statistics: Total imports: ${stats.totalImports}, Valid: ${stats.validImports}, Invalid: ${stats.invalidImports}`
      );

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
          "Project Statistics",
          vscode.TreeItemCollapsibleState.Expanded,
          "projectStats"
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
          `Unchanged Files: ${stats.unchangedFiles}`,
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
      // Framework statistics
      const stats = this.fileProcessor.getStats();

      return [
        new StatisticsTreeItem(
          `Framework Imports: ${stats.frameworkImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    } else if (element.contextValue === "projectStats") {
      // Project statistics
      const stats = this.fileProcessor.getStats();

      return [
        new StatisticsTreeItem(
          `Project Imports: ${stats.projectImports}`,
          vscode.TreeItemCollapsibleState.None
        ),
        new StatisticsTreeItem(
          `Find Unused Dependencies`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.findUnusedDependencies",
            title: "Find Unused Dependencies",
            arguments: [],
          }
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
          `Scan All Files`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.validateWorkspace",
            title: "Scan All Files",
            arguments: [],
          }
        ),
        new StatisticsTreeItem(
          `Scan Changed Files Only`,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          {
            command: "npm-import-validator.validateChangedFiles",
            title: "Scan Changed Files Only",
            arguments: [],
          }
        ),
      ];
    }

    return [];
  }
}
