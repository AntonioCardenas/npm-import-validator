/**
 * Utility functions for the NPM Import Validator extension
 */

/**
 * Debounces a function to limit how often it can be called
 * @param func The function to debounce
 * @param wait The time to wait in milliseconds
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>): void => {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Creates a throttled function that only invokes the provided function at most once per specified interval
 * @param func The function to throttle
 * @param limit The time limit in milliseconds
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  let lastFunc: NodeJS.Timeout;
  let lastRan: number;

  return (...args: Parameters<T>): void => {
    if (!inThrottle) {
      func(...args);
      lastRan = Date.now();
      inThrottle = true;

      setTimeout(() => {
        inThrottle = false;
      }, limit);
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(() => {
        if (Date.now() - lastRan >= limit) {
          func(...args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
}

/**
 * Memoizes a function to cache its results
 * @param func The function to memoize
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => ReturnType<T> {
  const cache = new Map<string, ReturnType<T>>();

  return (...args: Parameters<T>): ReturnType<T> => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key) as ReturnType<T>;
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Checks if a value is defined (not null or undefined)
 * @param value The value to check
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Safely parses JSON with error handling
 * @param text The JSON string to parse
 * @param fallback The fallback value if parsing fails
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return fallback;
  }
}

/**
 * Formats a file size in bytes to a human-readable string
 * @param bytes The size in bytes
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return "0 Bytes";
  }

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${
    sizes[i]
  }`;
}

/**
 * Creates a unique ID
 */
export function createUniqueId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Safely reads a file with error handling
 * @param path The file path
 * @param encoding The file encoding
 */
export async function safeReadFile(
  path: string,
  encoding: BufferEncoding = "utf8"
): Promise<string | null> {
  try {
    const fs = await import("fs");
    return fs.readFileSync(path, encoding);
  } catch (error) {
    console.error(`Error reading file ${path}:`, error);
    return null;
  }
}
