import * as vscode from "vscode";
import { ImportValidator } from "./importValidator";
import { DiagnosticsManager } from "./diagnosticsManager";
import { StatusBarManager } from "./statusBarManager";
import { CommandManager } from "./commandManager";
import { PackageInfoProvider } from "./packageInfoProvider";
import { ImportsTreeDataProvider } from "./importsTreeDataProvider";
import { CodeLensProvider } from "./codeLensProvider";
import { FileProcessor } from "./fileProcessor";
import { ensureActivation } from "./activation";
import { StatisticsTreeDataProvider } from "./statisticsTreeDataProvider";
import { SettingsTreeDataProvider } from "./settingsTreeDataProvider";
import { DependencyManager } from "./dependencyManager";

// Extension activation
export async function activate(context: vscode.ExtensionContext) {
  console.log("NPM Import Validator is now active");

  // Ensure proper activation
  const activationSuccessful = await ensureActivation();
  if (!activationSuccessful) {
    vscode.window.showErrorMessage(
      "NPM Import Validator could not be fully activated. Some features may not work."
    );
  }

  // Create instances of our managers and providers
  const packageInfoProvider = new PackageInfoProvider(context.globalState);
  const validator = new ImportValidator(packageInfoProvider);
  const diagnosticsManager = new DiagnosticsManager();
  const statusBarManager = new StatusBarManager();
  const commandManager = new CommandManager(
    validator,
    diagnosticsManager,
    packageInfoProvider
  );
  const fileProcessor = new FileProcessor(
    validator,
    diagnosticsManager,
    statusBarManager,
    context
  );
  const importsTreeDataProvider = new ImportsTreeDataProvider(
    validator,
    fileProcessor
  );
  const statisticsTreeDataProvider = new StatisticsTreeDataProvider(
    fileProcessor
  );
  const settingsTreeDataProvider = new SettingsTreeDataProvider();
  const codeLensProvider = new CodeLensProvider(validator, packageInfoProvider);
  const dependencyManager = new DependencyManager(fileProcessor);

  // Set context to ensure views are visible
  await vscode.commands.executeCommand(
    "setContext",
    "npmImportValidatorReady",
    true
  );

  // Register tree data providers directly
  vscode.window.registerTreeDataProvider("npmImports", importsTreeDataProvider);
  vscode.window.registerTreeDataProvider(
    "npmStatistics",
    statisticsTreeDataProvider
  );
  vscode.window.registerTreeDataProvider(
    "npmSettings",
    settingsTreeDataProvider
  );

  // Register tree views with the registered providers
  const importsTreeView = vscode.window.createTreeView("npmImports", {
    treeDataProvider: importsTreeDataProvider,
    showCollapseAll: true,
  });

  const statisticsTreeView = vscode.window.createTreeView("npmStatistics", {
    treeDataProvider: statisticsTreeDataProvider,
    showCollapseAll: true,
  });

  const settingsTreeView = vscode.window.createTreeView("npmSettings", {
    treeDataProvider: settingsTreeDataProvider,
    showCollapseAll: true,
  });

  // Store the tree views in context.subscriptions to ensure proper disposal
  context.subscriptions.push(
    importsTreeView,
    statisticsTreeView,
    settingsTreeView
  );

  // Make sure the tree data providers are properly initialized
  importsTreeDataProvider.refresh();
  statisticsTreeDataProvider.refresh();
  settingsTreeDataProvider.refresh();

  // Register code lens provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "javascript" },
        { language: "javascriptreact" },
        { language: "typescript" },
        { language: "typescriptreact" },
      ],
      codeLensProvider
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.validateImports",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && isValidFileType(editor.document)) {
          await fileProcessor.processFile(editor.document);
          importsTreeDataProvider.refresh();
          statisticsTreeDataProvider.refresh();
        } else {
          vscode.window.showInformationMessage(
            "No active JavaScript or TypeScript file to validate."
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.validateWorkspace",
      async () => {
        // Reset statistics before processing
        fileProcessor.resetStatistics();

        const stats = await fileProcessor.processWorkspace(true, false); // Process all files
        vscode.window.showInformationMessage(
          `Validation complete: ${stats.processedFiles} files processed, ` +
            `${stats.totalImports} imports found, ${stats.invalidImports} invalid imports, ` +
            `${stats.projectImports} project imports.`
        );
        importsTreeDataProvider.refresh();
        statisticsTreeDataProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.validateChangedFiles",
      async () => {
        // Reset statistics before processing
        fileProcessor.resetStatistics();

        const stats = await fileProcessor.processWorkspace(true, true); // Process only changed files
        vscode.window.showInformationMessage(
          `Validation complete: ${stats.processedFiles} files processed, ` +
            `${stats.unchangedFiles} unchanged files skipped, ` +
            `${stats.totalImports} imports found, ${stats.invalidImports} invalid imports.`
        );
        importsTreeDataProvider.refresh();
        statisticsTreeDataProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.findUnusedDependencies",
      async () => {
        await dependencyManager.showUnusedDependencies();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.cancelValidation",
      () => {
        fileProcessor.cancelProcessing();
        vscode.window.showInformationMessage("Import validation cancelled.");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.clearCache", () => {
      validator.clearCaches();
      packageInfoProvider.clearCache();
      fileProcessor.clearCaches();
      vscode.window.showInformationMessage(
        "NPM Import Validator cache cleared."
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showPackageInfo",
      async (packageName) => {
        await commandManager.showPackageInfo(packageName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.openNpmPage",
      (packageName: string) => {
        vscode.env.openExternal(
          vscode.Uri.parse(`https://www.npmjs.com/package/${packageName}`)
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showAllImports",
      async () => {
        // First, focus the view container
        await vscode.commands.executeCommand(
          "workbench.view.extension.npm-import-validator"
        );

        // Refresh the tree data provider
        importsTreeDataProvider.refresh();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showStats",
      async () => {
        const stats = fileProcessor.getStats();
        const panel = vscode.window.createWebviewPanel(
          "npmImportStats",
          "NPM Import Validator Stats",
          vscode.ViewColumn.One,
          { enableScripts: true }
        );

        panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>NPM Import Validator Stats</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              padding: 20px;
              color: var(--vscode-foreground);
              background-color: var(--vscode-editor-background);
            }
            .stat-card {
              background-color: var(--vscode-editor-inactiveSelectionBackground);
              border-radius: 5px;
              padding: 15px;
              margin-bottom: 15px;
            }
            .stat-title {
              font-size: 14px;
              color: var(--vscode-descriptionForeground);
              margin-bottom: 5px;
            }
            .stat-value {
              font-size: 24px;
              font-weight: bold;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
              gap: 15px;
            }
            .progress-container {
              margin-top: 20px;
              background-color: var(--vscode-editor-inactiveSelectionBackground);
              border-radius: 10px;
              height: 10px;
              overflow: hidden;
            }
            .progress-bar {
              height: 100%;
              background-color: var(--vscode-progressBar-background);
              width: ${
                (stats.processedFiles / Math.max(stats.totalFiles, 1)) * 100
              }%;
            }
            h1 {
              margin-bottom: 20px;
            }
            .time {
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
              margin-top: 5px;
            }
            .section {
              margin-bottom: 30px;
            }
            .section-title {
              font-size: 18px;
              font-weight: bold;
              margin-bottom: 15px;
              color: var(--vscode-descriptionForeground);
            }
          </style>
        </head>
        <body>
          <h1>NPM Import Validator Statistics</h1>
          
          <div class="section">
            <div class="section-title">FILE STATISTICS</div>
            <div class="grid">
              <div class="stat-card">
                <div class="stat-title">Total Files</div>
                <div class="stat-value">${stats.totalFiles}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Processed Files</div>
                <div class="stat-value">${stats.processedFiles}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Unchanged Files</div>
                <div class="stat-value">${stats.unchangedFiles}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Skipped Files</div>
                <div class="stat-value">${stats.skippedFiles}</div>
              </div>
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">IMPORT STATISTICS</div>
            <div class="grid">
              <div class="stat-card">
                <div class="stat-title">Total Imports</div>
                <div class="stat-value">${stats.totalImports}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Valid Imports</div>
                <div class="stat-value">${stats.validImports}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Invalid Imports</div>
                <div class="stat-value">${stats.invalidImports}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Project Imports</div>
                <div class="stat-value">${stats.projectImports}</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Framework Imports</div>
                <div class="stat-value">${stats.frameworkImports}</div>
              </div>
            </div>
          </div>
          
          <div class="section">
            <div class="section-title">PROCESSING PROGRESS</div>
            <div class="stat-card">
              <div class="stat-title">Processing Progress</div>
              <div class="progress-container">
                <div class="progress-bar"></div>
              </div>
              <div class="time">Processing time: ${Math.round(
                stats.processingTime
              )}ms</div>
            </div>
          </div>
        </body>
        </html>
      `;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.refreshStatistics",
      () => {
        // Use the standard refresh method
        statisticsTreeDataProvider.refresh();
        vscode.window.showInformationMessage("Statistics refreshed.");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.recalculateStatistics",
      async () => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Recalculating NPM Import Statistics",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Recalculating statistics..." });
            await fileProcessor.recalculateStatistics();
            // Use the standard refresh method
            statisticsTreeDataProvider.refresh();
            importsTreeDataProvider.refresh();
          }
        );
        vscode.window.showInformationMessage("Statistics recalculated.");
      }
    )
  );

  // Register status bar item
  context.subscriptions.push(statusBarManager.getStatusBarItem());

  // Register event listeners
  if (
    vscode.workspace
      .getConfiguration("npmImportValidator")
      .get("validateOnSave")
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (
          isValidFileType(document) &&
          fileProcessor.shouldProcessFile(document.uri.fsPath)
        ) {
          fileProcessor.processFile(document);
          importsTreeDataProvider.refresh();
          statisticsTreeDataProvider.refresh();
        }
      })
    );
  }

  if (
    vscode.workspace
      .getConfiguration("npmImportValidator")
      .get("validateOnOpen")
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (
          isValidFileType(document) &&
          fileProcessor.shouldProcessFile(document.uri.fsPath)
        ) {
          fileProcessor.processFile(document);
          importsTreeDataProvider.refresh();
          statisticsTreeDataProvider.refresh();
        }
      })
    );
  }

  // Listen for active editor changes to update the tree view
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (
        editor &&
        isValidFileType(editor.document) &&
        fileProcessor.shouldProcessFile(editor.document.uri.fsPath)
      ) {
        importsTreeDataProvider.refresh();
        statisticsTreeDataProvider.refresh();
      }
    })
  );

  // Validate the current file if one is open
  if (vscode.window.activeTextEditor) {
    const document = vscode.window.activeTextEditor.document;
    if (
      isValidFileType(document) &&
      fileProcessor.shouldProcessFile(document.uri.fsPath)
    ) {
      fileProcessor.processFile(document);
      importsTreeDataProvider.refresh();
      statisticsTreeDataProvider.refresh();
    }
  }

  // Register disposable for cleanup
  context.subscriptions.push({
    dispose: () => {
      if (packageInfoProvider.dispose) {
        packageInfoProvider.dispose();
      }
      if (fileProcessor.dispose) {
        fileProcessor.dispose();
      }
    },
  });
}

// Check if the document is a JavaScript or TypeScript file
function isValidFileType(document: vscode.TextDocument): boolean {
  return [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
  ].includes(document.languageId);
}

// Extension deactivation
export function deactivate() {
  console.log("NPM Import Validator is now deactivated");
}
