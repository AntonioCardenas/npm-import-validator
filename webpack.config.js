// @ts-check
const path = require("path")
const webpack = require("webpack")

/**
 * @type {import('webpack').Configuration}
 * A single webpack configuration for both development and production
 */
module.exports = (env, argv) => {
  // Determine if we're in production mode
  const isProduction = argv.mode === "production" || process.env.NODE_ENV === "production"

  console.log(`Building in ${isProduction ? "production" : "development"} mode`)

  return {
    // Set the appropriate mode
    mode: isProduction ? "production" : "development",

    // The entry point of your extension
    entry: "./src/extension.ts",

    // Target Node.js environment
    target: "node",

    // Output configuration
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "extension.js",
      libraryTarget: "commonjs2",
      devtoolModuleFilenameTemplate: "../[resource-path]",
      clean: true, // Clean the output directory before emit
    },

    // Enable source maps for debugging
    devtool: isProduction ? "source-map" : "eval-source-map",

    // External modules (don't bundle these)
    externals: {
      vscode: "commonjs vscode", // VS Code API
    },

    // Resolve TypeScript and JavaScript files
    resolve: {
      extensions: [".ts", ".js"],
      // Add fallbacks for node modules
      fallback: {
        path: false,
        fs: false,
        os: false,
      },
    },

    // Module rules for processing files
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  // Override sourceMap based on mode
                  sourceMap: !isProduction,
                },
              },
            },
          ],
        },
      ],
    },

    // Plugins
    plugins: [
      // Define environment variables
      new webpack.DefinePlugin({
        "process.env.NODE_ENV": JSON.stringify(isProduction ? "production" : "development"),
      }),
      // Add progress indicator
      new webpack.ProgressPlugin(),
    ],

    // Optimization
    optimization: {
      minimize: isProduction,
    },

    // Performance hints
    performance: {
      hints: false, // Disable performance hints for extensions
    },

    // Stats configuration
    stats: {
      assets: true,
      colors: true,
      errors: true,
      errorDetails: true,
      modules: false,
      performance: true,
      hash: false,
      version: false,
      timings: true,
      warnings: true,
    },

    // Infrastructure logging
    infrastructureLogging: {
      level: "info",
    },
  }
}
