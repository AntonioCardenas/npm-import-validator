import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private progressInterval: NodeJS.Timeout | null = null;
  private progressDots = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "npm-import-validator.validateImports";
    this.statusBarItem.show();
    this.setIdle();
  }

  // Set status to idle
  setIdle(): void {
    this.clearProgressAnimation();
    this.statusBarItem.text = "$(package) NPM Imports";
    this.statusBarItem.tooltip = "Validate NPM Imports";
    this.statusBarItem.backgroundColor = undefined;
  }

  // Set status to validating
  setValidating(): void {
    this.startProgressAnimation("Validating NPM Imports");
    this.statusBarItem.tooltip = "Validating NPM Imports...";
    this.statusBarItem.backgroundColor = undefined;
  }

  // Set status to valid
  setValid(): void {
    this.clearProgressAnimation();
    this.statusBarItem.text = "$(check) NPM Imports Valid";
    this.statusBarItem.tooltip = "All NPM Imports exist on registry";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.successBackground"
    );

    // Reset to idle after 3 seconds
    setTimeout(() => {
      this.setIdle();
    }, 3000);
  }

  // Set status to invalid imports
  setInvalidImports(count: number): void {
    this.clearProgressAnimation();
    this.statusBarItem.text = `$(alert) ${count} Invalid NPM Import${
      count === 1 ? "" : "s"
    }`;
    this.statusBarItem.tooltip = `${count} Import${
      count === 1 ? "" : "s"
    } not found on npm registry. Click to validate again.`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }

  // Set status to error
  setError(): void {
    this.clearProgressAnimation();
    this.statusBarItem.text = "$(error) NPM Import Error";
    this.statusBarItem.tooltip =
      "Error validating NPM Imports. Click to try again.";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
  }

  // Set status to processing workspace
  setProcessingWorkspace(processed: number, total: number): void {
    const percent = Math.min(
      100,
      Math.round((processed / Math.max(total, 1)) * 100)
    );
    this.clearProgressAnimation();
    this.startProgressAnimation(`Processing: ${percent}%`);
    this.statusBarItem.tooltip = `Processing ${processed} of ${total} files`;
    this.statusBarItem.backgroundColor = undefined;
  }

  // Start progress animation
  private startProgressAnimation(baseText: string): void {
    this.clearProgressAnimation();
    this.progressDots = 0;

    // Update immediately
    this.updateProgressText(baseText);

    // Then start interval
    this.progressInterval = setInterval(() => {
      this.updateProgressText(baseText);
    }, 500);
  }

  // Update progress text with dots
  private updateProgressText(baseText: string): void {
    this.progressDots = (this.progressDots + 1) % 4;
    const dots = ".".repeat(this.progressDots);
    this.statusBarItem.text = `$(sync~spin) ${baseText}${dots}`;
  }

  // Clear progress animation
  private clearProgressAnimation(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  // Get the status bar item
  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  // Dispose resources
  dispose(): void {
    this.clearProgressAnimation();
    this.statusBarItem.dispose();
  }
}
