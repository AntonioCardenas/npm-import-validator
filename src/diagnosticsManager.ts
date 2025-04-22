import * as vscode from "vscode";
import type { ImportResult } from "./importValidator";

export class DiagnosticsManager {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("npm-import-validator");
  }

  // Update diagnostics for a document
  updateDiagnostics(document: vscode.TextDocument, results: ImportResult[]): void {
    const diagnostics: vscode.Diagnostic[] = [];

    // Get severity level from configuration
    const severityLevel = vscode.workspace.getConfiguration("npmImportValidator").get("severityLevel");
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

    // Get ignored packages
    const ignoredPackages =
      vscode.workspace.getConfiguration("npmImportValidator").get<string[]>("ignoredPackages") || [];

    // Create diagnostics for invalid imports
    for (const result of results) {
      // Skip ignored packages
      if (ignoredPackages.includes(result.importName)) {
        continue;
      }

      if (!result.existsOnNpm) {
        const diagnostic = new vscode.Diagnostic(
          result.range,
          `Import '${result.importName}' not found on npm registry`,
          severity,
        );

        diagnostic.code = "npm-import-validator";
        diagnostic.source = "npm-import-validator";

        // Add import type to the message
        diagnostic.message = `${result.importType === "import" ? "ES6 import" : "CommonJS require"} '${result.importName}' not found on npm registry`;

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
  getDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    return Array.from(this.diagnosticCollection.get(document.uri) || []);
  }

  // Dispose of the diagnostic collection
  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
