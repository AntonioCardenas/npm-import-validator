import * as vscode from "vscode";
import { performance } from "perf_hooks";
import type { ImportValidator } from "./importValidator";
import type { DiagnosticsManager } from "./diagnosticsManager";
import type { StatusBarManager } from "./statusBarManager";
import * as path from "path";

interface ProcessingStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  totalImports: number;
  validImports: number;
  invalidImports: number;
  processingTime: number;
}

export class FileProcessor {
  private processingQueue: Set<string> = new Set();
  private processedFiles: Set<string> = new Set();
  private fileImportCache: Map<string, Set<string>> = new Map();
  private stats: ProcessingStats = this.resetStats();
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private extensionContext: vscode.ExtensionContext;

  constructor(
    public validator: ImportValidator,
    private diagnosticsManager: DiagnosticsManager,
    private statusBarManager: StatusBarManager,
    context: vscode.ExtensionContext
  ) {
    this.extensionContext = context;
  }

  private resetStats(): ProcessingStats {
    return {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      totalImports: 0,
      validImports: 0,
      invalidImports: 0,
      processingTime: 0,
    };
  }

  /**
   * Process a single file
   */
  async processFile(document: vscode.TextDocument): Promise<void> {
    const filePath = document.uri.fsPath;

    // Skip if already being processed
    if (this.processingQueue.has(filePath)) {
      return;
    }

    // Skip if file should not be processed
    if (!this.shouldProcessFile(filePath)) {
      return;
    }

    this.processingQueue.add(filePath);
    this.statusBarManager.setValidating();

    try {
      const startTime = performance.now();
      let results: { importName: string; existsOnNpm: boolean }[];

      try {
        results = await this.validator.validateDocument(document);
      } catch (validationError) {
        console.error(
          `Error validating document ${document.uri.fsPath}:`,
          validationError
        );
        this.statusBarManager.setError();

        // Create an empty results array to avoid further errors
        results = [];

        // Show a more specific error message
        vscode.window.showErrorMessage(
          `Error validating imports in ${path.basename(
            document.uri.fsPath
          )}. See console for details.`
        );
      }

      const endTime = performance.now();

      // Update stats
      this.stats.processedFiles++;
      this.stats.totalImports += results.length;
      this.stats.validImports += results.filter((r) => r.existsOnNpm).length;
      this.stats.invalidImports += results.filter((r) => !r.existsOnNpm).length;
      this.stats.processingTime += endTime - startTime;

      // Cache imports for this file
      const importNames = new Set(results.map((r) => r.importName));
      this.fileImportCache.set(filePath, importNames);

      // Update diagnostics
      const enrichedResults = results.map((result) => ({
        ...result,
        range: new vscode.Range(0, 0, 0, 0), // Replace with actual range logic
        packageInfo: null, // Replace with actual package info if available
        importType: "import" as "import" | "require", // Replace with actual import type logic
        isFramework: false, // Replace with actual framework detection logic
      }));
      this.diagnosticsManager.updateDiagnostics(document, enrichedResults);

      // Update status bar
      const invalidCount = results.filter((r) => !r.existsOnNpm).length;
      if (invalidCount > 0) {
        this.statusBarManager.setInvalidImports(invalidCount);
      } else {
        this.statusBarManager.setValid();
      }

      // Mark as processed
      this.processedFiles.add(filePath);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      this.statusBarManager.setError();
      this.stats.skippedFiles++;
    } finally {
      this.processingQueue.delete(filePath);
    }
  }

  /**
   * Process all files in the workspace with limits and progress
   */
  async processWorkspace(showProgress = true): Promise<ProcessingStats> {
    if (this.isProcessing) {
      return this.stats;
    }

    this.isProcessing = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Reset stats
    this.stats = this.resetStats();

    // Get configuration
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const maxFiles = config.get<number>("maxFilesToProcess") || 1000;
    const batchSize = config.get<number>("processingBatchSize") || 20;
    const excludePatterns = this.getExcludePatterns();

    // Find all JS/TS files in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      this.isProcessing = false;
      return this.stats;
    }

    try {
      // Process with progress bar if requested
      if (showProgress) {
        return await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NPM Import Validator",
            cancellable: true,
          },
          async (progress, token) => {
            token.onCancellationRequested(() => {
              if (this.abortController) {
                this.abortController.abort();
              }
            });

            return await this.doProcessWorkspace(
              workspaceFolders,
              maxFiles,
              batchSize,
              excludePatterns,
              progress,
              signal
            );
          }
        );
      } else {
        return await this.doProcessWorkspace(
          workspaceFolders,
          maxFiles,
          batchSize,
          excludePatterns,
          null,
          signal
        );
      }
    } catch (error) {
      console.error("Error processing workspace:", error);
      this.statusBarManager.setError();
      return this.stats;
    } finally {
      this.isProcessing = false;
      this.abortController = null;
    }
  }

  /**
   * Internal method to process workspace files
   */
  private async doProcessWorkspace(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    maxFiles: number,
    batchSize: number,
    excludePatterns: string[],
    progress: vscode.Progress<{ message?: string; increment?: number }> | null,
    signal: AbortSignal
  ): Promise<ProcessingStats> {
    const startTime = performance.now();

    // Find all JS/TS files
    const allFiles: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      try {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/*.{js,jsx,ts,tsx}"),
          `{${excludePatterns.join(",")}}`,
          maxFiles - allFiles.length
        );
        allFiles.push(...files);

        // Stop if we've reached the max files
        if (allFiles.length >= maxFiles) {
          break;
        }
      } catch (error) {
        console.error(
          `Error finding files in workspace folder ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    // Limit the number of files
    const filesToProcess = allFiles.slice(0, maxFiles);
    this.stats.totalFiles = filesToProcess.length;

    if (progress) {
      progress.report({
        message: `Found ${filesToProcess.length} files to process`,
      });
    }

    // Process files in batches
    for (let i = 0; i < filesToProcess.length; i += batchSize) {
      if (signal.aborted) {
        console.log("Processing aborted by user");
        break;
      }

      const batch = filesToProcess.slice(i, i + batchSize);

      // Process batch in parallel
      await Promise.all(
        batch.map(async (file) => {
          try {
            if (signal.aborted) {
              return;
            }

            // Skip if already processed
            if (this.processedFiles.has(file.fsPath)) {
              this.stats.skippedFiles++;
              return;
            }

            // Skip if file should not be processed
            if (!this.shouldProcessFile(file.fsPath)) {
              this.stats.skippedFiles++;
              return;
            }

            const document = await vscode.workspace.openTextDocument(file);
            await this.processFile(document);
          } catch (error) {
            console.error(`Error processing file ${file.fsPath}:`, error);
            this.stats.skippedFiles++;
          }
        })
      );

      if (progress) {
        const percentComplete = Math.min(
          100,
          Math.round(((i + batch.length) / filesToProcess.length) * 100)
        );
        progress.report({
          message: `Processed ${i + batch.length} of ${
            filesToProcess.length
          } files (${percentComplete}%)`,
          increment: (batch.length / filesToProcess.length) * 100,
        });
      }

      // Small delay to prevent UI freezing
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const endTime = performance.now();
    this.stats.processingTime = endTime - startTime;

    // Log stats
    console.log(`NPM Import Validator stats:
      - Total files: ${this.stats.totalFiles}
      - Processed: ${this.stats.processedFiles}
      - Skipped: ${this.stats.skippedFiles}
      - Total imports: ${this.stats.totalImports}
      - Valid imports: ${this.stats.validImports}
      - Invalid imports: ${this.stats.invalidImports}
      - Processing time: ${Math.round(this.stats.processingTime)}ms
    `);

    return this.stats;
  }

  /**
   * Cancel ongoing processing
   */
  cancelProcessing(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Get all exclude patterns from configuration
   */
  private getExcludePatterns(): string[] {
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const excludePatterns = config.get<string[]>("excludePatterns") || [];
    const excludeCommonFrameworks =
      config.get<boolean>("excludeCommonFrameworks") || true;
    const excludeOtherExtensions =
      config.get<boolean>("excludeOtherExtensions") || true;

    // Standard exclusions
    const standardExclusions = [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/build/**",
      "**/.git/**",
    ];

    // Add common framework patterns if configured
    const frameworkExclusions = excludeCommonFrameworks
      ? [
          // React
          "**/react/**",
          "**/react-dom/**",
          "**/react-router/**",
          "**/react-redux/**",
          // Angular
          "**/angular/**",
          "**/angular-core/**",
          "**/angular-common/**",
          "**/angular-material/**",
          "**/rxjs/**",
          // Next.js
          "**/next/**",
          "**/.next/**",
          "**/next-auth/**",
          // Vue
          "**/vue/**",
          "**/vue-router/**",
          "**/vuex/**",
          // Common UI libraries
          "**/material-ui/**",
          "**/antd/**",
          "**/bootstrap/**",
          "**/tailwindcss/**",
          // Common utilities
          "**/lodash/**",
          "**/moment/**",
          "**/axios/**",
          "**/jquery/**",
        ]
      : [];

    // Add patterns to exclude other extensions
    const otherExtensionsExclusions = excludeOtherExtensions
      ? ["**/.vscode-test/**", "**/.vscode/extensions/**"]
      : [];

    // Custom exclusions from user settings
    const customExclusions = this.getCustomExcludePatterns();

    return [
      ...standardExclusions,
      ...frameworkExclusions,
      ...otherExtensionsExclusions,
      ...customExclusions,
      ...excludePatterns,
    ];
  }

  /**
   * Get custom exclude patterns from workspace settings
   */
  private getCustomExcludePatterns(): string[] {
    // Check for .npmimportignore file in workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    // Get patterns from settings
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const customPatterns = config.get<string[]>("customExcludePatterns") || [];

    return customPatterns;
  }

  /**
   * Check if a file should be processed based on exclusion rules
   */
  shouldProcessFile(filePath: string): boolean {
    // Skip non-JS/TS files
    if (!filePath.match(/\.(js|jsx|ts|tsx)$/i)) {
      return false;
    }

    // Skip files from other extensions
    if (this.isFileFromOtherExtension(filePath)) {
      return false;
    }

    // Get all exclude patterns
    const excludePatterns = this.getExcludePatterns();

    // Check if file matches any exclude pattern
    for (const pattern of excludePatterns) {
      if (new RegExp(this.convertGlobToRegExp(pattern)).test(filePath)) {
        return false;
      }
    }

    // Check if file is in a trusted workspace
    if (!this.isFileTrusted(filePath)) {
      return false;
    }

    return true;
  }

  /**
   * Check if a file is from another VS Code extension
   */
  private isFileFromOtherExtension(filePath: string): boolean {
    // Check if file is in the .vscode/extensions directory
    if (filePath.includes(".vscode/extensions")) {
      // But allow our own extension
      const ourExtensionPath = this.extensionContext.extensionPath;
      if (filePath.startsWith(ourExtensionPath)) {
        return false;
      }
      return true;
    }

    // Check for common extension paths
    const extensionPatterns = [
      /[\\/]\.vscode-test[\\/]/,
      /[\\/]vscode-extension[\\/]/,
      /[\\/]vscode-insiders[\\/]/,
    ];

    return extensionPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Check if a file is in a trusted workspace
   */
  private isFileTrusted(_filePath: string): boolean {
    // In VS Code, we can check if the workspace is trusted
    // For now, we'll assume all files are trusted
    // In a real implementation, you would use the workspace trust API
    return true;
  }

  /**
   * Convert glob pattern to RegExp
   */
  private convertGlobToRegExp(glob: string): string {
    return glob
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\//g, "\\/");
  }

  /**
   * Get current processing stats
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Clear processing caches
   */
  clearCaches(): void {
    this.processedFiles.clear();
    this.fileImportCache.clear();
    this.validator.clearCaches();
  }
}
