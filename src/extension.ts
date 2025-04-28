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
import { scanWorkspaceFiles, processBatchedFiles } from "./example";
import { clearFileCache } from "./utils/file-utils";
import type { ProcessingStats } from "./fileProcessor";

/**
 * Extension activation
 */
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

  // Register tree data providers and views
  registerTreeProviders(
    context,
    importsTreeDataProvider,
    statisticsTreeDataProvider,
    settingsTreeDataProvider
  );

  // Register code lens provider
  registerCodeLensProvider(context, codeLensProvider);

  // Register commands
  registerCommands(
    context,
    validator,
    packageInfoProvider,
    fileProcessor,
    commandManager,
    importsTreeDataProvider,
    statisticsTreeDataProvider
  );

  // Register status bar item
  context.subscriptions.push(statusBarManager.getStatusBarItem());

  // Register event listeners
  registerEventListeners(
    context,
    fileProcessor,
    importsTreeDataProvider,
    statisticsTreeDataProvider
  );

  // Validate the current file if one is open
  validateCurrentFile(
    fileProcessor,
    importsTreeDataProvider,
    statisticsTreeDataProvider
  );

  // Register disposable for cleanup
  context.subscriptions.push({
    dispose: () => {
      if (packageInfoProvider.dispose) {
        packageInfoProvider.dispose();
      }
    },
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.scanWorkspaceFiles",
      scanWorkspaceFiles
    ),
    vscode.commands.registerCommand(
      "extension.processBatchedFiles",
      processBatchedFiles
    ),
    vscode.commands.registerCommand("extension.clearWorkspaceCache", () => {
      // Fix: Use fileProcessor.clearCaches() instead of fileProcessor.clearFileCache()
      fileProcessor.clearCaches();
      // Also clear the file-utils cache for completeness
      clearFileCache();
      vscode.window.showInformationMessage("Workspace file cache cleared");
    })
  );
}

/**
 * Registers tree providers and views
 */
function registerTreeProviders(
  context: vscode.ExtensionContext,
  importsTreeDataProvider: ImportsTreeDataProvider,
  statisticsTreeDataProvider: StatisticsTreeDataProvider,
  settingsTreeDataProvider: SettingsTreeDataProvider
): void {
  // IMPORTANT: Register the tree data providers BEFORE creating the tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "npmImports",
      importsTreeDataProvider
    ),
    vscode.window.registerTreeDataProvider(
      "npmStatistics",
      statisticsTreeDataProvider
    ),
    vscode.window.registerTreeDataProvider(
      "npmSettings",
      settingsTreeDataProvider
    )
  );

  // Now create the tree views with the registered data providers
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
}

/**
 * Registers code lens provider
 */
function registerCodeLensProvider(
  context: vscode.ExtensionContext,
  codeLensProvider: CodeLensProvider
): void {
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
}

/**
 * Registers commands
 */
function registerCommands(
  context: vscode.ExtensionContext,
  validator: ImportValidator,
  packageInfoProvider: PackageInfoProvider,
  fileProcessor: FileProcessor,
  commandManager: CommandManager,
  importsTreeDataProvider: ImportsTreeDataProvider,
  statisticsTreeDataProvider: StatisticsTreeDataProvider
): void {
  // Validate imports in current file
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

  // Validate workspace
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.validateWorkspace",
      async () => {
        console.log("Starting workspace validation");

        // Show a notification that we're starting to scan
        vscode.window.showInformationMessage(
          "Starting NPM Import Validator workspace scan..."
        );

        const stats = await fileProcessor.processWorkspace({
          forceReprocess: true,
        });

        // Create a detailed message with project information
        const message =
          `Validation complete: ${stats.processedFiles} of ${stats.totalFiles} files processed, ` +
          `${stats.totalImports} imports found, ${stats.invalidImports} invalid imports, ` +
          `${stats.projectImports} project imports.`;

        console.log(message);
        vscode.window.showInformationMessage(message);

        // Show error files if any
        if (stats.errorFiles && stats.errorFiles.length > 0) {
          const errorMessage = `${stats.errorFiles.length} files had errors during processing.`;
          console.log(errorMessage);
          vscode.window
            .showWarningMessage(errorMessage, "Show Details")
            .then((selection) => {
              if (selection === "Show Details") {
                showErrorFilesDetails(stats.errorFiles);
              }
            });
        }

        importsTreeDataProvider.refresh();
        statisticsTreeDataProvider.refresh();
      }
    )
  );

  // Show error files details
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showErrorFiles",
      () => {
        const errorFiles = fileProcessor.getErrorFiles();
        showErrorFilesDetails(errorFiles);
      }
    )
  );

  // Cancel validation
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.cancelValidation",
      () => {
        fileProcessor.cancelProcessingOperation();
        vscode.window.showInformationMessage("Import validation cancelled.");
      }
    )
  );

  // Clear cache
  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.clearCache", () => {
      validator.clearCaches();
      packageInfoProvider.clearCache();
      fileProcessor.clearCaches();
      clearFileCache(); // Also clear the file-utils cache
      vscode.window.showInformationMessage(
        "NPM Import Validator cache cleared."
      );
    })
  );

  // Show package info
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showPackageInfo",
      async (packageName) => {
        await commandManager.showPackageInfo(packageName);
      }
    )
  );

  // Open npm page
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

  // Show all imports
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

  // Show statistics
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.showStats",
      async () => {
        const stats = fileProcessor.getStats();
        showStatisticsWebview(stats);
      }
    )
  );

  // Find unused dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "npm-import-validator.findUnusedDependencies",
      async () => {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Finding unused dependencies...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Scanning workspace..." });
            await importsTreeDataProvider.updateUnusedDependencies();
            vscode.window.showInformationMessage(
              "Unused dependencies scan complete"
            );
          }
        );
      }
    )
  );
}

/**
 * Shows error files details in a webview
 */
function showErrorFilesDetails(errorFiles: string[]): void {
  if (errorFiles.length === 0) {
    vscode.window.showInformationMessage("No error files to display.");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "npmImportValidatorErrors",
    "NPM Import Validator Errors",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const fileListHtml = errorFiles
    .map((file) => {
      const relativePath = vscode.workspace.asRelativePath(file);
      return `<li class="error-file" data-path="${file}">${relativePath}</li>`;
    })
    .join("");

  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>NPM Import Validator Errors</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          padding: 20px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        h1 {
          margin-bottom: 20px;
        }
        .error-list {
          list-style-type: none;
          padding: 0;
        }
        .error-file {
          padding: 8px 12px;
          margin-bottom: 8px;
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 4px;
          cursor: pointer;
        }
        .error-file:hover {
          background-color: var(--vscode-editor-selectionBackground);
        }
        .description {
          margin-bottom: 20px;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <h1>Files with Processing Errors</h1>
      <div class="description">
        The following files encountered errors during processing. Click on a file to open it in the editor.
        Common causes of errors include:
        <ul>
          <li>Complex TypeScript syntax that couldn't be parsed</li>
          <li>Invalid or malformed import statements</li>
          <li>Syntax errors in the file</li>
        </ul>
      </div>
      <ul class="error-list">
        ${fileListHtml}
      </ul>
      <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.error-file').forEach(item => {
          item.addEventListener('click', event => {
            const filePath = event.target.getAttribute('data-path');
            vscode.postMessage({
              command: 'openFile',
              filePath: filePath
            });
          });
        });
      </script>
    </body>
    </html>
  `;

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(
    (message: { command: string; filePath: string }) => {
      if (message.command === "openFile") {
        const filePath = message.filePath;
        vscode.workspace.openTextDocument(filePath).then((doc) => {
          vscode.window.showTextDocument(doc);
        });
      }
    },
    undefined,
    []
  );
}

/**
 * Shows statistics in a webview
 */
function showStatisticsWebview(stats: ProcessingStats): void {
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
          width: ${stats.processingPercentage}%;
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
        .progress-text {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          margin-top: 5px;
        }
        .error-section {
          margin-top: 20px;
        }
        .error-count {
          color: var(--vscode-errorForeground);
          font-weight: bold;
        }
        .error-button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 10px;
        }
        .error-button:hover {
          background-color: var(--vscode-button-hoverBackground);
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
            <div class="stat-title">Skipped Files</div>
            <div class="stat-value">${stats.skippedFiles}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Unchanged Files</div>
            <div class="stat-value">${stats.unchangedFiles}</div>
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
      
      ${
        stats.errorFiles && stats.errorFiles.length > 0
          ? `
      <div class="section error-section">
        <div class="section-title">ERROR FILES</div>
        <div class="stat-card">
          <div class="stat-title">Files with Errors</div>
          <div class="stat-value error-count">${stats.errorFiles.length}</div>
          <button class="error-button" id="showErrorFiles">View Error Files</button>
        </div>
      </div>
      `
          : ""
      }
      
      <div class="section">
        <div class="section-title">PROCESSING PROGRESS</div>
        <div class="stat-card">
          <div class="stat-title">Processing Progress</div>
          <div class="progress-container">
            <div class="progress-bar"></div>
          </div>
          <div class="progress-text">
            <span>${stats.processingPercentage}% complete</span>
            <span>${stats.processedFiles} of ${stats.totalFiles} files</span>
          </div>
          <div class="time">Processing time: ${Math.round(
            stats.processingTime
          )}ms</div>
          <div class="time">Last updated: ${stats.lastUpdated.toLocaleString()}</div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        
        // Add event listener for error files button
        const errorButton = document.getElementById('showErrorFiles');
        if (errorButton) {
          errorButton.addEventListener('click', () => {
            vscode.postMessage({
              command: 'showErrorFiles'
            });
          });
        }
      </script>
    </body>
    </html>
  `;

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(
    (message: { command: string }) => {
      if (message.command === "showErrorFiles") {
        vscode.commands.executeCommand("npm-import-validator.showErrorFiles");
      }
    },
    undefined,
    []
  );
}

/**
 * Registers event listeners
 */
function registerEventListeners(
  context: vscode.ExtensionContext,
  fileProcessor: FileProcessor,
  importsTreeDataProvider: ImportsTreeDataProvider,
  statisticsTreeDataProvider: StatisticsTreeDataProvider
): void {
  // Validate on save
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

  // Validate on open
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
}

/**
 * Validates the current file if one is open
 */
function validateCurrentFile(
  fileProcessor: FileProcessor,
  importsTreeDataProvider: ImportsTreeDataProvider,
  statisticsTreeDataProvider: StatisticsTreeDataProvider
): void {
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
}

/**
 * Checks if the document is a JavaScript or TypeScript file
 */
function isValidFileType(document: vscode.TextDocument): boolean {
  return [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
  ].includes(document.languageId);
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log("NPM Import Validator is now deactivated");
}
