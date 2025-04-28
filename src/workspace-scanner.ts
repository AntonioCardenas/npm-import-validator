import * as vscode from "vscode";
import * as path from "path";
import {
  getFilesByExtension,
  processFilesInBatches,
  loadGitignorePatterns,
} from "./utils/file-utils";
import { measureExecutionTime } from "./utils/common";

/**
 * Workspace scanning result interface
 */
export interface WorkspaceScanResult {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  errorFiles: string[];
  filesByType: Map<string, string[]>;
  processingTime: number;
  lastUpdated: Date;
}

/**
 * Workspace scanner configuration
 */
export interface WorkspaceScannerConfig {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  batchSize?: number;
  showProgress?: boolean;
}

/**
 * Project type detection result
 */
export interface ProjectTypeInfo {
  type: "react" | "next" | "angular" | "vue" | "node" | "unknown";
  mainSrcDir: string;
  packageJson: Record<string, unknown> | null;
}

/**
 * Scans the workspace for files and provides analysis capabilities
 */
export class WorkspaceScanner {
  private lastScanResult: WorkspaceScanResult | null = null;
  private isScanning = false;
  private projectInfo: ProjectTypeInfo | null = null;
  private gitignorePatterns: string[] = [];

  /**
   * Creates a new workspace scanner
   */
  constructor(private config: WorkspaceScannerConfig = {}) {
    this.config = {
      includePatterns: ["**/*.*"],
      excludePatterns: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      maxFiles: 5000,
      batchSize: 100,
      showProgress: true,
      ...config,
    };

    // Initialize gitignore patterns
    this.initializeGitignorePatterns();
  }

  /**
   * Initializes gitignore patterns
   */
  private async initializeGitignorePatterns(): Promise<void> {
    this.gitignorePatterns = await loadGitignorePatterns();

    // Add gitignore patterns to exclude patterns
    if (this.gitignorePatterns.length > 0) {
      this.config.excludePatterns = [
        ...(this.config.excludePatterns || []),
        ...this.gitignorePatterns,
      ];
    }
  }

  /**
   * Detects the project type based on package.json and directory structure
   */
  async detectProjectType(): Promise<ProjectTypeInfo> {
    if (this.projectInfo) {
      return this.projectInfo;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      this.projectInfo = {
        type: "unknown",
        mainSrcDir: "",
        packageJson: null,
      };
      return this.projectInfo;
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
        const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");

        try {
          await vscode.workspace.fs.stat(packageJsonUri);

          // Read package.json
          const packageJsonContent = await vscode.workspace.fs.readFile(
            packageJsonUri
          );
          const packageJson = JSON.parse(
            Buffer.from(packageJsonContent).toString()
          );

          result.packageJson = packageJson;

          // Check dependencies and devDependencies
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          // Detect project type based on dependencies
          if (allDeps) {
            if (allDeps["next"]) {
              result.type = "next";
              // Next.js projects typically have pages or app directory
              try {
                await vscode.workspace.fs.stat(
                  vscode.Uri.joinPath(folder.uri, "app")
                );
                result.mainSrcDir = "app";
              } catch {
                try {
                  await vscode.workspace.fs.stat(
                    vscode.Uri.joinPath(folder.uri, "pages")
                  );
                  result.mainSrcDir = "pages";
                } catch {
                  // Default to src if neither app nor pages exists
                  result.mainSrcDir = "src";
                }
              }
            } else if (allDeps["react"] && !allDeps["@angular/core"]) {
              result.type = "react";
              result.mainSrcDir = "src";
            } else if (allDeps["@angular/core"]) {
              result.type = "angular";
              result.mainSrcDir = "src";
            } else if (allDeps["vue"]) {
              result.type = "vue";
              result.mainSrcDir = "src";
            } else if (
              allDeps["express"] ||
              allDeps["koa"] ||
              allDeps["fastify"] ||
              packageJson.type === "module"
            ) {
              result.type = "node";
              result.mainSrcDir = "src";
            }
          }

          // Check for specific project structures if type is still unknown
          if (result.type === "unknown") {
            // Check for common directory structures
            try {
              await vscode.workspace.fs.stat(
                vscode.Uri.joinPath(folder.uri, "app")
              );
              result.mainSrcDir = "app";
            } catch {
              try {
                await vscode.workspace.fs.stat(
                  vscode.Uri.joinPath(folder.uri, "pages")
                );
                result.mainSrcDir = "pages";
              } catch {
                try {
                  await vscode.workspace.fs.stat(
                    vscode.Uri.joinPath(folder.uri, "src")
                  );
                  result.mainSrcDir = "src";
                } catch {
                  // Keep default
                }
              }
            }
          }

          // If we found a package.json, we can stop looking
          break;
        } catch (error) {
          // package.json doesn't exist or couldn't be read
          continue;
        }
      } catch (error) {
        console.error(
          `Error detecting project type in ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    this.projectInfo = result;
    return result;
  }

  /**
   * Scans the workspace for files
   */
  async scanWorkspace(
    options: {
      fileTypes?: string[];
      forceRefresh?: boolean;
    } = {}
  ): Promise<WorkspaceScanResult> {
    const { fileTypes, forceRefresh = false } = options;

    // Prevent concurrent scans
    if (this.isScanning) {
      throw new Error("A workspace scan is already in progress");
    }

    // Return cached result if available and not forcing refresh
    if (!forceRefresh && this.lastScanResult) {
      return this.lastScanResult;
    }

    this.isScanning = true;

    return await measureExecutionTime(async () => {
      try {
        const result: WorkspaceScanResult = {
          totalFiles: 0,
          processedFiles: 0,
          skippedFiles: 0,
          errorFiles: [],
          filesByType: new Map<string, string[]>(),
          processingTime: 0,
          lastUpdated: new Date(),
        };

        // Ensure gitignore patterns are loaded
        if (this.gitignorePatterns.length === 0) {
          await this.initializeGitignorePatterns();
        }

        // Detect project type to optimize scanning
        const projectInfo = await this.detectProjectType();

        // If specific file types are requested, scan only those
        if (fileTypes && fileTypes.length > 0) {
          const files = await getFilesByExtension(fileTypes, {
            maxFiles: this.config.maxFiles,
            showProgress: this.config.showProgress,
            additionalExcludePatterns: this.config.excludePatterns,
          });

          result.totalFiles = files.length;
          result.processedFiles = files.length;

          // Group files by type
          files.forEach((file) => {
            const ext = path.extname(file).toLowerCase();
            if (!result.filesByType.has(ext)) {
              result.filesByType.set(ext, []);
            }
            result.filesByType.get(ext)?.push(file);
          });
        }
        // Otherwise scan all files matching include patterns
        else {
          // Adjust include patterns based on project type
          const includePatterns = this.getIncludePatterns(projectInfo);

          for (const pattern of includePatterns) {
            const files = await getFilesByExtension(
              [pattern.replace("**/*.", "")],
              {
                maxFiles: this.config.maxFiles,
                showProgress: this.config.showProgress,
                additionalExcludePatterns: this.config.excludePatterns,
              }
            );

            result.totalFiles += files.length;
            result.processedFiles += files.length;

            // Group files by type
            files.forEach((file) => {
              const ext = path.extname(file).toLowerCase();
              if (!result.filesByType.has(ext)) {
                result.filesByType.set(ext, []);
              }
              result.filesByType.get(ext)?.push(file);
            });
          }
        }

        this.lastScanResult = result;
        return result;
      } catch (error) {
        console.error("Error scanning workspace:", error);
        throw error;
      } finally {
        this.isScanning = false;
      }
    }, "Workspace scan completed in");
  }

  /**
   * Gets include patterns based on project type
   */
  private getIncludePatterns(projectInfo: ProjectTypeInfo): string[] {
    // Default patterns for all projects
    let includePatterns: string[] = ["**/*.{js,jsx,ts,tsx}"];

    // Adjust patterns based on project type
    if (projectInfo.type === "next") {
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
      includePatterns = ["src/**/*.{ts,js}", "projects/**/*.{ts,js}"];
    } else if (projectInfo.mainSrcDir) {
      includePatterns = [
        `${projectInfo.mainSrcDir}/**/*.{js,jsx,ts,tsx}`,
        // Include config files that might use TypeScript
        "*.config.{js,ts}",
      ];
    }

    return includePatterns;
  }

  /**
   * Processes files of specific types in batches
   */
  async processFilesByType<T>(
    fileType: string,
    processor: (filePath: string) => Promise<T>,
    options: {
      batchSize?: number;
      showProgress?: boolean;
      progressTitle?: string;
      onBatchComplete?: (results: T[]) => void;
    } = {}
  ): Promise<T[]> {
    // Ensure we have scan results
    if (!this.lastScanResult) {
      await this.scanWorkspace({ fileTypes: [fileType] });
    }

    // Get files of the requested type
    const ext = fileType.startsWith(".")
      ? fileType.toLowerCase()
      : `.${fileType.toLowerCase()}`;
    const files = this.lastScanResult?.filesByType.get(ext) || [];

    if (files.length === 0) {
      console.log(`No files found with extension ${ext}`);
      return [];
    }

    // Process the files in batches
    return processFilesInBatches(files, processor, {
      batchSize: options.batchSize || this.config.batchSize,
      showProgress: options.showProgress ?? this.config.showProgress,
      progressTitle: options.progressTitle || `Processing ${fileType} files`,
      onBatchComplete: options.onBatchComplete,
    });
  }

  /**
   * Gets file statistics by type
   */
  getFileStatsByType(): Map<string, number> {
    if (!this.lastScanResult) {
      return new Map();
    }

    const stats = new Map<string, number>();

    for (const [ext, files] of this.lastScanResult.filesByType.entries()) {
      stats.set(ext, files.length);
    }

    return stats;
  }

  /**
   * Gets the last scan result
   */
  getLastScanResult(): WorkspaceScanResult | null {
    return this.lastScanResult;
  }

  /**
   * Clears the scan results cache
   */
  clearCache(): void {
    this.lastScanResult = null;
  }
}

/**
 * Creates a workspace scanner with default configuration
 */
export function createWorkspaceScanner(
  config?: WorkspaceScannerConfig
): WorkspaceScanner {
  return new WorkspaceScanner(config);
}
