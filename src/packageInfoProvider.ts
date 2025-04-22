import * as vscode from "vscode";
import fetch from "node-fetch";
import type { PackageInfo } from "./importValidator";
import * as fs from "fs";

interface NpmPackageData {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: {
    url?: string;
  };
  license?: string;
  author?: string | { name?: string };
  keywords?: string[];
  distTags?: {
    latest: string;
  };
}

interface NpmDownloadsData {
  downloads: number;
}

interface ProjectPackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export class PackageInfoProvider {
  private packageInfoCache: Map<
    string,
    { info: PackageInfo | null; timestamp: number }
  > = new Map();
  private projectPackages: Map<string, string> = new Map(); // Map of package name to version
  private fetchRetryCount = 3;
  private fetchRetryDelay = 1000; // ms
  private packageJsonWatcher: vscode.FileSystemWatcher | null = null;

  constructor(private storage: vscode.Memento) {
    // Load cache from storage
    const cachedData = this.storage.get<{
      [key: string]: { info: PackageInfo | null; timestamp: number };
    }>("npmPackageInfoCache");
    if (cachedData) {
      this.packageInfoCache = new Map(Object.entries(cachedData));
    }

    // Load project packages
    this.loadProjectPackages();

    // Watch for changes to package.json files
    this.watchPackageJsonFiles();
  }

  // Watch for changes to package.json files
  private watchPackageJsonFiles(): void {
    if (this.packageJsonWatcher) {
      this.packageJsonWatcher.dispose();
    }

    this.packageJsonWatcher =
      vscode.workspace.createFileSystemWatcher("**/package.json");

    this.packageJsonWatcher.onDidChange(() => {
      this.loadProjectPackages();
    });

    this.packageJsonWatcher.onDidCreate(() => {
      this.loadProjectPackages();
    });

    this.packageJsonWatcher.onDidDelete(() => {
      this.loadProjectPackages();
    });
  }

  // Load packages from all package.json files in the workspace
  private loadProjectPackages(): void {
    this.projectPackages.clear();

    if (!vscode.workspace.workspaceFolders) {
      return;
    }

    // Find all package.json files in the workspace
    vscode.workspace
      .findFiles("**/package.json", "**/node_modules/**")
      .then((packageJsonFiles) => {
        // Process each package.json file
        packageJsonFiles.forEach((fileUri) => {
          try {
            const fileContent = fs.readFileSync(fileUri.fsPath, "utf8");
            const packageJson = JSON.parse(fileContent) as ProjectPackage;

            // Add dependencies to the map
            this.addDependenciesToMap(packageJson.dependencies);
            this.addDependenciesToMap(packageJson.devDependencies);
            this.addDependenciesToMap(packageJson.peerDependencies);
            this.addDependenciesToMap(packageJson.optionalDependencies);

            console.log(
              `Loaded ${this.projectPackages.size} packages from ${fileUri.fsPath}`
            );
          } catch (error) {
            console.error(
              `Error loading package.json from ${fileUri.fsPath}:`,
              error
            );
          }
        });
      });
  }

  // Add dependencies to the map
  private addDependenciesToMap(dependencies?: Record<string, string>): void {
    if (!dependencies) {
      return;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      this.projectPackages.set(name, version);
    }
  }

  // Check if a package is installed in the project
  isPackageInProject(packageName: string): boolean {
    return this.projectPackages.has(packageName);
  }

  // Get the installed version of a package
  getInstalledVersion(packageName: string): string | undefined {
    return this.projectPackages.get(packageName);
  }

  // Get package info from npm registry with retry logic
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    const cacheTimeout =
      (vscode.workspace
        .getConfiguration("npmImportValidator")
        .get("cacheTimeout") as number) || 86400;
    const now = Date.now();

    // Check cache first
    if (this.packageInfoCache.has(packageName)) {
      const cached = this.packageInfoCache.get(packageName)!;
      if (now - cached.timestamp < cacheTimeout * 1000) {
        return cached.info;
      }
    }

    // Check if package is in project first
    const isInProject = this.isPackageInProject(packageName);
    const installedVersion = this.getInstalledVersion(packageName);

    // If the package is in the project, we can assume it exists on npm
    if (isInProject && installedVersion) {
      console.log(
        `Package ${packageName} found in project with version ${installedVersion}`
      );

      // Try to get more info from npm, but don't fail if we can't
      try {
        const npmInfo = await this.fetchPackageInfoFromNpm(packageName);
        if (npmInfo) {
          return npmInfo;
        }
      } catch (error) {
        console.log(
          `Couldn't fetch npm info for ${packageName}, using project info instead`
        );
      }

      // Create a minimal package info from project data
      const minimalInfo: PackageInfo = {
        name: packageName,
        version: installedVersion,
        description: "Package found in project dependencies",
        homepage: "",
        repository: "",
        license: "Unknown",
        author: "",
        keywords: [],
        downloads: 0,
        isInProject: true,
      };

      // Cache the result
      this.packageInfoCache.set(packageName, {
        info: minimalInfo,
        timestamp: now,
      });
      this.saveCache();

      return minimalInfo;
    }

    // If not in project, fetch from npm
    try {
      const packageInfo = await this.fetchPackageInfoFromNpm(packageName);

      // Cache the result
      this.packageInfoCache.set(packageName, {
        info: packageInfo,
        timestamp: now,
      });
      this.saveCache();

      return packageInfo;
    } catch (error) {
      console.error(`Error fetching package info for ${packageName}:`, error);

      // Cache the negative result to avoid repeated failed requests
      this.packageInfoCache.set(packageName, { info: null, timestamp: now });
      this.saveCache();

      return null;
    }
  }

  // Fetch package info from npm registry with retry logic
  private async fetchPackageInfoFromNpm(
    packageName: string
  ): Promise<PackageInfo | null> {
    let lastError: Error | null = null;

    // Implement retry logic
    for (let attempt = 1; attempt <= this.fetchRetryCount; attempt++) {
      try {
        // Use a timeout for the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(
          `https://registry.npmjs.org/${packageName}`,
          {
            signal: controller.signal,
            headers: {
              accept: "application/json",
              ["User-Agent"]: "npm-import-validator-vscode-extension",
            },
          }
        );

        clearTimeout(timeoutId);

        if (response.status === 404) {
          // Package not found
          return null;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to fetch package info: ${response.statusText} (${response.status})`
          );
        }

        const data = (await response.json()) as NpmPackageData;

        // Get download count with separate try/catch to avoid failing the whole request
        let downloads = 0;
        try {
          const downloadsResponse = await fetch(
            `https://api.npmjs.org/downloads/point/last-month/${packageName}`,
            {
              headers: {
                Accept: "application/json",
                "User-Agent": "npm-import-validator-vscode-extension",
              },
            }
          );

          if (downloadsResponse.ok) {
            const downloadsData =
              (await downloadsResponse.json()) as NpmDownloadsData;
            downloads = downloadsData.downloads;
          }
        } catch (downloadError) {
          console.error(
            `Error fetching download count for ${packageName}:`,
            downloadError
          );
          // Continue without download count
        }

        // Extract author name
        let author = "";
        if (data.author) {
          if (typeof data.author === "string") {
            author = data.author;
          } else if (data.author.name) {
            author = data.author.name;
          }
        }

        const packageInfo: PackageInfo = {
          name: data.name,
          version: data.distTags?.latest || data.version,
          description: data.description || "",
          homepage: data.homepage || "",
          repository: data.repository?.url || "",
          license: data.license || "Unknown",
          author,
          keywords: data.keywords || [],
          downloads,
          isInProject: this.isPackageInProject(packageName),
        };

        return packageInfo;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If it's an abort error (timeout), log it specifically
        if (error instanceof Error && error.name === "AbortError") {
          console.error(
            `Timeout fetching package info for ${packageName} (attempt ${attempt}/${this.fetchRetryCount})`
          );
        } else {
          console.error(
            `Error fetching package info for ${packageName} (attempt ${attempt}/${this.fetchRetryCount}):`,
            error
          );
        }

        // If we have more attempts, wait before retrying
        if (attempt < this.fetchRetryCount) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.fetchRetryDelay * attempt)
          ); // Exponential backoff
        }
      }
    }

    // If we get here, all attempts failed
    throw (
      lastError ||
      new Error(
        `Failed to fetch package info for ${packageName} after ${this.fetchRetryCount} attempts`
      )
    );
  }

  // Save cache to storage
  private saveCache(): void {
    const cacheObject = Object.fromEntries(this.packageInfoCache);
    this.storage.update("npmPackageInfoCache", cacheObject);
  }

  // Clear cache
  clearCache(): void {
    this.packageInfoCache.clear();
    this.storage.update("npmPackageInfoCache", {});
  }

  // Dispose resources
  dispose(): void {
    if (this.packageJsonWatcher) {
      this.packageJsonWatcher.dispose();
    }
  }
}
