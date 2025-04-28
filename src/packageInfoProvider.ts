import * as vscode from "vscode";
import fetch from "node-fetch";
import * as fs from "fs";

import {
  DEFAULT_CONFIG,
  STORAGE_KEYS,
  getConfigValue,
} from "./utils/constants";
import { safeJsonParse, retry } from "./utils/common";

import type { PackageInfo } from "./types";

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

/**
 * Provides information about npm packages
 */
export class PackageInfoProvider {
  private packageInfoCache: Map<
    string,
    { info: PackageInfo | null; timestamp: number }
  > = new Map();
  private projectPackages: Map<string, string> = new Map(); // Map of package name to version
  private readonly fetchRetryCount: number;
  private readonly fetchRetryDelay: number;
  private packageJsonWatcher: vscode.FileSystemWatcher | null = null;

  /**
   * Creates a new instance of the PackageInfoProvider
   * @param storage The storage to use for caching
   */
  constructor(private storage: vscode.Memento) {
    // Initialize retry settings from DEFAULT_CONFIG
    this.fetchRetryCount = DEFAULT_CONFIG.fetchRetryCount;
    this.fetchRetryDelay = DEFAULT_CONFIG.fetchRetryDelay;

    // Load cache from storage
    const cachedData = this.storage.get<{
      [key: string]: { info: PackageInfo | null; timestamp: number };
    }>(STORAGE_KEYS.packageInfoCache);

    if (cachedData) {
      this.packageInfoCache = new Map(Object.entries(cachedData));
    }

    // Load project packages
    this.loadProjectPackages();

    // Watch for changes to package.json files
    this.watchPackageJsonFiles();
  }

  /**
   * Watch for changes to package.json files
   */
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

  /**
   * Load packages from all package.json files in the workspace
   */
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
            const packageJson = safeJsonParse(
              fileContent,
              {} as ProjectPackage
            );

            // Add dependencies to the map
            this.addDependenciesToMap(packageJson.dependencies);
            this.addDependenciesToMap(packageJson.devDependencies);
            this.addDependenciesToMap(packageJson.peerDependencies);
            this.addDependenciesToMap(packageJson.optionalDependencies);

            console.info(
              `Loaded ${this.projectPackages.size} packages from ${fileUri.fsPath}`
            );
          } catch (error) {
            console.error(
              `Error loading package.json from ${fileUri.fsPath}:`,
              error
            );
          }
        });
      })
      .then(undefined, (error: Error) => {
        console.error("Error finding package.json files:", error);
      });
  }

  /**
   * Add dependencies to the map
   * @param dependencies The dependencies to add
   */
  private addDependenciesToMap(dependencies?: Record<string, string>): void {
    if (!dependencies) {
      return;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      this.projectPackages.set(name, version);
    }
  }

  /**
   * Check if a package is installed in the project
   * @param packageName The package name to check
   */
  public isPackageInProject(packageName: string): boolean {
    return this.projectPackages.has(packageName);
  }

  /**
   * Get the installed version of a package
   * @param packageName The package name to get the version for
   */
  public getInstalledVersion(packageName: string): string | undefined {
    return this.projectPackages.get(packageName);
  }

  /**
   * Get package info from npm registry with retry logic
   * @param packageName The package name to get info for
   */
  public async getPackageInfo(
    packageName: string
  ): Promise<PackageInfo | null> {
    const cacheTimeout = getConfigValue(
      "cacheTimeout",
      DEFAULT_CONFIG.cacheTimeout
    );
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
      console.info(
        `Package ${packageName} found in project with version ${installedVersion}`
      );

      // Try to get more info from npm, but don't fail if we can't
      try {
        const npmInfo = await this.fetchPackageInfoFromNpm(packageName);
        if (npmInfo) {
          return npmInfo;
        }
      } catch (error) {
        console.info(
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

  /**
   * Fetch package info from npm registry with retry logic
   * @param packageName The package name to fetch info for
   */
  private async fetchPackageInfoFromNpm(
    packageName: string
  ): Promise<PackageInfo | null> {
    try {
      return await retry(
        async () => {
          // Use a timeout for the fetch request
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

          try {
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
          } finally {
            clearTimeout(timeoutId);
          }
        },
        {
          maxRetries: this.fetchRetryCount,
          initialDelay: this.fetchRetryDelay,
          backoffFactor: 2,
          retryCondition: (error) => {
            // Retry on network errors or timeouts
            return (
              error instanceof Error &&
              (error.name === "AbortError" ||
                error.message.includes("network") ||
                error.message.includes("timeout"))
            );
          },
        }
      );
    } catch (error) {
      console.error(`All retry attempts failed for ${packageName}:`, error);
      return null;
    }
  }

  /**
   * Save cache to storage
   */
  private saveCache(): void {
    const cacheObject = Object.fromEntries(this.packageInfoCache);
    this.storage.update(STORAGE_KEYS.packageInfoCache, cacheObject);
  }

  /**
   * Clear cache
   */
  public clearCache(): void {
    this.packageInfoCache.clear();
    this.storage.update(STORAGE_KEYS.packageInfoCache, {});
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.packageJsonWatcher) {
      this.packageJsonWatcher.dispose();
    }
  }
}
