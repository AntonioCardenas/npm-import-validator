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

    // Create diagnostics for invalid imports
    for (const result of results) {
      if (!result.existsOnNpm) {
        const diagnostic = new vscode.Diagnostic(
          result.range,
          `Import '${result.importName}' not found on npm registry`,
          severity,
        );

        diagnostic.code = "npm-import-validator";
        diagnostic.source = "npm-import-validator";

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
