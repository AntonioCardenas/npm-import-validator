import * as vscode from "vscode";

/**
 * Constants used throughout the extension
 */

// Extension identifier
export const EXTENSION_ID = "npm-import-validator";

// Command IDs
export const COMMANDS = {
  validateImports: `${EXTENSION_ID}.validateImports`,
  validateWorkspace: `${EXTENSION_ID}.validateWorkspace`,
  cancelValidation: `${EXTENSION_ID}.cancelValidation`,
  clearCache: `${EXTENSION_ID}.clearCache`,
  showPackageInfo: `${EXTENSION_ID}.showPackageInfo`,
  openNpmPage: `${EXTENSION_ID}.openNpmPage`,
  showAllImports: `${EXTENSION_ID}.showAllImports`,
  showStats: `${EXTENSION_ID}.showStats`,
  findUnusedDependencies: `${EXTENSION_ID}.findUnusedDependencies`,
  showErrorFiles: `${EXTENSION_ID}.showErrorFiles`,
  scanWorkspaceFiles: "extension.scanWorkspaceFiles",
  processBatchedFiles: "extension.processBatchedFiles",
  analyzeWorkspace: "extension.analyzeWorkspace",
  clearWorkspaceCache: "extension.clearWorkspaceCache",
};

// View IDs
export const VIEWS = {
  imports: "npmImports",
  statistics: "npmStatistics",
  settings: "npmSettings",
};

// Storage keys
export const STORAGE_KEYS = {
  packageInfoCache: "npmPackageInfoCache",
  stats: "npmImportValidatorStats",
  settings: "npmImportValidatorSettings",
};

// Default configuration values
export const DEFAULT_CONFIG = {
  cacheTimeout: 86400, // 24 hours in seconds
  maxFiles: 1000,
  batchSize: 20,
  processingTimeout: 10000, // 10 seconds
  fetchRetryCount: 3,
  fetchRetryDelay: 1000, // 1 second
};

// File types that can be processed
export const VALID_FILE_TYPES = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];

// Common framework packages
export const COMMON_FRAMEWORKS = [
  // React ecosystem
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "react-query",
  "react-hook-form",
  "react-redux",
  "redux",
  "redux-toolkit",
  "@reduxjs/toolkit",
  "recoil",
  "jotai",
  "zustand",
  "formik",
  "react-select",
  "react-table",
  "react-spring",
  "framer-motion",

  // Next.js ecosystem
  "next",
  "next-auth",
  "next-i18next",
  "next-seo",
  "next-themes",

  // UI libraries
  "@mui/material",
  "@mui/icons-material",
  "@emotion/react",
  "@emotion/styled",
  "styled-components",
  "tailwindcss",
  "twin.macro",
  "antd",
  "chakra-ui",
  "@chakra-ui/react",
  "@mantine/core",
  "bootstrap",
  "reactstrap",

  // Data fetching
  "swr",
  "axios",
  "graphql",
  "apollo-client",
  "@apollo/client",
  "urql",

  // Node.js frameworks
  "express",
  "koa",
  "fastify",
  "nest",
  "@nestjs/core",
  "hapi",
  "restify",

  // Database
  "prisma",
  "@prisma/client",
  "mongoose",
  "sequelize",
  "typeorm",
  "knex",
  "drizzle-orm",

  // Testing
  "jest",
  "@testing-library/react",
  "@testing-library/jest-dom",
  "cypress",
  "playwright",

  // Build tools
  "webpack",
  "rollup",
  "vite",
  "esbuild",
  "parcel",

  // Utilities
  "lodash",
  "date-fns",
  "dayjs",
  "zod",
  "yup",
  "uuid",
  "nanoid",
];

// Common path aliases
export const COMMON_PATH_ALIASES = [
  "~",
  "src/",
  "components/",
  "pages/",
  "utils/",
  "hooks/",
  "lib/",
  "assets/",
  "styles/",
  "config/",
  "constants/",
];

// Framework prefixes
export const FRAMEWORK_PREFIXES = ["react-", "next-", "@react/", "@next/"];

/**
 * Gets the configuration for the extension
 */
export function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(EXTENSION_ID);
}

/**
 * Gets a configuration value with a default fallback
 * @param key The configuration key
 * @param defaultValue The default value
 */
export function getConfigValue<T>(key: string, defaultValue: T): T {
  return getConfiguration().get<T>(key) ?? defaultValue;
}
