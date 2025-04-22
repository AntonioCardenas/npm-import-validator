# NPM Import Validator

A VS Code extension that validates imported packages against the npm registry.

## Features

- **Import Validation**: Verifies if packages exist on the npm registry
- **Package Information**: Shows version and description for valid packages
- **Code Lens**: Displays package versions directly above import statements
- **Tree View**: Browse all imports in your current file and workspace
- **Performance Optimized**: Efficiently handles large projects with parallel processing
- **Support for CommonJS**: Validates both ES6 imports and CommonJS require statements

![Feature Overview](https://raw.githubusercontent.com/antoniocardenas/npm-import-validator/main/resources/vscode-icon.png)

## Usage

The extension automatically validates imports when you open or save a JavaScript or TypeScript file. Invalid imports (packages not found on npm registry) are highlighted with squiggly underlines.

By clicking on Workspace > Scan Workspace, you can easily see if the imported packages exist in npm.

### Commands

- **Validate NPM Imports**: Manually trigger validation for the current file
- **Validate NPM Imports in Workspace**: Scan all files in the workspace for npm imports
- **Cancel NPM Import Validation**: Stop an ongoing workspace validation
- **Clear NPM Import Validator Cache**: Clear the cached validation results
- **Show NPM Package Info**: View detailed information about a package
- **Open NPM Package Page**: Open the npm registry page for a package
- **Show NPM Import Validator Statistics**: View detailed validation statistics

### Code Lens

The extension adds code lens above import statements showing:

- Package version for valid imports
- "Not found on npm registry" for invalid imports

### Status Bar

The extension adds a status bar item that shows the current validation status:

- 🔄 Validating NPM Imports...
- ✅ NPM Imports Valid
- ⚠️ X Invalid NPM Imports
- ❌ NPM Import Error

Click on the status bar item to manually trigger validation.

### NPM Imports View

The extension adds a view to the activity bar where you can browse:

- Imports in the current file
- Valid and invalid imports
- Workspace import statistics
- Import types (ES6 vs CommonJS)

## Extension Settings

This extension contributes the following settings:

- `npmImportValidator.validateOnSave`: Validate imports when a file is saved
- `npmImportValidator.validateOnOpen`: Validate imports when a file is opened
- `npmImportValidator.ignoredPackages`: List of packages to ignore during validation
- `npmImportValidator.severityLevel`: Severity level for invalid imports (error, warning, info)
- `npmImportValidator.cacheTimeout`: Time in seconds to cache npm registry data (default: 24 hours)
- `npmImportValidator.maxFilesToProcess`: Maximum number of files to process in workspace scan
- `npmImportValidator.processingBatchSize`: Number of files to process in parallel during workspace scan
- `npmImportValidator.excludePatterns`: Glob patterns for files to exclude from validation
- `npmImportValidator.excludeReactNextjs`: Exclude React, Next.js, and their associated folders
- `npmImportValidator.pathAliases`: Path aliases used in your project to identify local imports

## Performance Considerations

The extension is designed to handle large projects efficiently:

- **Parallel Processing**: Files are processed in parallel batches
- **Caching**: Import validation results are cached to prevent duplicate checks
- **File Limits**: You can configure the maximum number of files to process
- **Exclusion Patterns**: Exclude specific files or directories from validation
- **Buffering**: Prevents duplicate checks of the same import statements

## Requirements

- VS Code 1.80.0 or higher
- Node.js 14 or higher
- Internet connection to access npm registry

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "NPM Import Validator"
4. Click Install

## Known Issues

- The extension may not detect all types of dynamic imports
- Performance may be affected when validating very large projects
- npm registry API rate limits may affect validation of many packages

## Release Notes

### 1.0.0

- Initial release
- Import validation against npm registry
- Package information view
- Code lens for import statements
- Tree view for browsing imports

### 1.0.1

- Support for CommonJS require statements
- Performance optimizations for large projects
- Configurable file processing limits
- Detailed statistics view
- Added Vscode Icon

### 1.1.1

- Added framework import detection for popular frameworks like React, Angular, and Vue
- Introduced configurable severity levels for framework-specific import issues
- Improved diagnostics handling for framework packages, including better error messages and suggestions
- Enhanced performance for projects using framework-specific folder structures
- Updated settings to include `npmImportValidator.frameworkDetection` for enabling/disabling framework import detection
- Bug fixes and minor improvements

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the MIT License.
