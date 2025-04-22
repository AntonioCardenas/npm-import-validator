import * as vscode from "vscode";
import { parseModule } from "esprima";
import type { PackageInfoProvider } from "./packageInfoProvider";

export interface ImportResult {
  importName: string
  range: vscode.Range
  existsOnNpm: boolean
  packageInfo: PackageInfo | null
}

export interface PackageInfo {
  name: string
  version: string
  description: string
  homepage: string
  repository: string
  license: string
  author: string
  keywords: string[]
  downloads: number
}

export class ImportValidator {
  private documentImportsCache: Map<string, ImportResult[]> = new Map();

  constructor(private packageInfoProvider: PackageInfoProvider) {}

  // Validate imports in a document
  async validateDocument(document: vscode.TextDocument): Promise<ImportResult[]> {
    const documentUri = document.uri.toString();

    // Check cache first
    if (this.documentImportsCache.has(documentUri)) {
      return this.documentImportsCache.get(documentUri)!;
    }

    // Extract imports from the document
    const imports = this.extractImportsFromDocument(document);

    // Validate each import
    const results: ImportResult[] = [];
    for (const importInfo of imports) {
      const { importName, range } = importInfo;

      // Skip relative imports and local imports
      if (this.isLocalImport(importName)) {
        continue;
      }

      // Get package info from npm registry
      const packageInfo = await this.packageInfoProvider.getPackageInfo(importName);
      const existsOnNpm = packageInfo !== null;

      results.push({
        importName,
        range,
        existsOnNpm,
        packageInfo,
      });
    }

    // Cache the results
    this.documentImportsCache.set(documentUri, results);

    return results;
  }

  // Check if an import is a local/relative import
  private isLocalImport(importPath: string): boolean {
    // Check for relative imports
    if (importPath.startsWith(".") || importPath.startsWith("/")) {
      return true;
    }

    // Check for common path aliases
    // This covers @components, @utils, @pages, etc.
    if (importPath.match(/^@[a-zA-Z0-9_-]+/)) {
      return true;
    }

    // Check for other common aliases
    // TODO - Add more aliases as needed
    if (
      importPath.startsWith("~") ||
      importPath.startsWith("@/") ||
      importPath.startsWith("src/") ||
      importPath.startsWith("components/") ||
      importPath.startsWith("pages/") ||
      importPath.startsWith("utils/") ||
      importPath.startsWith("hooks/") ||
      importPath.startsWith("lib/") ||
      importPath.startsWith("assets/")
    ) {
      return true;
    }

    return false;
  }

  // Extract imports from a document
  private extractImportsFromDocument(document: vscode.TextDocument): { importName: string; range: vscode.Range }[] {
    const text = document.getText();
    const imports: { importName: string; range: vscode.Range }[] = [];

    try {
      const ast = parseModule(text, { jsx: true, tolerant: true, loc: true });

      for (const node of ast.body) {
        if (node.type === "ImportDeclaration" && node.source && node.source.value && node.loc) {
          const importPath = node.source.value as string;

          // Skip relative imports
          if (this.isLocalImport(importPath)) {
            continue;
          }

          // Handle scoped packages and submodules
          let packageName = importPath;
          if (importPath.startsWith("@") && !importPath.startsWith("@/")) {
            // For scoped packages like @babel/core
            const parts = importPath.split("/");
            if (parts.length >= 2) {
              packageName = `${parts[0]}/${parts[1]}`;
            }
          } else {
            // For regular packages, extract the main package name
            packageName = importPath.split("/")[0];
          }

          // Create a range for the import statement
          const startPosition = new vscode.Position(node.loc.start.line - 1, node.loc.start.column);
          const endPosition = new vscode.Position(node.loc.end.line - 1, node.loc.end.column);
          const range = new vscode.Range(startPosition, endPosition);

          imports.push({ importName: packageName, range });
        }
      }
    } catch (error) {
      console.error("Error parsing document:", error);
    }

    return imports;
  }

  // Get all imports in the workspace
  async getAllImportsInWorkspace(): Promise<Map<string, ImportResult[]>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return new Map();
    }

    const allImports = new Map<string, ImportResult[]>();

    for (const folder of workspaceFolders) {
      const jsFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.{js,jsx,ts,tsx}"),
        "**/node_modules/**",
      );

      for (const file of jsFiles) {
        try {
          const document = await vscode.workspace.openTextDocument(file);
          const results = await this.validateDocument(document);
          if (results.length > 0) {
            allImports.set(file.fsPath, results);
          }
        } catch (error) {
          console.error(`Error processing file ${file.fsPath}:`, error);
        }
      }
    }

    return allImports;
  }

  // Clear caches
  clearCaches(): void {
    this.documentImportsCache.clear();
  }
}
