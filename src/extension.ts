import * as vscode from "vscode";
import { ImportValidator } from "./importValidator";
import { DiagnosticsManager } from "./diagnosticsManager";
import { StatusBarManager } from "./statusBarManager";
import { CommandManager } from "./commandManager";
import { PackageInfoProvider } from "./packageInfoProvider";
import { ImportsTreeDataProvider } from "./importsTreeDataProvider";
import { CodeLensProvider } from "./codeLensProvider";
import { ensureActivation } from "./activation";

// Extension activation
export async function activate(context: vscode.ExtensionContext) {
  console.log("NPM Import Validator is now active");

  // Ensure proper activation
  const activationSuccessful = await ensureActivation();
  if (!activationSuccessful) {
    vscode.window.showErrorMessage("NPM Import Validator could not be fully activated. Some features may not work.");
  }

  // Create instances of our managers and providers
  const packageInfoProvider = new PackageInfoProvider(context.globalState);
  const validator = new ImportValidator(packageInfoProvider);
  const diagnosticsManager = new DiagnosticsManager();
  const statusBarManager = new StatusBarManager();
  const commandManager = new CommandManager(validator, diagnosticsManager, packageInfoProvider);
  const importsTreeDataProvider = new ImportsTreeDataProvider(validator);
  const codeLensProvider = new CodeLensProvider(validator, packageInfoProvider);

  // Register tree view
  const treeView = vscode.window.createTreeView("npmImports", {
    treeDataProvider: importsTreeDataProvider,
    showCollapseAll: true,
  });

  // Store the tree view in context.subscriptions to ensure proper disposal
  context.subscriptions.push(treeView);

  // Make sure the tree data provider is properly initialized
  importsTreeDataProvider.refresh();

  // Register code lens provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "javascript" },
        { language: "javascriptreact" },
        { language: "typescript" },
        { language: "typescriptreact" },
      ],
      codeLensProvider,
    ),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.validateImports", () => {
      validateCurrentFile(validator, diagnosticsManager, statusBarManager);
      importsTreeDataProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.showPackageInfo", async (packageName) => {
      await commandManager.showPackageInfo(packageName);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.openNpmPage", (packageName: string) => {
      vscode.env.openExternal(vscode.Uri.parse(`https://www.npmjs.com/package/${packageName}`));
    }),
  );

  // Fix the showAllImports command to avoid type error with reveal()
  context.subscriptions.push(
    vscode.commands.registerCommand("npm-import-validator.showAllImports", async () => {
      // First, focus the view container
      await vscode.commands.executeCommand("workbench.view.extension.npm-import-validator");

      // Refresh the tree data provider
      importsTreeDataProvider.refresh();

      // No need to call reveal() with undefined - just make the view visible
      // The view will show the root items by default
    }),
  );

  // Register status bar item
  context.subscriptions.push(statusBarManager.getStatusBarItem());

  // Register event listeners
  if (vscode.workspace.getConfiguration("npmImportValidator").get("validateOnSave")) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (isValidFileType(document)) {
          validateDocument(document, validator, diagnosticsManager, statusBarManager);
          importsTreeDataProvider.refresh();
        }
      }),
    );
  }

  if (vscode.workspace.getConfiguration("npmImportValidator").get("validateOnOpen")) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isValidFileType(document)) {
          validateDocument(document, validator, diagnosticsManager, statusBarManager);
          importsTreeDataProvider.refresh();
        }
      }),
    );
  }

  // Listen for active editor changes to update the tree view
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      importsTreeDataProvider.refresh();
    }),
  );

  // Validate the current file if one is open
  if (vscode.window.activeTextEditor) {
    validateCurrentFile(validator, diagnosticsManager, statusBarManager);
    importsTreeDataProvider.refresh();
  }
}

// Check if the document is a JavaScript or TypeScript file
function isValidFileType(document: vscode.TextDocument): boolean {
  return ["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(document.languageId);
}

// Validate the current active file
async function validateCurrentFile(
  validator: ImportValidator,
  diagnosticsManager: DiagnosticsManager,
  statusBarManager: StatusBarManager,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && isValidFileType(editor.document)) {
    await validateDocument(editor.document, validator, diagnosticsManager, statusBarManager);
  }
}

// Validate a document
async function validateDocument(
  document: vscode.TextDocument,
  validator: ImportValidator,
  diagnosticsManager: DiagnosticsManager,
  statusBarManager: StatusBarManager,
): Promise<void> {
  statusBarManager.setValidating();

  try {
    const results = await validator.validateDocument(document);
    diagnosticsManager.updateDiagnostics(document, results);

    const invalidCount = results.filter((result) => !result.existsOnNpm).length;
    if (invalidCount > 0) {
      statusBarManager.setInvalidImports(invalidCount);
    } else {
      statusBarManager.setValid();
    }
  } catch (error) {
    console.error("Error validating imports:", error);
    statusBarManager.setError();
    vscode.window.showErrorMessage(
      `Error validating imports: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Extension deactivation
export function deactivate() {
  console.log("NPM Import Validator is now deactivated");
}
