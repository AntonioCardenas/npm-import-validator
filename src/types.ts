import type * as vscode from "vscode";

/**
 * Package information from npm registry
 */
export interface PackageInfo {
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

/**
 * Type of import statement
 */
export type ImportType = "import" | "require" | "type-import";

/**
 * Processing statistics
 */
export interface ProcessingStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  unchangedFiles: number;
  totalImports: number;
  validImports: number;
  invalidImports: number;
  frameworkImports: number;
  projectImports: number;
  processingTime: number;
  lastUpdated: Date;
  processingPercentage: number;
  errorFiles: string[];
}

/**
 * Processing options
 */
export interface ProcessingOptions {
  forceReprocess?: boolean;
  showProgress?: boolean;
}
