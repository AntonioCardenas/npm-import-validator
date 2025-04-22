import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = "npm-import-validator.validateImports";
    this.statusBarItem.show();
    this.setIdle();
  }

  // Set status to idle
  setIdle(): void {
    this.statusBarItem.text = "$(package) NPM Imports";
    this.statusBarItem.tooltip = "Validate NPM Imports";
    this.statusBarItem.backgroundColor = undefined;
  }

  // Set status to validating
  setValidating(): void {
    this.statusBarItem.text = "$(sync~spin) Validating NPM Imports...";
    this.statusBarItem.tooltip = "Validating NPM Imports...";
    this.statusBarItem.backgroundColor = undefined;
  }

  // Set status to valid
  setValid(): void {
    this.statusBarItem.text = "$(check) NPM Imports Valid";
    this.statusBarItem.tooltip = "All NPM Imports exist on registry";
    this.statusBarItem.backgroundColor = undefined;
  }

  // Set status to invalid imports
  setInvalidImports(count: number): void {
    this.statusBarItem.text = `$(alert) ${count} Invalid NPM Import${count === 1 ? "" : "s"}`;
    this.statusBarItem.tooltip = `${count} Import${count === 1 ? "" : "s"} not found on npm registry. Click to validate again.`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  }

  // Set status to error
  setError(): void {
    this.statusBarItem.text = "$(error) NPM Import Error";
    this.statusBarItem.tooltip = "Error validating NPM Imports. Click to try again.";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  }

  // Set status to processing workspace
  setProcessingWorkspace(processed: number, total: number): void {
    const percent = Math.min(100, Math.round((processed / Math.max(total, 1)) * 100));
    this.statusBarItem.text = `$(sync~spin) Processing: ${percent}%`;
    this.statusBarItem.tooltip = `Processing ${processed} of ${total} files`;
    this.statusBarItem.backgroundColor = undefined;
  }

  // Get the status bar item
  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }
}
