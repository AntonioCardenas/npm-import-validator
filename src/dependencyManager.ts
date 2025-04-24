import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { FileProcessor } from "./fileProcessor";

interface Dependency {
  name: string;
  version: string;
  type:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  used: boolean;
  usageCount: number;
  files: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export class DependencyManager {
  private _packageJsonFiles: Map<string, PackageJson> = new Map();
  private _dependencies: Map<string, Dependency> = new Map();

  constructor(private _fileProcessor: FileProcessor) {}

  /**
   * Find all package.json files in the workspace
   */
  async _findPackageJsonFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const packageJsonFiles: string[] = [];

    for (const folder of workspaceFolders) {
      try {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/package.json"),
          "**/node_modules/**"
        );

        for (const file of files) {
          packageJsonFiles.push(file.fsPath);
        }
      } catch (error) {
        console.error(
          `Error finding package.json files in workspace folder ${folder.uri.fsPath}:`,
          error
        );
      }
    }

    return packageJsonFiles;
  }

  /**
   * Load package.json files
   */
  async _loadPackageJsonFiles(): Promise<void> {
    this._packageJsonFiles.clear();
    this._dependencies.clear();

    const packageJsonFiles = await this._findPackageJsonFiles();

    for (const filePath of packageJsonFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const packageJson = JSON.parse(content) as PackageJson;

        this._packageJsonFiles.set(filePath, packageJson);

        // Process dependencies
        this._processDependencies(packageJson, "dependencies", filePath);
        this._processDependencies(packageJson, "devDependencies", filePath);
        this._processDependencies(packageJson, "peerDependencies", filePath);
        this._processDependencies(
          packageJson,
          "optionalDependencies",
          filePath
        );
      } catch (error) {
        console.error(`Error loading package.json file ${filePath}:`, error);
      }
    }

    console.log(
      `Loaded ${this._packageJsonFiles.size} package.json files with ${this._dependencies.size} dependencies`
    );
  }

  /**
   * Process dependencies from package.json
   */
  private _processDependencies(
    packageJson: PackageJson,
    type:
      | "dependencies"
      | "devDependencies"
      | "peerDependencies"
      | "optionalDependencies",
    filePath: string
  ): void {
    const dependencies = packageJson[type];
    if (!dependencies) {
      return;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (this._dependencies.has(name)) {
        // Update existing dependency
        const dependency = this._dependencies.get(name);
        if (dependency && !dependency.files.includes(filePath)) {
          dependency.files.push(filePath);
        }
      } else {
        // Add new dependency
        this._dependencies.set(name, {
          name,
          version,
          type,
          used: false,
          usageCount: 0,
          files: [filePath],
        });
      }
    }
  }

  /**
   * Analyze dependencies to find unused ones
   */
  async _analyzeDependencies(): Promise<Dependency[]> {
    // Make sure we have loaded package.json files
    if (this._packageJsonFiles.size === 0) {
      await this._loadPackageJsonFiles();
    }

    // Get all imports from all files
    const allImports = this._fileProcessor.getAllImports();

    // Reset usage counts
    for (const dependency of this._dependencies.values()) {
      dependency.used = false;
      dependency.usageCount = 0;
    }

    // Mark dependencies as used if they are imported
    for (const _importName of allImports) {
      if (this._dependencies.has(_importName)) {
        const dependency = this._dependencies.get(_importName);
        if (dependency) {
          dependency.used = true;
          dependency.usageCount++;
        }
      }
    }

    // Get unused dependencies
    const unusedDependencies = Array.from(this._dependencies.values()).filter(
      (dependency) => !dependency.used && dependency.type !== "peerDependencies"
    );

    return unusedDependencies;
  }

  /**
   * Remove a dependency from package.json
   */
  async _removeDependency(dependency: Dependency): Promise<boolean> {
    let success = false;

    for (const filePath of dependency.files) {
      try {
        // Read the package.json file
        const content = fs.readFileSync(filePath, "utf8");
        const packageJson = JSON.parse(content) as PackageJson;

        // Remove the dependency
        if (
          packageJson[dependency.type] &&
          packageJson[dependency.type]?.[dependency.name]
        ) {
          // Use optional chaining instead of non-null assertion
          delete packageJson[dependency.type]?.[dependency.name];

          // Write the updated package.json file
          fs.writeFileSync(
            filePath,
            JSON.stringify(packageJson, null, 2),
            "utf8"
          );

          console.log(`Removed ${dependency.name} from ${filePath}`);
          success = true;
        }
      } catch (error) {
        console.error(
          `Error removing dependency ${dependency.name} from ${filePath}:`,
          error
        );
        vscode.window.showErrorMessage(
          `Error removing dependency ${dependency.name} from ${path.basename(
            filePath
          )}`
        );
      }
    }

    return success;
  }

  /**
   * Show unused dependencies and prompt to remove them
   */
  async showUnusedDependencies(): Promise<void> {
    // Show progress while analyzing
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing dependencies",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Finding package.json files..." });
        await this._loadPackageJsonFiles();

        progress.report({ message: "Analyzing imports..." });
        const unusedDependencies = await this._analyzeDependencies();

        if (unusedDependencies.length === 0) {
          vscode.window.showInformationMessage("No unused dependencies found.");
          return;
        }

        // Create QuickPick items for unused dependencies
        const items = unusedDependencies.map((dependency) => ({
          label: dependency.name,
          description: `${dependency.version} (${dependency.type})`,
          detail: `Found in ${dependency.files.length} package.json file(s)`,
          dependency,
        }));

        // Show QuickPick to select dependencies to remove
        const selectedItems = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: `Found ${unusedDependencies.length} unused dependencies. Select dependencies to remove.`,
        });

        if (!selectedItems || selectedItems.length === 0) {
          return;
        }

        // Confirm removal
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to remove ${selectedItems.length} dependencies?`,
          { modal: true },
          "Yes",
          "No"
        );

        if (confirmed !== "Yes") {
          return;
        }

        // Remove selected dependencies
        let successCount = 0;
        for (const item of selectedItems) {
          const success = await this._removeDependency(item.dependency);
          if (success) {
            successCount++;
          }
        }

        vscode.window.showInformationMessage(
          `Successfully removed ${successCount} of ${selectedItems.length} dependencies.`
        );

        // Refresh dependencies
        await this._loadPackageJsonFiles();
      }
    );
  }
}
