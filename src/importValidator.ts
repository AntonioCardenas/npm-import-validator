import * as vscode from "vscode";
import * as esprima from "esprima";
import {
  COMMON_FRAMEWORKS,
  COMMON_PATH_ALIASES,
  FRAMEWORK_PREFIXES,
  getConfiguration,
} from "./utils/constants";

import type { PackageInfo, ImportType } from "./types";
import type { PackageInfoProvider } from "./packageInfoProvider";

/**
 * Import validation result
 */
export interface ImportResult {
  importName: string;
  range: vscode.Range;
  existsOnNpm: boolean;
  packageInfo: PackageInfo | null;
  importType: ImportType;
  isFramework: boolean;
  isInProject: boolean;
}

export class ImportValidator {
  constructor(private packageInfoProvider: PackageInfoProvider) {}

  /**
   * Validates imports in a document
   * @param document The document to validate
   */
  async validateDocument(
    document: vscode.TextDocument
  ): Promise<ImportResult[]> {
    const text = document.getText();
    const results: ImportResult[] = [];

    // Parse the code with esprima
    try {
      const program = esprima.parseModule(text, { loc: true });

      // Find all import and require statements
      for (const node of program.body) {
        if (node.type === "ImportDeclaration") {
          // ES6 import
          const importName = node.source.value as string;
          const range = new vscode.Range(
            new vscode.Position(
              node.loc!.start.line - 1,
              node.loc!.start.column
            ),
            new vscode.Position(node.loc!.end.line - 1, node.loc!.end.column)
          );

          const result = await this.validateImport(
            importName,
            range,
            "import",
            document
          );
          results.push(result);
        } else if (
          node.type === "VariableDeclaration" &&
          node.declarations.length > 0 &&
          node.declarations[0].init &&
          node.declarations[0].init.type === "CallExpression" &&
          node.declarations[0].init.callee.type === "Identifier" &&
          node.declarations[0].init.callee.name === "require"
        ) {
          // CommonJS require
          const requireArg = node.declarations[0].init.arguments[0];
          if (
            requireArg &&
            requireArg.type === "Literal" &&
            typeof requireArg.value === "string"
          ) {
            const importName = requireArg.value;
            const range = new vscode.Range(
              new vscode.Position(
                node.loc!.start.line - 1,
                node.loc!.start.column
              ),
              new vscode.Position(node.loc!.end.line - 1, node.loc!.end.column)
            );

            const result = await this.validateImport(
              importName,
              range,
              "require",
              document
            );
            results.push(result);
          }
        } else if (node.type === "ExportNamedDeclaration" && node.source) {
          // Type import
          if (
            node.source.type === "Literal" &&
            typeof node.source.value === "string"
          ) {
            const importName = node.source.value;
            const range = new vscode.Range(
              new vscode.Position(
                node.loc!.start.line - 1,
                node.loc!.start.column
              ),
              new vscode.Position(node.loc!.end.line - 1, node.loc!.end.column)
            );

            const result = await this.validateImport(
              importName,
              range,
              "type-import",
              document
            );
            results.push(result);
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing document ${document.uri.fsPath}:`, error);
    }

    return results;
  }

  /**
   * Validates a single import
   * @param importName The name of the import
   * @param range The range of the import in the document
   * @param importType The type of import statement
   */
  private async validateImport(
    importName: string,
    range: vscode.Range,
    importType: ImportType,
    document: vscode.TextDocument
  ): Promise<ImportResult> {
    let existsOnNpm = false;
    let packageInfo: PackageInfo | null = null;
    let isFramework = false;
    let isInProject = false;

    // Check if the import is a path alias
    const pathAliases =
      getConfiguration().get<string[]>("pathAliases") || COMMON_PATH_ALIASES;
    if (pathAliases.some((alias) => importName.startsWith(alias))) {
      // Local import - skip validation
      existsOnNpm = true;
      isFramework = false;
      isInProject = true;
    } else {
      // NPM import - check if it exists on npm registry
      packageInfo = await this.packageInfoProvider.getPackageInfo(importName);
      existsOnNpm = !!packageInfo;
      isInProject = this.packageInfoProvider.isPackageInProject(importName);

      // Check if it's a framework package
      const ignoredPackages =
        getConfiguration().get<string[]>("ignoredPackages") ||
        COMMON_FRAMEWORKS;
      isFramework =
        ignoredPackages.includes(importName) ||
        FRAMEWORK_PREFIXES.some((prefix) => importName.startsWith(prefix));
    }

    return {
      importName,
      range,
      existsOnNpm,
      packageInfo,
      importType,
      isFramework,
      isInProject,
    };
  }

  /**
   * Get all imports in the workspace
   */
  async getAllImportsInWorkspace(): Promise<Map<string, ImportResult[]>> {
    const allImports: Map<string, ImportResult[]> = new Map();

    // Get all JavaScript and TypeScript files in the workspace
    const files = await vscode.workspace.findFiles(
      "**/*.{js,jsx,ts,tsx}",
      "**/node_modules/**"
    );

    // Process each file
    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const results = await this.validateDocument(document);
        allImports.set(file.fsPath, results);
      } catch (error) {
        console.error(`Error processing file ${file.fsPath}:`, error);
      }
    }

    return allImports;
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    // No specific cache to clear in this class
  }
}
