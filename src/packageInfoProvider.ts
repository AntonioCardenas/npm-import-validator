import * as vscode from "vscode"
import fetch from "node-fetch"
import type { PackageInfo } from "./importValidator"

interface NpmPackageData {
  name: string
  version: string
  description: string
  homepage?: string
  repository?: {
    url?: string
  }
  license?: string
  author?: string | { name?: string }
  keywords?: string[]
  "dist-tags"?: {
    latest: string
  }
}

interface NpmDownloadsData {
  downloads: number
}

export class PackageInfoProvider {
  private packageInfoCache: Map<string, { info: PackageInfo | null; timestamp: number }> = new Map()

  constructor(private storage: vscode.Memento) {
    // Load cache from storage
    const cachedData = this.storage.get<{ [key: string]: { info: PackageInfo | null; timestamp: number } }>(
      "npmPackageInfoCache",
    )
    if (cachedData) {
      this.packageInfoCache = new Map(Object.entries(cachedData))
    }
  }

  // Get package info from npm registry
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    const cacheTimeout = vscode.workspace.getConfiguration("npmImportInspector").get("cacheTimeout") as number
    const now = Date.now()

    // Check cache first
    if (this.packageInfoCache.has(packageName)) {
      const cached = this.packageInfoCache.get(packageName)!
      if (now - cached.timestamp < cacheTimeout * 1000) {
        return cached.info
      }
    }

    try {
      const response = await fetch(`https://registry.npmjs.org/${packageName}`)

      if (response.status === 404) {
        // Package not found
        this.packageInfoCache.set(packageName, { info: null, timestamp: now })
        this.saveCache()
        return null
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch package info: ${response.statusText}`)
      }

      const data = (await response.json()) as NpmPackageData

      // Get download count
      let downloads = 0
      try {
        const downloadsResponse = await fetch(`https://api.npmjs.org/downloads/point/last-month/${packageName}`)
        if (downloadsResponse.ok) {
          const downloadsData = (await downloadsResponse.json()) as NpmDownloadsData
          downloads = downloadsData.downloads
        }
      } catch (error) {
        console.error(`Error fetching download count for ${packageName}:`, error)
      }

      // Extract author name
      let author = ""
      if (data.author) {
        if (typeof data.author === "string") {
          author = data.author
        } else if (data.author.name) {
          author = data.author.name
        }
      }

      const packageInfo: PackageInfo = {
        name: data.name,
        version: data["dist-tags"]?.latest || data.version,
        description: data.description || "",
        homepage: data.homepage || "",
        repository: data.repository?.url || "",
        license: data.license || "Unknown",
        author,
        keywords: data.keywords || [],
        downloads,
      }

      // Cache the result
      this.packageInfoCache.set(packageName, { info: packageInfo, timestamp: now })
      this.saveCache()

      return packageInfo
    } catch (error) {
      console.error(`Error fetching package info for ${packageName}:`, error)
      return null
    }
  }

  // Save cache to storage
  private saveCache(): void {
    const cacheObject = Object.fromEntries(this.packageInfoCache)
    this.storage.update("npmPackageInfoCache", cacheObject)
  }

  // Clear cache
  clearCache(): void {
    this.packageInfoCache.clear()
    this.storage.update("npmPackageInfoCache", {})
  }
}
