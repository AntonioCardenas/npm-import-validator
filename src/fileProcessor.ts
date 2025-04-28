import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ImportValidator, ImportResult } from "./importValidator";
import type { DiagnosticsManager } from "./diagnosticsManager";
import type { StatusBarManager } from "./statusBarManager";

// Types and interfaces
interface ProjectTypeInfo {
  type: "react" | "next" | "angular" | "vue" | "node" | "unknown";
  mainSrcDir: string;
  packageJson: PackageJsonStructure | null;
}

// Add this interface to define the package.json structure
interface PackageJsonStructure {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  type?: string;
  scripts?: Record<string, string>;
}

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
  errorFiles: string[]; // Track files that caused errors
}

interface ProcessingOptions {
  forceReprocess?: boolean;
  showProgress?: boolean;
}

// Define storage keys
const STORAGE_KEYS = {
  stats: "npmImportValidatorStats",
};

/**
 * Checks if a file should be processed based on its extension.
 * @param filePath The path to the file.
 * @returns True if the file should be processed, false otherwise.
 */
function shouldProcessFile(filePath: string): boolean {
  const supportedExtensions = [".js", ".jsx", ".ts", ".tsx"];
  const fileExtension = path.extname(filePath);
  return supportedExtensions.includes(fileExtension);
}

export class FileProcessor {
  // Stats and tracking
  private stats: ProcessingStats = this.createEmptyStats();
  private processedFilesCache = new Map<string, number>(); // Map of file path to timestamp
  private processedFilesInSession = new Set<string>(); // Track files processed in current session
  private processedImportsInSession = new Set<string>(); // Track imports processed in current session
  private errorFilesInSession = new Set<string>(); // Track files that caused errors

  // Processing state
  public cancelProcessing = false;
  private isProcessing = false;
  private processingProgress: vscode.Progress<{
    message?: string;
    increment?: number;
  }> | null = null;
  private processingToken: vscode.CancellationTokenSource | null = null;

  // File patterns
  private gitignorePatterns: string[] = [];
  private eligibleFiles: vscode.Uri[] = [];

  constructor(
    private validator: ImportValidator,
    private diagnosticsManager: DiagnosticsManager,
    private statusBarManager: StatusBarManager,
    private context: vscode.ExtensionContext
  ) {
    this.loadSavedStats();
    this.loadGitignorePatterns();
  }

  /**
   * Creates an empty stats object
   */
  private createEmptyStats(): ProcessingStats {
    return {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      unchangedFiles: 0,
      totalImports: 0,
      validImports: 0,
      invalidImports: 0,
      frameworkImports: 0,
      projectImports: 0,
      processingTime: 0,
      lastUpdated: new Date(),
      processingPercentage: 0,
      errorFiles: [],
    };
  }

  /**
   * Loads saved stats from storage
   */
  private loadSavedStats(): void {
    const savedStats = this.context.globalState.get<ProcessingStats>(
      STORAGE_KEYS.stats
    );
    if (savedStats) {
      this.stats = savedStats;
    }
  }

  /**
   * Loads gitignore patterns from workspace
   */
  private async loadGitignorePatterns(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    this.gitignorePatterns = [];

    for (const folder of workspaceFolders) {
      try {
        const gitignorePath = path.join(folder.uri.fsPath, ".gitignore");

        // Check if .gitignore exists
        if (fs.existsSync(gitignorePath)) {
          const content = fs.readFileSync(gitignorePath, "utf8");
          const lines = content.split("\n");

          // Process each line
          for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip empty lines and comments
            if (trimmedLine === "" || trimmedLine.startsWith("#")) {
              continue;
            }

            // Remove negation (!) as we're only interested in exclusions
            if (trimmedLine.startsWith("!")) {
              continue;
            }

            // Convert gitignore pattern to glob pattern
            let pattern = trimmedLine;

            // Handle directory indicators
            if (pattern.endsWith("/")) {
              pattern = pattern + "**";
            }

            // Convert gitignore pattern to glob pattern
            // Add ** prefix if pattern doesn't start with /
            if (!pattern.startsWith("/")) {
              pattern = "**/" + pattern;
            } else {
              // Remove leading / for relative patterns
              pattern = pattern.substring(1);
            }

            this.gitignorePatterns.push(pattern);
          }
        }
      } catch (error) {
        console.error(
          `Error loading .gitignore from ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    // Always add node_modules to the patterns
    if (!this.gitignorePatterns.includes("**/node_modules/**")) {
      this.gitignorePatterns.push("**/node_modules/**");
    }

    console.log("Loaded gitignore patterns:", this.gitignorePatterns);
  }

  /**
   * Detects the project type based on package.json and directory structure
   */
  private async detectProjectType(): Promise<ProjectTypeInfo> {
    console.log("Detecting project type...");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      console.log(
        "No workspace folders found, defaulting to unknown project type"
      );
      return { type: "unknown", mainSrcDir: "", packageJson: null };
    }

    // Default result
    const result: ProjectTypeInfo = {
      type: "unknown",
      mainSrcDir: "src",
      packageJson: null,
    };

    for (const folder of workspaceFolders) {
      try {
        // Find package.json in the root
        const packageJsonPath = path.join(folder.uri.fsPath, "package.json");

        if (fs.existsSync(packageJsonPath)) {
          const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
          const packageJson = JSON.parse(packageJsonContent);
          console.log(`Found package.json in ${folder.uri.fsPath}`);

          result.packageJson = packageJson;

          // Check dependencies and devDependencies
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          // Detect project type based on dependencies
          if (allDeps) {
            console.log(
              "Analyzing dependencies:",
              Object.keys(allDeps).join(", ")
            );

            if (allDeps["next"]) {
              console.log("Detected Next.js project");
              result.type = "next";
              // Next.js projects typically have pages or app directory
              if (fs.existsSync(path.join(folder.uri.fsPath, "app"))) {
                result.mainSrcDir = "app";
              } else if (fs.existsSync(path.join(folder.uri.fsPath, "pages"))) {
                result.mainSrcDir = "pages";
              }
            } else if (allDeps["react"] && !allDeps["@angular/core"]) {
              console.log("Detected React project");
              result.type = "react";
              result.mainSrcDir = "src";
            } else if (allDeps["@angular/core"]) {
              console.log("Detected Angular project");
              result.type = "angular";
              result.mainSrcDir = "src";
            } else if (allDeps["vue"]) {
              console.log("Detected Vue project");
              result.type = "vue";
              result.mainSrcDir = "src";
            } else if (
              allDeps["express"] ||
              allDeps["koa"] ||
              allDeps["fastify"] ||
              packageJson.type === "module"
            ) {
              console.log("Detected Node.js project");
              result.type = "node";
              result.mainSrcDir = "src";
            }
          }

          // Check for specific project structures
          if (result.type === "unknown") {
            // Check for common directory structures
            if (fs.existsSync(path.join(folder.uri.fsPath, "app"))) {
              console.log("Found 'app' directory, might be a Next.js project");
              result.mainSrcDir = "app";
            } else if (fs.existsSync(path.join(folder.uri.fsPath, "pages"))) {
              console.log(
                "Found 'pages' directory, might be a Next.js project"
              );
              result.mainSrcDir = "pages";
            } else if (fs.existsSync(path.join(folder.uri.fsPath, "src"))) {
              console.log(
                "Found 'src' directory, using as main source directory"
              );
              result.mainSrcDir = "src";
            }
          }

          // If we found a package.json, we can stop looking
          break;
        }
      } catch (error) {
        console.error(
          `Error detecting project type in ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    console.log(
      `Project type detection result: ${result.type}, main source directory: ${result.mainSrcDir}`
    );
    return result;
  }

  /**
   * Counts eligible files in the workspace
   */
  private async countEligibleFiles(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<vscode.Uri[]> {
    console.log("Starting to count eligible files in workspace...");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      console.log("No workspace folders found");
      return [];
    }

    if (progress) {
      progress.report({ message: "Counting eligible files in workspace..." });
    }

    // Detect project type to optimize file scanning
    const projectInfo = await this.detectProjectType();
    console.log(`Project detected as: ${projectInfo.type}`);

    const eligibleFiles: vscode.Uri[] = [];
    const excludePattern = this.getExcludePattern();
    console.log(`Using exclude pattern: ${excludePattern}`);

    // Define patterns based on project type
    const includePatterns = this.getIncludePatterns(projectInfo);
    console.log(`Using include patterns: ${includePatterns.join(", ")}`);

    for (const folder of workspaceFolders) {
      console.log(`Scanning workspace folder: ${folder.uri.fsPath}`);
      let folderFileCount = 0;

      // Process each include pattern
      for (const pattern of includePatterns) {
        try {
          console.log(`Searching for files matching pattern: ${pattern}`);
          const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, pattern),
            excludePattern
          );

          console.log(
            `Found ${files.length} files matching pattern: ${pattern}`
          );
          folderFileCount += files.length;

          // Filter files that should be processed
          for (const file of files) {
            if (this.shouldProcessFile(file.fsPath)) {
              eligibleFiles.push(file);
            } else {
              console.log(
                `Skipping file (excluded by shouldProcessFile): ${file.fsPath}`
              );
            }
          }
        } catch (error) {
          console.error(
            `Error finding files with pattern ${pattern} in ${folder.uri.fsPath}:`,
            error
          );
        }
      }

      console.log(
        `Total files found in folder ${folder.uri.fsPath}: ${folderFileCount}`
      );
      console.log(`Eligible files after filtering: ${eligibleFiles.length}`);
    }

    console.log(`Final count of eligible files: ${eligibleFiles.length}`);

    if (progress) {
      progress.report({
        message: `Found ${eligibleFiles.length} eligible files to process`,
      });
    }

    return eligibleFiles;
  }

  /**
   * Gets include patterns based on project type
   */
  private getIncludePatterns(projectInfo: ProjectTypeInfo): string[] {
    // Default patterns for all projects
    let includePatterns: string[] = ["**/*.{js,jsx,ts,tsx}"];

    // Adjust patterns based on project type
    if (projectInfo.type === "next") {
      console.log("Using Next.js specific patterns");
      includePatterns = [
        "pages/**/*.{js,jsx,ts,tsx}",
        "app/**/*.{js,jsx,ts,tsx}",
        "components/**/*.{js,jsx,ts,tsx}",
        "lib/**/*.{js,jsx,ts,tsx}",
        "utils/**/*.{js,jsx,ts,tsx}",
        "hooks/**/*.{js,jsx,ts,tsx}",
        "src/**/*.{js,jsx,ts,tsx}",
        // Include config files that might use TypeScript
        "*.config.{js,ts}",
        "next.config.{js,ts,mjs}",
      ];
    } else if (projectInfo.type === "angular") {
      console.log("Using Angular specific patterns");
      includePatterns = ["src/**/*.{ts,js}", "projects/**/*.{ts,js}"];
    } else if (projectInfo.mainSrcDir) {
      console.log(`Using main source directory: ${projectInfo.mainSrcDir}`);
      includePatterns = [
        `${projectInfo.mainSrcDir}/**/*.{js,jsx,ts,tsx}`,
        // Include config files that might use TypeScript
        "*.config.{js,ts}",
      ];
    }

    return includePatterns;
  }

  /**
   * Processes a single file
   */
  async processFile(document: vscode.TextDocument): Promise<ImportResult[]> {
    if (!this.shouldProcessFile(document.uri.fsPath)) {
      return [];
    }

    this.statusBarManager.setValidating();
    const startTime = Date.now();
    const filePath = document.uri.fsPath;

    try {
      // Validate imports in the document
      const results = await this.validator.validateDocument(document);

      // Update diagnostics
      this.diagnosticsManager.updateDiagnostics(document, results);

      // Update stats - only if this is not part of a workspace scan
      // This prevents double-counting when processing individual files
      if (!this.isProcessing) {
        // Only count this file if it hasn't been processed in this session
        if (!this.processedFilesInSession.has(filePath)) {
          this.processedFilesInSession.add(filePath);
          this.updateStatsForFile(filePath, results, false);
        }
      }

      // Update status bar
      const invalidCount = results.filter(
        (r) => !r.existsOnNpm && !r.isFramework
      ).length;
      if (invalidCount > 0) {
        this.statusBarManager.setInvalidImports(invalidCount);
      } else {
        this.statusBarManager.setValid();
      }

      // Cache the file processing timestamp
      this.processedFilesCache.set(filePath, Date.now());

      // Update processing time
      this.stats.processingTime = Date.now() - startTime;
      this.stats.lastUpdated = new Date();
      this.saveStats();

      return results;
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      this.statusBarManager.setError();

      // Track error files
      this.errorFilesInSession.add(filePath);
      if (!this.stats.errorFiles.includes(filePath)) {
        this.stats.errorFiles.push(filePath);
      }

      return [];
    }
  }

  /**
   * Processes all files in the workspace
   */
  async processWorkspace(
    options: ProcessingOptions = {}
  ): Promise<ProcessingStats> {
    const { forceReprocess = false, showProgress = true } = options;
    console.log(
      `Starting workspace processing (forceReprocess: ${forceReprocess})`
    );

    if (this.isProcessing) {
      console.log("Already processing workspace, returning current stats");
      vscode.window.showInformationMessage(
        "NPM Import Validator is already processing files."
      );
      return this.stats;
    }

    this.isProcessing = true;
    this.cancelProcessing = false;

    // Reset stats and tracking sets for a new workspace scan
    if (forceReprocess) {
      console.log(
        "Force reprocessing requested, resetting stats and tracking sets"
      );
      this.resetStats();
      this.processedFilesInSession.clear();
      this.processedImportsInSession.clear();
      this.errorFilesInSession.clear();
    }

    // Reload gitignore patterns
    console.log("Reloading gitignore patterns");
    await this.loadGitignorePatterns();
    console.log(`Loaded ${this.gitignorePatterns.length} gitignore patterns`);

    try {
      if (showProgress) {
        // Show progress indicator
        this.processingToken = new vscode.CancellationTokenSource();
        const progressOptions: vscode.ProgressOptions = {
          location: vscode.ProgressLocation.Notification,
          title: "NPM Import Validator",
          cancellable: true,
        };

        return await vscode.window.withProgress(
          progressOptions,
          async (progress, token) => {
            this.processingProgress = progress;
            token.onCancellationRequested(() => {
              console.log("Cancellation requested by user");
              this.cancelProcessing = true;
            });

            return await this.doProcessWorkspace(progress);
          }
        );
      } else {
        // Process without progress indicator
        return await this.doProcessWorkspace();
      }
    } catch (error) {
      console.error("Error processing workspace:", error);
      this.statusBarManager.setError();
      return this.stats;
    } finally {
      this.isProcessing = false;
      this.processingProgress = null;
      if (this.processingToken) {
        this.processingToken.dispose();
        this.processingToken = null;
      }
      console.log("Workspace processing finished");
    }
  }

  /**
   * Does the actual workspace processing
   */
  private async doProcessWorkspace(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<ProcessingStats> {
    // Add startTime at the beginning of the method
    const startTime: number = Date.now();

    // Count eligible files first
    console.log("Starting to count eligible files");
    this.eligibleFiles = await this.countEligibleFiles(progress);

    // Update total files count
    this.stats.totalFiles = this.eligibleFiles.length;
    console.log(`Updated total files count: ${this.stats.totalFiles}`);

    if (progress) {
      progress.report({
        message: `Found ${this.eligibleFiles.length} eligible files to process`,
        increment: 10, // Show some progress for the counting phase
      });
    }

    if (this.eligibleFiles.length === 0) {
      console.log("No eligible files found to process");
      if (progress) {
        progress.report({ message: "No eligible files found to process." });
      }
      return this.stats;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const maxFiles = config.get<number>("maxFilesToProcess") || 1000;
    const batchSize = config.get<number>("processingBatchSize") || 20;

    console.log(`Configuration: maxFiles=${maxFiles}, batchSize=${batchSize}`);

    // Limit the number of files to process
    const filesToProcess = this.eligibleFiles.slice(0, maxFiles);
    console.log(
      `Will process ${filesToProcess.length} files (limited by maxFiles=${maxFiles})`
    );

    let processedCount = 0;
    let skippedCount = 0;
    let unchangedCount = 0;

    // Process files in batches
    for (let i = 0; i < filesToProcess.length; i += batchSize) {
      if (this.cancelProcessing) {
        console.log("Processing cancelled by user");
        if (progress) {
          progress.report({ message: "Processing cancelled." });
        }
        break;
      }

      const batch = filesToProcess.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(
          filesToProcess.length / batchSize
        )}, size: ${batch.length}`
      );

      const batchPromises = batch.map(async (file) => {
        try {
          const filePath = file.fsPath;

          // Skip if already processed in this session
          if (this.processedFilesInSession.has(filePath)) {
            console.log(`Skipping already processed file: ${filePath}`);
            unchangedCount++;
            return;
          }

          // Check if file has been modified since last processing
          const lastProcessed = this.processedFilesCache.get(filePath);
          const fileStats = await vscode.workspace.fs.stat(file);

          if (
            lastProcessed &&
            fileStats.mtime <= lastProcessed &&
            !this.isForceReprocessing()
          ) {
            console.log(`Skipping unchanged file: ${filePath}`);
            unchangedCount++;
            return;
          }

          console.log(`Processing file: ${filePath}`);
          // Process the file
          const document = await vscode.workspace.openTextDocument(file);
          const results = await this.validator.validateDocument(document);

          console.log(`Found ${results.length} imports in file: ${filePath}`);

          // Update diagnostics
          this.diagnosticsManager.updateDiagnostics(document, results);

          // Mark as processed in this session
          this.processedFilesInSession.add(filePath);

          // Update stats with workspace scan flag
          this.updateStatsForFile(filePath, results, true);

          // Cache the file processing timestamp
          this.processedFilesCache.set(filePath, Date.now());

          processedCount++;
        } catch (error) {
          console.error(`Error processing file ${file.fsPath}:`, error);
          skippedCount++;

          // Track error files
          this.errorFilesInSession.add(file.fsPath);
          if (!this.stats.errorFiles.includes(file.fsPath)) {
            this.stats.errorFiles.push(file.fsPath);
          }
        }
      });

      await Promise.all(batchPromises);

      // Calculate progress percentage
      const percentComplete = Math.min(
        100,
        Math.round(((i + batch.length) / filesToProcess.length) * 90) + 10
      );
      this.stats.processingPercentage = percentComplete;
      console.log(
        `Progress: ${percentComplete}%, processed: ${processedCount}, skipped: ${skippedCount}, unchanged: ${unchangedCount}`
      );

      // Update progress
      if (progress) {
        progress.report({
          message: `Processed ${processedCount} of ${filesToProcess.length} files (${percentComplete}%)`,
          increment: (batch.length / filesToProcess.length) * 90, // Remaining 90% for processing
        });
      }

      this.statusBarManager.setProcessingWorkspace(
        processedCount,
        filesToProcess.length
      );
    }

    // Update stats
    this.stats.processedFiles = processedCount;
    this.stats.skippedFiles = skippedCount;
    this.stats.unchangedFiles = unchangedCount;
    this.stats.processingTime = Date.now() - startTime;
    this.stats.lastUpdated = new Date();
    this.stats.processingPercentage = 100;

    console.log(
      `Workspace processing complete. Stats: processed=${processedCount}, skipped=${skippedCount}, unchanged=${unchangedCount}, time=${this.stats.processingTime}ms`
    );
    console.log(
      `Import stats: total=${this.stats.totalImports}, valid=${this.stats.validImports}, invalid=${this.stats.invalidImports}, framework=${this.stats.frameworkImports}, project=${this.stats.projectImports}`
    );

    this.saveStats();

    // Update status bar
    if (this.stats.invalidImports > 0) {
      this.statusBarManager.setInvalidImports(this.stats.invalidImports);
    } else {
      this.statusBarManager.setValid();
    }

    return this.stats;
  }

  /**
   * Checks if force reprocessing is enabled
   */
  private isForceReprocessing(): boolean {
    return this.cancelProcessing === false;
  }

  /**
   * Cancels ongoing processing
   */
  cancelProcessingOperation(): void {
    this.cancelProcessing = true;
    if (this.processingToken) {
      this.processingToken.cancel();
    }
  }

  /**
   * Checks if a file should be processed
   */
  shouldProcessFile(filePath: string): boolean {
    // Skip files in node_modules
    if (filePath.includes("node_modules")) {
      return false;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const excludePatterns = config.get<string[]>("excludePatterns") || [];
    const customExcludePatterns =
      config.get<string[]>("customExcludePatterns") || [];
    const excludeReactNextjs =
      config.get<boolean>("excludeReactNextjs") || false;
    const excludeOtherExtensions =
      config.get<boolean>("excludeOtherExtensions") || false;

    // Combine all exclude patterns
    const allExcludePatterns = [
      ...excludePatterns,
      ...customExcludePatterns,
      ...this.gitignorePatterns,
    ];

    // Check against exclude patterns
    for (const pattern of allExcludePatterns) {
      if (this.matchesGlobPattern(filePath, pattern)) {
        return false;
      }
    }

    // Check for React/Next.js files
    if (excludeReactNextjs) {
      const reactNextjsPatterns = [
        "**/node_modules/react/**",
        "**/node_modules/react-dom/**",
        "**/node_modules/next/**",
        "**/pages/**",
        "**/components/**",
      ];

      for (const pattern of reactNextjsPatterns) {
        if (this.matchesGlobPattern(filePath, pattern)) {
          return false;
        }
      }
    }

    // Check for other extension files
    if (excludeOtherExtensions) {
      const extensionsPath = path.join(
        path.dirname(filePath),
        ".vscode",
        "extensions"
      );
      if (filePath.includes(extensionsPath)) {
        return false;
      }
    }

    // Use the utility function for extension checking
    return shouldProcessFile(filePath);
  }

  /**
   * Matches a file path against a glob pattern
   */
  private matchesGlobPattern(filePath: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");

    return new RegExp(`^${regexPattern}$`).test(filePath);
  }

  /**
   * Gets exclude pattern for workspace.findFiles
   */
  private getExcludePattern(): vscode.GlobPattern {
    const config = vscode.workspace.getConfiguration("npmImportValidator");
    const excludePatterns = config.get<string[]>("excludePatterns") || [];
    const customExcludePatterns =
      config.get<string[]>("customExcludePatterns") || [];

    // Combine all exclude patterns including gitignore patterns
    const allExcludePatterns = [
      ...excludePatterns,
      ...customExcludePatterns,
      ...this.gitignorePatterns,
    ];

    // Create a single glob pattern
    return `{${allExcludePatterns.join(",")}}`;
  }

  /**
   * Updates stats for a file
   */
  private updateStatsForFile(
    filePath: string,
    results: ImportResult[],
    isWorkspaceScan: boolean
  ): void {
    console.log(
      `Updating stats for file: ${filePath}, results: ${results.length}, isWorkspaceScan: ${isWorkspaceScan}`
    );

    // Count imports by type, avoiding duplicates in the current session
    let validImports = 0;
    let invalidImports = 0;
    let frameworkImports = 0;
    let projectImports = 0;

    for (const result of results) {
      // Create a unique key for this import to avoid duplicates
      const importKey = `${filePath}:${result.importName}:${result.importType}`;

      // Skip if already processed in this session during a workspace scan
      if (isWorkspaceScan && this.processedImportsInSession.has(importKey)) {
        console.log(`Skipping already processed import: ${importKey}`);
        continue;
      }

      // Mark as processed
      this.processedImportsInSession.add(importKey);

      // Count by type
      if (result.existsOnNpm && !result.isFramework) {
        validImports++;
      }
      if (!result.existsOnNpm && !result.isFramework) {
        invalidImports++;
      }
      if (result.isFramework) {
        frameworkImports++;
      }
      if (result.isInProject) {
        projectImports++;
      }
    }

    console.log(
      `Counted imports for ${filePath}: valid=${validImports}, invalid=${invalidImports}, framework=${frameworkImports}, project=${projectImports}`
    );

    // Update stats
    this.stats.totalImports += results.length;
    this.stats.validImports += validImports;
    this.stats.invalidImports += invalidImports;
    this.stats.frameworkImports += frameworkImports;
    this.stats.projectImports += projectImports;

    // Only increment processed files count if this is a workspace scan
    // For individual file processing, this is handled in the processFile method
    if (isWorkspaceScan) {
      this.stats.processedFiles++;
    }

    this.stats.lastUpdated = new Date();

    // Save stats
    this.saveStats();
    console.log(
      `Updated stats: total=${this.stats.totalImports}, valid=${this.stats.validImports}, invalid=${this.stats.invalidImports}, framework=${this.stats.frameworkImports}, project=${this.stats.projectImports}`
    );
  }

  /**
   * Resets stats
   */
  resetStats(): void {
    this.stats = this.createEmptyStats();
    this.saveStats();
  }

  /**
   * Saves stats to storage
   */
  private saveStats(): void {
    this.context.globalState.update(STORAGE_KEYS.stats, this.stats);
  }

  /**
   * Gets stats
   */
  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  /**
   * Gets error files
   */
  getErrorFiles(): string[] {
    return [...this.stats.errorFiles];
  }

  /**
   * Clears caches
   */
  clearCaches(): void {
    this.processedFilesCache.clear();
    this.processedFilesInSession.clear();
    this.processedImportsInSession.clear();
    this.errorFilesInSession.clear();
    this.resetStats();
  }

  /**
   * Finds unused dependencies in package.json
   */
  async findUnusedDependencies(): Promise<Map<string, string>> {
    const unusedDependencies = new Map<string, string>();

    // Get workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return unusedDependencies;
    }

    // Find all package.json files
    for (const folder of workspaceFolders) {
      try {
        const packageJsonFiles = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/package.json"),
          "**/node_modules/**"
        );

        for (const packageJsonFile of packageJsonFiles) {
          try {
            // Read package.json
            const content = await vscode.workspace.fs.readFile(packageJsonFile);
            const packageJson = JSON.parse(content.toString());

            // Get dependencies
            const dependencies = {
              ...packageJson.dependencies,
              ...packageJson.devDependencies,
            };

            if (!dependencies) {
              continue;
            }

            // Get all imports in the workspace
            const allImports = await this.validator.getAllImportsInWorkspace();
            const usedPackages = new Set<string>();

            // Collect all used packages
            for (const [_, imports] of allImports) {
              for (const importResult of imports) {
                usedPackages.add(importResult.importName);
              }
            }

            // Find unused dependencies
            for (const [name, version] of Object.entries(dependencies)) {
              // Skip types packages and common dev tools
              if (this.shouldSkipDependency(name)) {
                continue;
              }

              // Check if package is used
              if (!usedPackages.has(name)) {
                unusedDependencies.set(name, version as string);
              }
            }
          } catch (error) {
            console.error(
              `Error processing package.json ${packageJsonFile.fsPath}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `Error finding package.json files in ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    return unusedDependencies;
  }

  /**
   * Checks if a dependency should be skipped in unused check
   */
  private shouldSkipDependency(name: string): boolean {
    // Skip TypeScript type definitions
    if (name.startsWith("@types/")) {
      return true;
    }

    // Skip common dev tools that might not be directly imported
    const commonDevTools = [
      "typescript",
      "eslint",
      "prettier",
      "jest",
      "mocha",
      "chai",
      "webpack",
      "babel",
      "rollup",
      "vite",
      "esbuild",
      "postcss",
      "tailwindcss",
      "autoprefixer",
      "nodemon",
      "ts-node",
      "husky",
      "lint-staged",
      "rimraf",
      "concurrently",
      "cross-env",
      "dotenv",
      "clsx",
      "classnames",
    ];

    return commonDevTools.some((tool) => name.includes(tool));
  }
}
