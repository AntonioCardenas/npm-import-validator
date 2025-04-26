import * as vscode from "vscode";

/**
 * Constants used throughout the extension
 */

// Extension identifier
export const EXTENSION_ID = "npm-import-validator";

// Command IDs
export const COMMANDS = {
  VALIDATE_IMPORTS: `${EXTENSION_ID}.validateImports`,
  VALIDATE_WORKSPACE: `${EXTENSION_ID}.validateWorkspace`,
  CANCEL_VALIDATION: `${EXTENSION_ID}.cancelValidation`,
  CLEAR_CACHE: `${EXTENSION_ID}.clearCache`,
  SHOW_PACKAGE_INFO: `${EXTENSION_ID}.showPackageInfo`,
  OPEN_NPM_PAGE: `${EXTENSION_ID}.openNpmPage`,
  SHOW_ALL_IMPORTS: `${EXTENSION_ID}.showAllImports`,
  SHOW_STATS: `${EXTENSION_ID}.showStats`,
  FIND_UNUSED_DEPENDENCIES: `${EXTENSION_ID}.findUnusedDependencies`,
  SHOW_ERROR_FILES: `${EXTENSION_ID}.showErrorFiles`,
};

// View IDs
export const VIEWS = {
  IMPORTS: "npmImports",
  STATISTICS: "npmStatistics",
  SETTINGS: "npmSettings",
};

// Storage keys
export const STORAGE_KEYS = {
  PACKAGE_INFO_CACHE: "npmPackageInfoCache",
  STATS: "npmImportValidatorStats",
  SETTINGS: "npmImportValidatorSettings",
};

// Default configuration values
export const DEFAULT_CONFIG = {
  CACHE_TIMEOUT: 86400, // 24 hours in seconds
  MAX_FILES: 1000,
  BATCH_SIZE: 20,
  PROCESSING_TIMEOUT: 10000, // 10 seconds
  FETCH_RETRY_COUNT: 3,
  FETCH_RETRY_DELAY: 1000, // 1 second
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

// Common dev tools that might not be directly imported
export const COMMON_DEV_TOOLS = [
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
