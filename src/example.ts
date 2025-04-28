import * as vscode from "vscode";
import {
  getJavaScriptAndTypeScriptFiles,
  getAllWorkspaceFiles,
  processFilesInBatches,
} from "./utils/file-utils";
import { createWorkspaceScanner } from "./utils/workspace-scanner";

/**
 * Example command that demonstrates how to use the file retrieval utilities
 */
export async function scanWorkspaceFiles(): Promise<void> {
  try {
    // Show a progress notification
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Scanning workspace files",
        cancellable: true,
      },
      async (progress, token) => {
        // Get all JavaScript and TypeScript files
        const jsAndTsFiles = await getJavaScriptAndTypeScriptFiles({
          maxFiles: 1000,
          showProgress: false,
        });

        // Display results
        if (jsAndTsFiles.length > 0) {
          vscode.window.showInformationMessage(
            `Found ${jsAndTsFiles.length} JavaScript/TypeScript files`
          );

          // Example: Show the first 5 files in the output channel
          const outputChannel =
            vscode.window.createOutputChannel("Workspace Scanner");
          outputChannel.clear();
          outputChannel.appendLine(
            `Found ${jsAndTsFiles.length} JavaScript/TypeScript files:`
          );
          jsAndTsFiles.slice(0, 5).forEach((file) => {
            outputChannel.appendLine(`- ${file}`);
          });
          outputChannel.appendLine("...");
          outputChannel.show();
        } else {
          vscode.window.showInformationMessage(
            "No JavaScript/TypeScript files found in workspace"
          );
        }

        // Example of getting all files with custom patterns
        const allFiles = await getAllWorkspaceFiles({
          includePattern: "**/*.*",
          additionalExcludePatterns: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
          ],
          maxFiles: 5000,
          showProgress: false,
        });

        console.log(`Total files in workspace: ${allFiles.length}`);
        return allFiles;
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error scanning workspace: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Example of processing files in batches to prevent UI freezing
 */
export async function processBatchedFiles(): Promise<void> {
  try {
    const files = await getJavaScriptAndTypeScriptFiles({
      maxFiles: 1000,
      showProgress: true,
    });

    // Process files in batches
    const results = await processFilesInBatches(
      files,
      async (filePath) => {
        // Example processing - just return the file path
        return {
          path: filePath,
          size: await getFileSize(filePath),
        };
      },
      {
        batchSize: 20,
        showProgress: true,
        progressTitle: "Processing JavaScript/TypeScript files",
        onBatchComplete: (batchResults) => {
          console.log(`Completed batch of ${batchResults.length} files`);
        },
      }
    );

    vscode.window.showInformationMessage(`Processed ${results.length} files`);

    // Show the largest files
    const sortedBySize = [...results].sort((a, b) => b.size - a.size);
    const outputChannel = vscode.window.createOutputChannel(
      "File Processing Results"
    );
    outputChannel.clear();
    outputChannel.appendLine("Largest files in workspace:");
    sortedBySize.slice(0, 10).forEach((file, index) => {
      outputChannel.appendLine(
        `${index + 1}. ${file.path} (${formatFileSize(file.size)})`
      );
    });
    outputChannel.show();
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error processing files: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Example of using the workspace scanner
 */
export async function analyzeWorkspace(): Promise<void> {
  try {
    // Create a workspace scanner
    const scanner = createWorkspaceScanner({
      includePatterns: ["**/*.*"],
      excludePatterns: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      maxFiles: 5000,
      showProgress: true,
    });

    // Scan the workspace
    const scanResult = await scanner.scanWorkspace({
      fileTypes: ["js", "ts", "jsx", "tsx", "json", "md"],
    });

    // Show results
    vscode.window.showInformationMessage(
      `Scanned ${scanResult.totalFiles} files in ${Math.round(
        scanResult.processingTime
      )}ms`
    );

    // Get file stats by type
    const fileStats = scanner.getFileStatsByType();

    // Show file stats
    const outputChannel =
      vscode.window.createOutputChannel("Workspace Analysis");
    outputChannel.clear();
    outputChannel.appendLine("File types in workspace:");

    // Sort by count (descending)
    const sortedStats = [...fileStats.entries()].sort((a, b) => b[1] - a[1]);

    sortedStats.forEach(([ext, count]) => {
      outputChannel.appendLine(`${ext}: ${count} files`);
    });

    outputChannel.show();

    // Example of processing specific file types
    const mdResults = await scanner.processFilesByType(
      "md",
      async (filePath) => {
        // Example: Count lines in markdown files
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.file(filePath)
        );
        const text = Buffer.from(content).toString("utf8");
        const lines = text.split("\n").length;

        return {
          path: filePath,
          lines,
        };
      },
      {
        progressTitle: "Analyzing Markdown files",
      }
    );

    // Show markdown analysis results
    if (mdResults.length > 0) {
      const totalLines = mdResults.reduce((sum, file) => sum + file.lines, 0);
      const avgLines = Math.round(totalLines / mdResults.length);

      outputChannel.appendLine("\nMarkdown Analysis:");
      outputChannel.appendLine(`Total files: ${mdResults.length}`);
      outputChannel.appendLine(`Total lines: ${totalLines}`);
      outputChannel.appendLine(`Average lines per file: ${avgLines}`);

      // Show largest markdown files
      const sortedByLines = [...mdResults].sort((a, b) => b.lines - a.lines);

      outputChannel.appendLine("\nLargest Markdown files:");
      sortedByLines.slice(0, 5).forEach((file, index) => {
        outputChannel.appendLine(
          `${index + 1}. ${file.path} (${file.lines} lines)`
        );
      });
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error analyzing workspace: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Gets the size of a file
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return stat.size;
  } catch (error) {
    console.error(`Error getting file size for ${filePath}:`, error);
    return 0;
  }
}

/**
 * Formats a file size in bytes to a human-readable string
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
