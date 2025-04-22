# NPM Import Validator

A VS Code extension that validates imported packages against the npm registry go if you are doing vibe coding because something the AI's hallucinate and import non-existent npm packages.

## Features

- **Import Validation**: Verifies if packages exist on the npm registry
- **Package Information**: Shows version and description for valid packages
- **Code Lens**: Displays package versions directly above import statements
- **Tree View**: Browse all imports in your current file and workspace


## Usage

The extension automatically validates imports when you open or save a JavaScript or TypeScript file. Invalid imports (packages not found on npm registry) are highlighted with squiggly underlines.

### Commands

- **Validate NPM Imports**: Manually trigger validation for the current file
- **Show NPM Package Info**: View detailed information about a package (place cursor on the import first)
- **Open NPM Package Page**: Open the npm registry page for a package

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

## Extension Settings

This extension contributes the following settings:

- `npmImportValidator.validateOnSave`: Validate imports when a file is saved
- `npmImportValidator.validateOnOpen`: Validate imports when a file is opened
- `npmImportValidator.ignoredPackages`: List of packages to ignore during validation
- `npmImportValidator.severityLevel`: Severity level for invalid imports (error, warning, info)
- `npmImportValidator.cacheTimeout`: Time in seconds to cache npm registry data (default: 24 hours)

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

- The extension may not detect all types of imports (e.g., dynamic imports, require statements)
- Performance may be affected when validating large files or projects
- npm registry API rate limits may affect validation of many packages

## Release Notes

### 0.1.0

- Initial release
- Import validation against npm registry
- Package information view
- Code lens for import statements
- Tree view for browsing imports

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the MIT License.
