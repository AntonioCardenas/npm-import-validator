import * as vscode from "vscode";
import { performance } from "perf_hooks";
import type { ImportValidator } from "./importValidator";
import type { DiagnosticsManager } from "./diagnosticsManager";
import type { StatusBarManager } from "./statusBarManager";
import * as path from "path";
import * as fs from "fs";
import type { ImportResult } from "./importValidator";

interface ProcessingStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  unchangedFiles: number;
  totalImports: number;
  validImports: number;
  invalidImports: number;
  projectImports: number;
  frameworkImports: number;
  processingTime: number;
}

interface FileMetadata {
  lastProcessed: number;
  lastModified: number;
  imports: string[];
}

export class FileProcessor {
  private processingQueue: Set<string> = new Set();
  private processedFiles: Set<string> = new Set();
  private fileImportCache: Map<string, Set<string>> = new Map();
  private fileMetadataCache: Map<string, FileMetadata> = new Map();
  private stats: ProcessingStats = this.resetStats();
  private isProcessing = false;
  private abortController: AbortController | null = null;
  private extensionContext: vscode.ExtensionContext;
  public validator: ImportValidator; // Made public for statistics provider
  private fileWatcher: vscode.FileSystemWatcher | null = null;

  constructor(
    validator: ImportValidator,
    private diagnosticsManager: DiagnosticsManager,
    private statusBarManager: StatusBarManager,
    context: vscode.ExtensionContext
  ) {
    this.validator = validator;
    this.extensionContext = context;

    // Load file metadata cache from storage
    this.loadFileMetadataCache();

    // Set up file watcher to track changes
    this.setupFileWatcher();
  }

  private resetStats(): ProcessingStats {
    return {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      unchangedFiles: 0,
      totalImports: 0,
      validImports: 0,
      invalidImports: 0,
      projectImports: 0,
      frameworkImports: 0,
      processingTime: 0,
    };
  }

  /**
   * Load file metadata cache from storage
   */
  private loadFileMetadataCache(): void {
    try {
      const cachedData = this.extensionContext.workspaceState.get<
        Record<string, FileMetadata>
      >("npmImportValidatorFileMetadata");
      if (cachedData) {
        this.fileMetadataCache = new Map(Object.entries(cachedData));
        console.log(
          `Loaded metadata for ${this.fileMetadataCache.size} files from cache`
        );
      }
    } catch (error) {
      console.error("Error loading file metadata cache:", error);
    }
  }

  /**
   * Save file metadata cache to storage
   */
  private saveFileMetadataCache(): void {
    try {
      const cacheObject = Object.fromEntries(this.fileMetadataCache);
      this.extensionContext.workspaceState.update(
        "npmImportValidatorFileMetadata",
        cacheObject
      );
    } catch (error) {
      console.error("Error saving file metadata cache:", error);
    }
  }

  /**
   * Set up file watcher to track changes
   */
  private setupFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Watch for changes to JS/TS files
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{js,jsx,ts,tsx}"
    );

    // When a file changes, mark it for reprocessing
    this.fileWatcher.onDidChange((uri) => {
      const filePath = uri.fsPath;
      if (this.fileMetadataCache.has(filePath)) {
        const metadata = this.fileMetadataCache.get(filePath);
        if (metadata) {
          metadata.lastModified = Date.now();
          this.fileMetadataCache.set(filePath, metadata);
          this.saveFileMetadataCache();
        }
      }
    });

    // When a file is created, add it to the cache
    this.fileWatcher.onDidCreate((uri) => {
      const filePath = uri.fsPath;
      if (!this.fileMetadataCache.has(filePath)) {
        this.fileMetadataCache.set(filePath, {
          lastProcessed: 0,
          lastModified: Date.now(),
          imports: [],
        });
        this.saveFileMetadataCache();
      }
    });

    // When a file is deleted, remove it from the cache
    this.fileWatcher.onDidDelete((uri) => {
      const filePath = uri.fsPath;
      if (this.fileMetadataCache.has(filePath)) {
        this.fileMetadataCache.delete(filePath);
        this.saveFileMetadataCache();
      }
    });
  }

  /**
   * Check if a file has changed since the last scan
   */
  private hasFileChanged(filePath: string): boolean {
    try {
      // If we don't have metadata for this file, consider it changed
      if (!this.fileMetadataCache.has(filePath)) {
        return true;
      }

      const _metadata = this.fileMetadataCache.get(filePath);
      if (!_metadata) {
        return true; // If metadata doesn't exist, consider the file changed
      }

      // If we've never processed this file, consider it changed
      if (_metadata.lastProcessed === 0) {
        return true;
      }

      // Check if the file's modification time is newer than our last processing time
      const stats = fs.statSync(filePath);
      const fileModTime = stats.mtimeMs;

      // If the file has been modified since we last processed it, consider it changed
      return fileModTime > _metadata.lastProcessed;
    } catch (error) {
      console.error(`Error checking if file ${filePath} has changed:`, error);
      // If there's an error, assume the file has changed to be safe
      return true;
    }
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

    // Check if the file has changed since the last scan
    const hasChanged = this.hasFileChanged(filePath);
    if (!hasChanged) {
      this.stats.unchangedFiles++;
      return;
    }

    this.processingQueue.add(filePath);
    this.statusBarManager.setValidating();

    try {
      const _startTime = performance.now();
      let results: ImportResult[] = [];

      try {
        results = await this.validator.validateDocument(document);
      } catch (validationError) {
        console.error(
          `Error validating document ${document.uri.fsPath}:`,
          validationError
        );
        this.statusBarManager.setError();

        // Show a more specific error message
        vscode.window.showErrorMessage(
          `Error validating imports in ${path.basename(
            document.uri.fsPath
          )}. See console for details.`
        );
      }

      // Ensure we have valid results
      if (!results) {
        results = [];
        console.error(`No results returned for ${document.uri.fsPath}`);
      }

      // Log the number of imports found for debugging
      console.log(`Found ${results.length} imports in ${document.uri.fsPath}`);

      const _endTime = performance.now();

      // Update stats
      this.stats.processedFiles++;
      this.stats.totalImports += results.length;
      this.stats.validImports += results.filter((r) => r.existsOnNpm).length;
      this.stats.invalidImports += results.filter((r) => !r.existsOnNpm).length;
      this.stats.projectImports += results.filter((r) => r.isInProject).length;
      this.stats.frameworkImports += results.filter(
        (r) => r.isFramework
      ).length;

      // Log updated stats for debugging
      console.log(
        `Updated stats: Total imports: ${this.stats.totalImports}, Valid: ${this.stats.validImports}, Invalid: ${this.stats.invalidImports}`
      );

      // Cache imports for this file
      const importNames = results.map((r) => r.importName);
      this.fileImportCache.set(filePath, new Set(importNames));

      // Update file metadata
      try {
        const fileStats = fs.statSync(filePath);
        this.fileMetadataCache.set(filePath, {
          lastProcessed: Date.now(),
          lastModified: fileStats.mtimeMs,
          imports: importNames,
        });
      } catch (error) {
        console.error(`Error getting file stats for ${filePath}:`, error);
      }
      this.saveFileMetadataCache();

      // Update diagnostics
      this.diagnosticsManager.updateDiagnostics(document, results);

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
  async processWorkspace(
    showProgress = true,
    onlyChanged = true
  ): Promise<ProcessingStats> {
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
            title: onlyChanged
              ? "NPM Import Validator (Changed Files Only)"
              : "NPM Import Validator (All Files)",
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
              signal,
              onlyChanged
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
          signal,
          onlyChanged
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
    signal: AbortSignal,
    onlyChanged: boolean
  ): Promise<ProcessingStats> {
    const _startTime = performance.now();

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

    // Filter files if we're only processing changed files
    let filesToProcess = allFiles.slice(0, maxFiles);
    if (onlyChanged) {
      filesToProcess = filesToProcess.filter((file) =>
        this.hasFileChanged(file.fsPath)
      );
      if (progress) {
        progress.report({
          message: `Found ${filesToProcess.length} changed files out of ${allFiles.length} total files`,
        });
      }
    }

    this.stats.totalFiles = allFiles.length;
    this.stats.unchangedFiles = allFiles.length - filesToProcess.length;

    if (progress) {
      progress.report({ message: `Processing ${filesToProcess.length} files` });
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

    const _endTime = performance.now();
    this.stats.processingTime = _endTime - _startTime;

    // Log stats
    console.log(`NPM Import Validator stats:
    - Total files: ${this.stats.totalFiles}
    - Unchanged files: ${this.stats.unchangedFiles}
    - Processed: ${this.stats.processedFiles}
    - Skipped: ${this.stats.skippedFiles}
    - Total imports: ${this.stats.totalImports}
    - Valid imports: ${this.stats.validImports}
    - Invalid imports: ${this.stats.invalidImports}
    - Project imports: ${this.stats.projectImports}
    - Framework imports: ${this.stats.frameworkImports}
    - Processing time: ${Math.round(this.stats.processingTime)}ms
  `);

    return this.stats;
  }

  /**
   * Get all imports from all processed files
   */
  getAllImports(): Set<string> {
    const allImports = new Set<string>();

    // Collect imports from file metadata cache
    for (const metadata of this.fileMetadataCache.values()) {
      if (metadata.imports && Array.isArray(metadata.imports)) {
        metadata.imports.forEach((importName: string) =>
          allImports.add(importName)
        );
      }
    }

    return allImports;
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
    if (!filePath.match(/\.(js|jsx,ts,tsx)$/i)) {
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
    this.fileMetadataCache.clear();
    this.saveFileMetadataCache();
    this.validator.clearCaches();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
  }

  /**
   * Reset statistics to initial values
   */
  public resetStatistics(): void {
    this.stats = this.resetStats();
    console.log("Statistics reset to initial values");
  }

  /**
   * Recalculate statistics from processed files
   */
  public async recalculateStatistics(): Promise<void> {
    // Reset statistics
    this.resetStatistics();

    // Get all processed files
    const processedFilePaths = Array.from(this.processedFiles);
    console.log(
      `Recalculating statistics for ${processedFilePaths.length} processed files`
    );

    // Process each file again to update statistics
    for (const _filePath of processedFilePaths) {
      try {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(_filePath)
        );
        const results = await this.validator.validateDocument(document);

        // Update statistics
        this.stats.totalImports += results.length;
        this.stats.validImports += results.filter((r) => r.existsOnNpm).length;
        this.stats.invalidImports += results.filter(
          (r) => !r.existsOnNpm
        ).length;
        this.stats.projectImports += results.filter(
          (r) => r.isInProject
        ).length;
        this.stats.frameworkImports += results.filter(
          (r) => r.isFramework
        ).length;
      } catch (error) {
        console.error(
          `Error recalculating statistics for ${_filePath}:`,
          error
        );
      }
    }

    console.log(
      `Statistics recalculation complete: Total imports: ${this.stats.totalImports}`
    );
  }
}
