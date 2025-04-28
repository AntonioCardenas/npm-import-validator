import * as vscode from "vscode";
import * as path from "path";

// Cache for storing workspace file information to avoid redundant scans
const fileCache = {
  lastScanTime: 0,
  filesByPattern: new Map<string, string[]>(),
  processedFiles: new Set<string>(),
  clearCache: (): void => {
    fileCache.lastScanTime = 0;
    fileCache.filesByPattern.clear();
    fileCache.processedFiles.clear();
  },
};

// Cache timeout in milliseconds (5 minutes)
const CACHE_TIMEOUT = 5 * 60 * 1000;

/**
 * Configuration options for file retrieval
 */
interface FileRetrievalOptions {
  includePattern?: string;
  additionalExcludePatterns?: string[];
  maxFiles?: number;
  showProgress?: boolean;
  useCache?: boolean;
  forceRefresh?: boolean;
}

/**
 * Efficiently retrieves all files within a VS Code workspace, excluding node_modules
 * and preventing duplicate processing.
 *
 * @param options Configuration options for file retrieval
 * @returns Promise resolving to an array of file paths
 */
export async function getAllWorkspaceFiles(
  options: FileRetrievalOptions = {}
): Promise<string[]> {
  const {
    includePattern = "**/*.*",
    additionalExcludePatterns = [],
    maxFiles = Number.MAX_SAFE_INTEGER,
    showProgress = false,
    useCache = true,
    forceRefresh = false,
  } = options;

  // Check if workspace exists
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log("No workspace folders found");
    return [];
  }

  // Check cache first if enabled and not forcing refresh
  if (useCache && !forceRefresh) {
    const now = Date.now();
    const cacheKey = `${includePattern}:${additionalExcludePatterns.join(",")}`;

    if (
      fileCache.lastScanTime > 0 &&
      now - fileCache.lastScanTime < CACHE_TIMEOUT &&
      fileCache.filesByPattern.has(cacheKey)
    ) {
      const cachedFiles = fileCache.filesByPattern.get(cacheKey) || [];
      console.log(
        `Using cached files (${cachedFiles.length}) for pattern: ${includePattern}`
      );
      return cachedFiles.slice(0, maxFiles);
    }
  }

  // Build exclude pattern - always exclude node_modules
  const excludePatterns = ["**/node_modules/**", ...additionalExcludePatterns];
  const excludePattern = `{${excludePatterns.join(",")}}`;

  // Use progress indicator if requested
  if (showProgress) {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Scanning workspace files",
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          console.log("File scanning cancelled by user");
        });

        return await scanWorkspace(progress, token);
      }
    );
  } else {
    return await scanWorkspace();
  }

  /**
   * Core scanning function that processes each workspace folder
   */
  async function scanWorkspace(
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken
  ): Promise<string[]> {
    // Create a Set to track processed files and prevent duplicates
    const processedFiles = new Set<string>();
    const filePaths: string[] = [];
    const cacheKey = `${includePattern}:${additionalExcludePatterns.join(",")}`;

    // Process each workspace folder
    for (const folder of workspaceFolders!) {
      if (token?.isCancellationRequested) {
        break;
      }

      try {
        // Report progress if available
        if (progress) {
          progress.report({
            message: `Scanning ${folder.name}...`,
          });
        }

        // Find all files matching the include pattern and excluding node_modules
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, includePattern),
          excludePattern
        );

        // Process files up to the maximum limit
        let processedCount = 0;
        for (const file of files) {
          if (token?.isCancellationRequested) {
            break;
          }

          const filePath = file.fsPath;

          // Skip if already processed (prevents duplicates)
          if (processedFiles.has(filePath)) {
            continue;
          }

          // Add to processed set and result array
          processedFiles.add(filePath);
          filePaths.push(filePath);
          processedCount++;

          // Report progress periodically
          if (progress && processedCount % 100 === 0) {
            progress.report({
              message: `Found ${filePaths.length} files...`,
            });
          }

          // Stop if we've reached the maximum file limit
          if (filePaths.length >= maxFiles) {
            console.log(
              `Reached maximum file limit (${maxFiles}). Stopping scan.`
            );
            break;
          }
        }

        // Report final count for this folder
        if (progress) {
          progress.report({
            message: `Found ${processedCount} files in ${folder.name}`,
          });
        }

        // Break out of folder loop if we've hit the max files
        if (filePaths.length >= maxFiles) {
          break;
        }
      } catch (error) {
        console.error(
          `Error scanning workspace folder ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    // Update cache if using cache
    if (useCache) {
      fileCache.lastScanTime = Date.now();
      fileCache.filesByPattern.set(cacheKey, [...filePaths]);

      // Update global processed files set
      filePaths.forEach((file) => fileCache.processedFiles.add(file));
    }

    console.log(`Total files found: ${filePaths.length}`);
    return filePaths;
  }
}

/**
 * Clears the file cache to force fresh scans
 */
export function clearFileCache(): void {
  fileCache.clearCache();
  console.log("File cache cleared");
}

/**
 * Gets JavaScript and TypeScript files with optimized patterns
 */
export async function getJavaScriptAndTypeScriptFiles(
  options: {
    maxFiles?: number;
    showProgress?: boolean;
    useCache?: boolean;
    forceRefresh?: boolean;
  } = {}
): Promise<string[]> {
  const {
    maxFiles = 1000,
    showProgress = true,
    useCache = true,
    forceRefresh = false,
  } = options;

  // Use more specific patterns for better performance
  return getAllWorkspaceFiles({
    includePattern: "**/*.{js,jsx,ts,tsx}",
    additionalExcludePatterns: [
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/out/**",
      "**/.next/**",
      "**/tmp/**",
    ],
    maxFiles,
    showProgress,
    useCache,
    forceRefresh,
  });
}

/**
 * Checks if a file should be processed based on its path and extension
 * @param filePath The file path to check
 * @param allowedExtensions Array of allowed file extensions
 */
export function shouldProcessFile(
  filePath: string,
  allowedExtensions: string[] = [".js", ".jsx", ".ts", ".tsx"]
): boolean {
  // Skip files in node_modules
  if (filePath.includes("node_modules")) {
    return false;
  }

  // Check file extension
  const ext = path.extname(filePath).toLowerCase();
  return allowedExtensions.includes(ext);
}

/**
 * Gets all files that match a specific extension
 */
export async function getFilesByExtension(
  extensions: string[],
  options: FileRetrievalOptions = {}
): Promise<string[]> {
  // Convert extensions to lowercase and ensure they have a dot prefix
  const normalizedExtensions = extensions.map((ext) =>
    ext.toLowerCase().startsWith(".")
      ? ext.toLowerCase()
      : `.${ext.toLowerCase()}`
  );

  // Create a pattern that matches all specified extensions
  const extensionPattern =
    normalizedExtensions.length === 1
      ? `**/*${normalizedExtensions[0]}`
      : `**/*.{${normalizedExtensions
          .map((ext) => ext.substring(1))
          .join(",")}}`;

  // Get all files matching the pattern
  const files = await getAllWorkspaceFiles({
    includePattern: extensionPattern,
    ...options,
  });

  // Double-check extensions to ensure pattern matching worked correctly
  return files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return normalizedExtensions.includes(ext);
  });
}

/**
 * Processes files in batches to prevent UI freezing
 */
export async function processFilesInBatches<T>(
  files: string[],
  processor: (filePath: string) => Promise<T>,
  options: {
    batchSize?: number;
    showProgress?: boolean;
    progressTitle?: string;
    onBatchComplete?: (results: T[]) => void;
  } = {}
): Promise<T[]> {
  const {
    batchSize = 20,
    showProgress = true,
    progressTitle = "Processing files",
    onBatchComplete,
  } = options;

  const results: T[] = [];

  if (files.length === 0) {
    return results;
  }

  if (showProgress) {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressTitle,
        cancellable: true,
      },
      async (progress, token) => {
        return processBatches(progress, token);
      }
    );
  } else {
    return processBatches();
  }

  async function processBatches(
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken
  ): Promise<T[]> {
    for (let i = 0; i < files.length; i += batchSize) {
      if (token?.isCancellationRequested) {
        break;
      }

      const batch = files.slice(i, i + batchSize);
      const percentComplete = Math.round((i / files.length) * 100);

      if (progress) {
        progress.report({
          message: `Processing ${i + 1}-${Math.min(
            i + batch.length,
            files.length
          )} of ${files.length} files (${percentComplete}%)`,
          increment: (batch.length / files.length) * 100,
        });
      }

      // Process each file in the batch
      const batchResults = await Promise.all(
        batch.map((filePath) => processor(filePath))
      );

      // Add results to the main results array
      results.push(...batchResults);

      // Call the batch complete callback if provided
      if (onBatchComplete) {
        onBatchComplete(batchResults);
      }
    }

    return results;
  }
}

/**
 * Loads gitignore patterns from workspace
 */
export async function loadGitignorePatterns(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return ["**/node_modules/**"];
  }

  const gitignorePatterns: string[] = [];

  for (const folder of workspaceFolders!) {
    try {
      const gitignorePath = path.join(folder.uri.fsPath, ".gitignore");

      // Check if .gitignore exists
      const gitignoreUri = vscode.Uri.file(gitignorePath);
      try {
        await vscode.workspace.fs.stat(gitignoreUri);
      } catch {
        continue; // .gitignore doesn't exist, skip this folder
      }

      // Read .gitignore content
      const contentBuffer = await vscode.workspace.fs.readFile(gitignoreUri);
      const content = Buffer.from(contentBuffer).toString("utf8");
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

        gitignorePatterns.push(pattern);
      }
    } catch (error) {
      console.error(
        `Error loading .gitignore from ${folder.uri.fsPath}:`,
        error
      );
    }
  }

  // Always add node_modules to the patterns
  if (!gitignorePatterns.includes("**/node_modules/**")) {
    gitignorePatterns.push("**/node_modules/**");
  }

  return gitignorePatterns;
}
