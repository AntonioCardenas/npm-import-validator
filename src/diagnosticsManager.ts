import * as vscode from "vscode";
import type { ImportResult } from "./importValidator";

export class DiagnosticsManager {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private extensionId = "npm-import-validator";

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(
      this.extensionId
    );
  }

  // Update diagnostics for a document
  updateDiagnostics(
    document: vscode.TextDocument,
    results: ImportResult[]
  ): void {
    const diagnostics: vscode.Diagnostic[] = [];

    // Get severity level from configuration
    const severityLevel = vscode.workspace
      .getConfiguration("npmImportValidator")
      .get("severityLevel");
    let severity: vscode.DiagnosticSeverity;

    switch (severityLevel) {
      case "error":
        severity = vscode.DiagnosticSeverity.Error;
        break;
      case "info":
        severity = vscode.DiagnosticSeverity.Information;
        break;
      case "warning":
      default:
        severity = vscode.DiagnosticSeverity.Warning;
        break;
    }

    // Get framework severity level - default to "info" for framework packages
    const frameworkSeverityLevel =
      vscode.workspace
        .getConfiguration("npmImportValidator")
        .get("frameworkSeverityLevel") || "info";
    let frameworkSeverity: vscode.DiagnosticSeverity;

    switch (frameworkSeverityLevel) {
      case "error":
        frameworkSeverity = vscode.DiagnosticSeverity.Error;
        break;
      case "warning":
        frameworkSeverity = vscode.DiagnosticSeverity.Warning;
        break;
      case "info":
      default:
        frameworkSeverity = vscode.DiagnosticSeverity.Information;
        break;
    }

    // Get ignored packages
    const ignoredPackages =
      vscode.workspace
        .getConfiguration("npmImportValidator")
        .get<string[]>("ignoredPackages") || [];

    // Create diagnostics for invalid imports
    for (const result of results) {
      // Skip ignored packages
      if (ignoredPackages.includes(result.importName)) {
        continue;
      }

      // Skip packages that are in the project
      if (result.isInProject) {
        continue;
      }

      if (!result.existsOnNpm) {
        // Use different severity for framework packages
        const currentSeverity = result.isFramework
          ? frameworkSeverity
          : severity;

        const diagnostic = new vscode.Diagnostic(
          result.range,
          `Import '${result.importName}' not found on npm registry`,
          currentSeverity
        );

        diagnostic.code = {
          value: "npm-import-validator",
          target: vscode.Uri.parse(
            `https://www.npmjs.com/package/${result.importName}`
          ),
        };
        diagnostic.source = this.extensionId;

        // Add import type and framework status to the message
        const importTypeText =
          result.importType === "import" ? "ES6 import" : "CommonJS require";
        const frameworkText = result.isFramework ? " (Framework package)" : "";
        diagnostic.message = `${importTypeText} '${result.importName}' not found on npm registry${frameworkText}`;

        // Add code actions
        diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];

        diagnostics.push(diagnostic);
      }
    }

    // Update the diagnostic collection
    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  // Clear diagnostics for a document
  clearDiagnostics(document: vscode.TextDocument): void {
    this.diagnosticCollection.delete(document.uri);
  }

  // Get diagnostics for a document
  getDiagnostics(document: vscode.TextDocument): readonly vscode.Diagnostic[] {
    return this.diagnosticCollection.get(document.uri) || [];
  }

  // Alternative fix: Create a new mutable array from the readonly array
  // This approach is useful if you need to modify the diagnostics after getting them
  getMutableDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const readonlyDiagnostics = this.diagnosticCollection.get(document.uri);
    if (!readonlyDiagnostics) {
      return [];
    }
    // Create a new mutable array by spreading the readonly array
    return [...readonlyDiagnostics];
  }

  // Dispose of the diagnostic collection
  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
