import * as vscode from "vscode";
import { marked } from "marked";
import type { ImportValidator } from "./importValidator";
import type { DiagnosticsManager } from "./diagnosticsManager";
import type { PackageInfoProvider } from "./packageInfoProvider";

export class CommandManager {
  constructor(
    private validator: ImportValidator,
    private diagnosticsManager: DiagnosticsManager,
    private packageInfoProvider: PackageInfoProvider,
  ) {}

  // Show package info in a webview
  async showPackageInfo(packageNameArg?: string): Promise<void> {
    let packageName = packageNameArg;

    if (!packageName) {
      // If no package name provided, try to get it from cursor position
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const document = editor.document;
      const position = editor.selection.active;

      // Get all imports in the document
      const results = await this.validator.validateDocument(document);

      // Find the import at the cursor position
      const importAtCursor = results.find((result) => result.range.contains(position));

      if (importAtCursor) {
        packageName = importAtCursor.importName;
      } else {
        // If no import at cursor, show a quick pick to select a package
        const packageNames = results.map((result) => result.importName);
        if (packageNames.length === 0) {
          vscode.window.showInformationMessage("No npm packages found in this file");
          return;
        }

        packageName = await vscode.window.showQuickPick(packageNames, {
          placeHolder: "Select a package to view information",
        });

        if (!packageName) {
          return; // User cancelled
        }
      }
    }

    // Get package info
    const packageInfo = await this.packageInfoProvider.getPackageInfo(packageName);

    if (!packageInfo) {
      vscode.window.showInformationMessage(`Package '${packageName}' not found on npm registry`);
      return;
    }

    // Create and show webview
    const panel = vscode.window.createWebviewPanel("npmPackageInfo", `NPM: ${packageName}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    // Format keywords
    const keywordsHtml =
      packageInfo.keywords.length > 0
        ? `<div class="keywords">${packageInfo.keywords.map((k) => `<span class="keyword">${k}</span>`).join(" ")}</div>`
        : "";

    // Format repository URL
    let repoUrl = packageInfo.repository;
    if (repoUrl.startsWith("git+")) {
      repoUrl = repoUrl.substring(4);
    }
    if (repoUrl.endsWith(".git")) {
      repoUrl = repoUrl.substring(0, repoUrl.length - 4);
    }

    // Format description with markdown
    const description = packageInfo.description
      ? marked.parse(packageInfo.description)
      : "<em>No description available</em>";

    panel.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NPM Package: ${packageName}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
          }
          .header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
          }
          .logo {
            width: 50px;
            height: 50px;
            margin-right: 15px;
            background-color: #cb3837;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 20px;
          }
          .title {
            flex: 1;
          }
          h1 {
            margin: 0;
            font-size: 24px;
          }
          .version {
            display: inline-block;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 20px;
            font-size: 12px;
            margin-left: 10px;
          }
          .stats {
            display: flex;
            margin-bottom: 20px;
            gap: 20px;
          }
          .stat {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px 15px;
            border-radius: 5px;
          }
          .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
          }
          .stat-value {
            font-size: 16px;
            font-weight: bold;
          }
          .description {
            margin-bottom: 20px;
            line-height: 1.5;
          }
          .links {
            margin-bottom: 20px;
          }
          .links a {
            display: inline-block;
            margin-right: 15px;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
          }
          .links a:hover {
            text-decoration: underline;
          }
          .keywords {
            margin-top: 20px;
          }
          .keyword {
            display: inline-block;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 3px 8px;
            border-radius: 3px;
            margin-right: 5px;
            margin-bottom: 5px;
            font-size: 12px;
          }
          .section {
            margin-bottom: 20px;
          }
          .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-descriptionForeground);
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">npm</div>
          <div class="title">
            <h1>${packageInfo.name} <span class="version">v${packageInfo.version}</span></h1>
          </div>
        </div>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Downloads (last month)</div>
            <div class="stat-value">${packageInfo.downloads.toLocaleString()}</div>
          </div>
          <div class="stat">
            <div class="stat-label">License</div>
            <div class="stat-value">${packageInfo.license}</div>
          </div>
          ${
            packageInfo.author
              ? `
          <div class="stat">
            <div class="stat-label">Author</div>
            <div class="stat-value">${packageInfo.author}</div>
          </div>
          `
              : ""
          }
        </div>
        
        <div class="section">
          <div class="section-title">DESCRIPTION</div>
          <div class="description">${description}</div>
          ${keywordsHtml}
        </div>
        
        <div class="links">
          <a href="https://www.npmjs.com/package/${packageInfo.name}" target="_blank">NPM Page</a>
          ${packageInfo.homepage ? `<a href="${packageInfo.homepage}" target="_blank">Homepage</a>` : ""}
          ${repoUrl ? `<a href="${repoUrl}" target="_blank">Repository</a>` : ""}
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
        </script>
      </body>
      </html>
    `;
  }
}
