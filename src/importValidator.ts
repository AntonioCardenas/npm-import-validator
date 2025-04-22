import * as vscode from "vscode";
import { parseModule } from "esprima";
import type { PackageInfoProvider } from "./packageInfoProvider";

export interface ImportResult {
  importName: string
  range: vscode.Range
  existsOnNpm: boolean
  packageInfo: PackageInfo | null
  importType: "import" | "require"
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

interface ImportCache {
  results: ImportResult[]
  timestamp: number
}

export class ImportValidator {
  private documentImportsCache: Map<string, ImportCache> = new Map();
  private importExistenceCache: Map<string, { exists: boolean; timestamp: number }> = new Map();
  private circularDependencyDetector: Set<string> = new Set();
  private processingTimeout = 5000; // 5 seconds timeout for processing a file
  private extensionId = "npm-import-validator";

  constructor(private packageInfoProvider: PackageInfoProvider) {}

  // Validate imports in a document
  async validateDocument(document: vscode.TextDocument): Promise<ImportResult[]> {
    const documentUri = document.uri.toString();
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const cacheTimeout = config.get<number>("cacheTimeout") || 86400; // Default 24 hours
    const now = Date.now();

    // Check cache first
    if (this.documentImportsCache.has(documentUri)) {
      const cache = this.documentImportsCache.get(documentUri);
      if (cache && now - cache.timestamp < cacheTimeout * 1000) {
        return cache.results;
      }
    }

    // Extract imports from the document
    const imports = this.extractImportsFromDocument(document);

    // Validate each import with timeout protection
    const results: ImportResult[] = [];
    for (const importInfo of imports) {
      const { importName, range, importType } = importInfo;

      // Skip relative imports and local imports
      if (this.isLocalImport(importName)) {
        continue;
      }

      // Skip ignored packages
      const ignoredPackages = config.get<string[]>("ignoredPackages") || [];
      if (ignoredPackages.includes(importName)) {
        continue;
      }

      // Check import existence cache
      let existsOnNpm = false;
      let packageInfo = null;

      if (this.importExistenceCache.has(importName)) {
        const cache = this.importExistenceCache.get(importName);
        if (!cache) {
          continue;
        }
        if (now - cache.timestamp < cacheTimeout * 1000) {
          existsOnNpm = cache.exists;
          if (existsOnNpm) {
            packageInfo = await this.packageInfoProvider.getPackageInfo(importName);
          }
        }
      }

      if (!this.importExistenceCache.has(importName)) {
        try {
          // Set timeout for package info retrieval
          const timeoutPromise = new Promise<null>((_, reject) => {
            setTimeout(
              () => reject(new Error(`Timeout getting package info for ${importName}`)),
              this.processingTimeout,
            );
          });

          // Get package info with timeout
          packageInfo = await Promise.race([this.packageInfoProvider.getPackageInfo(importName), timeoutPromise]);

          existsOnNpm = packageInfo !== null;

          // Cache the result
          this.importExistenceCache.set(importName, { exists: existsOnNpm, timestamp: now });
        } catch (error) {
          console.error(`Error validating import ${importName}:`, error);
          // Assume it doesn't exist if there's an error
          existsOnNpm = false;
          this.importExistenceCache.set(importName, { exists: false, timestamp: now });
        }
      }

      results.push({
        importName,
        range,
        existsOnNpm,
        packageInfo,
        importType,
      });
    }

    // Cache the results
    this.documentImportsCache.set(documentUri, { results, timestamp: now });

    return results;
  }

  // Check if an import is a local/relative import
  private isLocalImport(importPath: string): boolean {
    // Get configuration
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const customAliases = config.get<string[]>("pathAliases") || [];

    // Check for relative imports
    if (importPath.startsWith(".") || importPath.startsWith("/")) {
      return true;
    }

    // Check for common path aliases
    if (importPath.match(/^@[a-zA-Z0-9_-]+/)) {
      // Skip checking scoped packages like @babel/core
      if (importPath.includes("/") && !customAliases.some((alias) => importPath.startsWith(alias))) {
        return false;
      }
      return true;
    }

    // Check for other common aliases and custom aliases
    const commonAliases = [
      "~",
      "src/",
      "components/",
      "pages/",
      "utils/",
      "hooks/",
      "lib/",
      "assets/",
      "styles/",
      "config/",
      "constants/",
    ];

    const allAliases = [...commonAliases, ...customAliases];

    return allAliases.some((alias) => importPath.startsWith(alias));
  }

  // Extract imports from a document
  private extractImportsFromDocument(
    document: vscode.TextDocument,
  ): { importName: string; range: vscode.Range; importType: "import" | "require" }[] {
    const text = document.getText();
    const imports: { importName: string; range: vscode.Range; importType: "import" | "require" }[] = [];

    try {
      // Extract ES6 imports
      this.extractES6Imports(text, document, imports);

      // Extract CommonJS requires
      this.extractCommonJSRequires(text, document, imports);
    } catch (error) {
      console.error("Error parsing document:", error);
    }

    return imports;
  }

  // Extract ES6 imports using esprima
  private extractES6Imports(
    text: string,
    document: vscode.TextDocument,
    imports: { importName: string; range: vscode.Range; importType: "import" | "require" }[],
  ): void {
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
          const packageName = this.extractPackageName(importPath);

          // Create a range for the import statement
          const startPosition = new vscode.Position(node.loc.start.line - 1, node.loc.start.column);
          const endPosition = new vscode.Position(node.loc.end.line - 1, node.loc.end.column);
          const range = new vscode.Range(startPosition, endPosition);

          imports.push({ importName: packageName, range, importType: "import" });
        }
      }
    } catch (error) {
      console.error("Error parsing ES6 imports:", error);
    }
  }

  // Extract CommonJS require statements using regex
  private extractCommonJSRequires(
    text: string,
    document: vscode.TextDocument,
    imports: { importName: string; range: vscode.Range; importType: "import" | "require" }[],
  ): void {
    try {
      // Match require statements like: const foo = require('package-name')
      const requireRegex = /(?:const|let|var)\s+(?:\w+|\{\s*[^}]+\s*\})\s*=\s*require\s*$$\s*['"]([^'"]+)['"]\s*$$/g;

      // Match dynamic requires like: require('package-name')
      const dynamicRequireRegex = /(?<![\w$])require\s*$$\s*['"]([^'"]+)['"]\s*$$/g;

      let match: RegExpExecArray | null;
      const text2 = text;

      // Process standard requires
      while ((match = requireRegex.exec(text2)) !== null) {
        const importPath = match[1];

        // Skip relative imports
        if (this.isLocalImport(importPath)) {
          continue;
        }

        // Handle scoped packages and submodules
        const packageName = this.extractPackageName(importPath);

        // Create a range for the require statement
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);

        imports.push({ importName: packageName, range, importType: "require" });
      }

      // Process dynamic requires
      while ((match = dynamicRequireRegex.exec(text2)) !== null) {
        const importPath = match[1];

        // Skip relative imports
        if (this.isLocalImport(importPath)) {
          continue;
        }

        // Handle scoped packages and submodules
        const packageName = this.extractPackageName(importPath);

        // Create a range for the require statement
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);

        imports.push({ importName: packageName, range, importType: "require" });
      }
    } catch (error) {
      console.error("Error extracting CommonJS requires:", error);
    }
  }

  // Extract the main package name from an import path
  private extractPackageName(importPath: string): string {
    if (importPath.startsWith("@") && !importPath.startsWith("@/")) {
      // For scoped packages like @babel/core
      const parts = importPath.split("/");
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }

    // For regular packages, extract the main package name
    return importPath.split("/")[0];
  }

  // Get all imports in the workspace
  async getAllImportsInWorkspace(): Promise<Map<string, ImportResult[]>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return new Map();
    }

    const allImports = new Map<string, ImportResult[]>();
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const maxFiles = config.get<number>("maxFilesToProcess") || 1000;
    let processedCount = 0;

    // Clear circular dependency detector
    this.circularDependencyDetector.clear();

    for (const folder of workspaceFolders) {
      const jsFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.{js,jsx,ts,tsx}"),
        "**/node_modules/**",
      );

      // Limit the number of files to process
      const filesToProcess = jsFiles.slice(0, maxFiles - processedCount);

      for (const file of filesToProcess) {
        if (processedCount >= maxFiles) {
          console.log(`Reached maximum file limit (${maxFiles}). Stopping import collection.`);
          break;
        }

        try {
          const document = await vscode.workspace.openTextDocument(file);
          const results = await this.validateDocument(document);
          if (results.length > 0) {
            allImports.set(file.fsPath, results);
          }
          processedCount++;
        } catch (error) {
          console.error(`Error processing file ${file.fsPath}:`, error);
        }
      }

      if (processedCount >= maxFiles) {
        break;
      }
    }

    return allImports;
  }

  // Clear caches
  clearCaches(): void {
    this.documentImportsCache.clear();
    this.importExistenceCache.clear();
    this.circularDependencyDetector.clear();
  }
}
