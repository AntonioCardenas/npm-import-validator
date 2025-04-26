import * as vscode from "vscode";
import { parseModule } from "esprima";

import {
  COMMON_FRAMEWORKS,
  COMMON_PATH_ALIASES,
  DEFAULT_CONFIG,
  FRAMEWORK_PREFIXES,
  getConfigValue,
} from "./utils/constants";
import { memoize } from "./utils/common";

import type { IPackageInfoProvider } from "./packageInfoProvider";

// Types and interfaces
export interface IImportResult {
  importName: string;
  range: vscode.Range;
  existsOnNpm: boolean;
  packageInfo: IPackageInfo | null;
  importType: EImportType;
  isFramework: boolean;
  isInProject: boolean;
}

export interface IPackageInfo {
  name: string;
  version: string;
  description: string;
  homepage: string;
  repository: string;
  license: string;
  author: string;
  keywords: string[];
  downloads: number;
  isInProject?: boolean;
}

interface IImportCache {
  results: IImportResult[];
  timestamp: number;
}

interface IImportData {
  importName: string;
  range: vscode.Range;
  importType: EImportType;
}

export enum EImportType {
  ES6 = "import",
  COMMONJS = "require",
  TYPE = "type-import",
}

/**
 * Validates imports in JavaScript and TypeScript files
 */
export class ImportValidator {
  // Cache and state management
  private readonly _documentImportsCache = new Map<string, IImportCache>();
  private readonly _importExistenceCache = new Map<
    string,
    {
      exists: boolean;
      timestamp: number;
      isInProject: boolean;
    }
  >();
  private readonly _circularDependencyDetector = new Set<string>();

  /**
   * Creates a new instance of the ImportValidator
   * @param packageInfoProvider The package info provider
   */
  constructor(private readonly _packageInfoProvider: IPackageInfoProvider) {}

  /**
   * Validates imports in a document and returns results
   * @param document The document to validate
   */
  public async validateDocument(
    document: vscode.TextDocument
  ): Promise<IImportResult[]> {
    const documentUri = document.uri.toString();
    const cacheTimeout = getConfigValue<number>(
      "cacheTimeout",
      DEFAULT_CONFIG.CACHE_TIMEOUT
    );
    const now = Date.now();

    // Check cache first
    if (this._isCacheValid(documentUri, now, cacheTimeout)) {
      return this._documentImportsCache.get(documentUri)!.results;
    }

    // Extract imports from the document
    const imports = this._extractImportsFromDocument(document);

    // Validate each import
    const results = await this._validateImports(imports, now);

    // Cache the results
    this._documentImportsCache.set(documentUri, { results, timestamp: now });

    return results;
  }

  /**
   * Gets all imports in the workspace
   */
  public async getAllImportsInWorkspace(): Promise<
    Map<string, IImportResult[]>
  > {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return new Map();
    }

    const allImports = new Map<string, IImportResult[]>();
    const maxFiles = getConfigValue<number>(
      "maxFilesToProcess",
      DEFAULT_CONFIG.MAX_FILES
    );
    let processedCount = 0;

    // Clear circular dependency detector
    this._circularDependencyDetector.clear();

    for (const folder of workspaceFolders) {
      const jsFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.{js,jsx,ts,tsx}"),
        "**/node_modules/**"
      );

      // Limit the number of files to process
      const filesToProcess = jsFiles.slice(0, maxFiles - processedCount);

      for (const file of filesToProcess) {
        if (processedCount >= maxFiles) {
          console.info(
            `Reached maximum file limit (${maxFiles}). Stopping import collection.`
          );
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

  /**
   * Clears all caches
   */
  public clearCaches(): void {
    this._documentImportsCache.clear();
    this._importExistenceCache.clear();
    this._circularDependencyDetector.clear();
  }

  /**
   * Checks if the cache for a document is valid
   */
  private _isCacheValid(
    documentUri: string,
    now: number,
    cacheTimeout: number
  ): boolean {
    if (this._documentImportsCache.has(documentUri)) {
      const cache = this._documentImportsCache.get(documentUri);
      if (cache && now - cache.timestamp < cacheTimeout * 1000) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates a list of imports and returns results
   */
  private async _validateImports(
    imports: IImportData[],
    now: number
  ): Promise<IImportResult[]> {
    const results: IImportResult[] = [];
    const ignoredPackages = getConfigValue<string[]>("ignoredPackages", []);

    // Use Promise.all for parallel processing
    const validationPromises = imports.map(async (importInfo) => {
      const { importName, range, importType } = importInfo;

      // Skip relative imports and local imports
      if (this._isLocalImport(importName)) {
        return null;
      }

      // Check if it's a framework package
      const isFramework = this._isFrameworkPackage(importName, ignoredPackages);

      // Check if package is in project
      const isInProject =
        this._packageInfoProvider.isPackageInProject(importName);

      // Validate the import
      const { existsOnNpm, packageInfo } = await this._validateImport(
        importName,
        isInProject,
        now
      );

      return {
        importName,
        range,
        existsOnNpm,
        packageInfo,
        importType,
        isFramework,
        isInProject,
      };
    });

    // Wait for all validations to complete
    const validationResults = await Promise.all(validationPromises);

    // Filter out null results and add to results array
    for (const result of validationResults) {
      if (result !== null) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Validates a single import and returns its status
   */
  private async _validateImport(
    importName: string,
    isInProject: boolean,
    now: number
  ): Promise<{ existsOnNpm: boolean; packageInfo: IPackageInfo | null }> {
    const cacheTimeout = getConfigValue<number>(
      "cacheTimeout",
      DEFAULT_CONFIG.CACHE_TIMEOUT
    );

    // Check import existence cache
    if (this._importExistenceCache.has(importName)) {
      const cache = this._importExistenceCache.get(importName)!;
      if (now - cache.timestamp < cacheTimeout * 1000) {
        const existsOnNpm = cache.exists;
        let packageInfo = null;
        if (existsOnNpm || cache.isInProject) {
          packageInfo = await this._packageInfoProvider.getPackageInfo(
            importName
          );
        }
        return { existsOnNpm, packageInfo };
      }
    }

    try {
      // If the package is in the project, we can assume it exists
      if (isInProject) {
        const packageInfo = await this._packageInfoProvider.getPackageInfo(
          importName
        );
        this._importExistenceCache.set(importName, {
          exists: true,
          timestamp: now,
          isInProject,
        });
        return { existsOnNpm: true, packageInfo };
      }

      // Otherwise, check npm registry with timeout
      const processingTimeout = DEFAULT_CONFIG.PROCESSING_TIMEOUT;
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error(`Timeout getting package info for ${importName}`)),
          processingTimeout
        );
      });

      // Get package info with timeout
      const packageInfo = await Promise.race([
        this._packageInfoProvider.getPackageInfo(importName),
        timeoutPromise,
      ]);

      const existsOnNpm = packageInfo !== null;

      // Cache the result
      this._importExistenceCache.set(importName, {
        exists: existsOnNpm,
        timestamp: now,
        isInProject,
      });

      return { existsOnNpm, packageInfo };
    } catch (error) {
      console.error(`Error validating import ${importName}:`, error);

      // Assume it doesn't exist if there's an error
      this._importExistenceCache.set(importName, {
        exists: false,
        timestamp: now,
        isInProject,
      });

      return { existsOnNpm: false, packageInfo: null };
    }
  }

  /**
   * Checks if a package is a framework package
   */
  private _isFrameworkPackage = memoize(
    (packageName: string, ignoredPackages: string[]): boolean => {
      // Check exact matches in our Node.js compatible frameworks list
      if (COMMON_FRAMEWORKS.includes(packageName)) {
        return true;
      }

      // Check exact matches in user-defined ignored packages
      if (ignoredPackages.includes(packageName)) {
        return true;
      }

      // Check for scoped packages in our frameworks list
      for (const framework of COMMON_FRAMEWORKS) {
        if (
          framework.startsWith("@") &&
          packageName.startsWith(`${framework}/`)
        ) {
          return true;
        }
      }

      // Check wildcard patterns in user-defined ignored packages
      for (const pattern of ignoredPackages) {
        if (pattern.includes("*")) {
          const regexPattern = pattern
            .replace(/\./g, "\\.")
            .replace(/\*/g, ".*");
          if (new RegExp(`^${regexPattern}$`).test(packageName)) {
            return true;
          }
        }
      }

      // Check common framework prefixes
      return FRAMEWORK_PREFIXES.some((prefix) =>
        packageName.startsWith(prefix)
      );
    }
  );

  /**
   * Checks if an import is a local/relative import
   */
  private _isLocalImport = memoize((importPath: string): boolean => {
    // Get configuration
    const customAliases = getConfigValue<string[]>("pathAliases", []);

    // Check for relative imports
    if (importPath.startsWith(".") || importPath.startsWith("/")) {
      return true;
    }

    // Check for common path aliases
    if (importPath.match(/^@[a-zA-Z0-9_-]+/)) {
      // Skip checking scoped packages like @babel/core
      if (
        importPath.includes("/") &&
        !customAliases.some((alias) => importPath.startsWith(alias))
      ) {
        return false;
      }
      return true;
    }

    // Check for other common aliases and custom aliases
    const allAliases = [...COMMON_PATH_ALIASES, ...customAliases];
    return allAliases.some((alias) => importPath.startsWith(alias));
  });

  /**
   * Extracts imports from a document
   */
  private _extractImportsFromDocument(
    document: vscode.TextDocument
  ): IImportData[] {
    const text = document.getText();
    const imports: IImportData[] = [];

    try {
      // Extract ES6 imports
      this._extractES6Imports(text, document, imports);

      // Extract TypeScript type imports
      this._extractTypeImports(text, document, imports);

      // Extract CommonJS requires
      this._extractCommonJSRequires(text, document, imports);
    } catch (error) {
      console.error(`Error parsing document ${document.uri.fsPath}:`, error);
    }

    return imports;
  }

  /**
   * Extracts ES6 imports using esprima
   */
  private _extractES6Imports(
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    try {
      // Try to parse with different options if the default fails
      let ast;
      try {
        ast = parseModule(text, { jsx: true, tolerant: true, loc: true });
      } catch (parseError) {
        // If JSX parsing fails, try without JSX
        console.info(
          `JSX parsing failed for ${document.uri.fsPath}, trying without JSX support`
        );
        ast = parseModule(text, { tolerant: true, loc: true });
      }

      for (const node of ast.body) {
        if (
          node.type === "ImportDeclaration" &&
          node.source &&
          node.source.value &&
          node.loc
        ) {
          const importPath = node.source.value as string;

          // Skip relative imports
          if (this._isLocalImport(importPath)) {
            continue;
          }

          // Handle scoped packages and submodules
          const packageName = this._extractPackageName(importPath);

          // Create a range for the import statement
          const startPosition = new vscode.Position(
            node.loc.start.line - 1,
            node.loc.start.column
          );
          const endPosition = new vscode.Position(
            node.loc.end.line - 1,
            node.loc.end.column
          );
          const range = new vscode.Range(startPosition, endPosition);

          imports.push({
            importName: packageName,
            range,
            importType: EImportType.ES6,
          });
        }
      }
    } catch (error) {
      console.error(
        `Error parsing ES6 imports in file: ${document.uri.fsPath}`
      );
      console.error(
        `Error details: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      // Try a more tolerant approach if esprima fails
      this._extractImportsWithRegex(text, document, imports);
    }
  }

  /**
   * Extracts imports using regex as a fallback
   */
  private _extractImportsWithRegex(
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    try {
      // Simple regex-based fallback for import statements
      const importRegex =
        /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;

      let match;
      while ((match = importRegex.exec(text)) !== null) {
        const importPath = match[1];

        // Skip relative imports
        if (this._isLocalImport(importPath)) {
          continue;
        }

        // Handle scoped packages and submodules
        const packageName = this._extractPackageName(importPath);

        // Create a range for the import statement
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);

        imports.push({
          importName: packageName,
          range,
          importType: EImportType.ES6,
        });
      }
    } catch (error) {
      console.error(
        `Fallback import parsing also failed for ${document.uri.fsPath}:`,
        error
      );
    }
  }

  /**
   * Extracts TypeScript type imports
   */
  private _extractTypeImports(
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    try {
      // Regex for TypeScript type imports
      // Matches: import type { X } from 'package'
      // and: import { type X } from 'package'
      const typeImportRegex =
        /import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
      const inlineTypeImportRegex =
        /import\s+\{\s*(?:[^{}]*,\s*)?type\s+[^{}]*\}\s+from\s+['"]([^'"]+)['"]/g;

      // Process type imports
      this._processTypeImportRegex(typeImportRegex, text, document, imports);

      // Process inline type imports
      this._processTypeImportRegex(
        inlineTypeImportRegex,
        text,
        document,
        imports
      );
    } catch (error) {
      console.error(
        `Error extracting TypeScript type imports from ${document.uri.fsPath}:`,
        error
      );
    }
  }

  /**
   * Processes a regex for type imports
   */
  private _processTypeImportRegex(
    regex: RegExp,
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const importPath = match[1];

      // Skip relative imports
      if (this._isLocalImport(importPath)) {
        continue;
      }

      // Handle scoped packages and submodules
      const packageName = this._extractPackageName(importPath);

      // Create a range for the import statement
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      imports.push({
        importName: packageName,
        range,
        importType: EImportType.TYPE,
      });
    }
  }

  /**
   * Extracts CommonJS require statements using regex
   */
  private _extractCommonJSRequires(
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    try {
      // Match require statements like: const foo = require('package-name')
      const requireRegex =
        /(?:const|let|var)\s+(?:\w+|\{\s*[^}]+\s*\})\s*=\s*require\s*$$\s*['"]([^'"]+)['"]\s*$$/g;

      // Match dynamic requires like: require('package-name')
      const dynamicRequireRegex =
        /(?<![\w$])require\s*$$\s*['"]([^'"]+)['"]\s*$$/g;

      // Process standard requires
      this._processRequireRegex(requireRegex, text, document, imports);

      // Process dynamic requires
      this._processRequireRegex(dynamicRequireRegex, text, document, imports);
    } catch (error) {
      console.error(
        `Error extracting CommonJS requires from ${document.uri.fsPath}:`,
        error
      );
    }
  }

  /**
   * Processes a regex for require statements
   */
  private _processRequireRegex(
    regex: RegExp,
    text: string,
    document: vscode.TextDocument,
    imports: IImportData[]
  ): void {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const importPath = match[1];

      // Skip relative imports
      if (this._isLocalImport(importPath)) {
        continue;
      }

      // Handle scoped packages and submodules
      const packageName = this._extractPackageName(importPath);

      // Create a range for the require statement
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      imports.push({
        importName: packageName,
        range,
        importType: EImportType.COMMONJS,
      });
    }
  }

  /**
   * Extracts the main package name from an import path
   */
  private _extractPackageName = memoize((importPath: string): string => {
    if (importPath.startsWith("@") && !importPath.startsWith("@/")) {
      // For scoped packages like @babel/core
      const parts = importPath.split("/");
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }

    // For regular packages, extract the main package name
    return importPath.split("/")[0];
  });
}
