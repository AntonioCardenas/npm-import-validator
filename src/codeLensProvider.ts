import * as vscode from "vscode";
import type { ImportValidator } from "./importValidator";
import type { PackageInfoProvider } from "./packageInfoProvider";

export class CodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private validator: ImportValidator,
    private packageInfoProvider: PackageInfoProvider,
  ) {}

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const results = await this.validator.validateDocument(document);
    const codeLenses: vscode.CodeLens[] = [];

    // Get ignored packages
    const ignoredPackages =
      vscode.workspace.getConfiguration("npmImportValidator").get<string[]>("ignoredPackages") || [];

    for (const result of results) {
      // Skip ignored packages
      if (ignoredPackages.includes(result.importName)) {
        continue;
      }

      let command: vscode.Command | undefined;

      if (result.existsOnNpm) {
        // Valid import - show version
        if (result.packageInfo) {
          command = {
            title: `v${result.packageInfo.version} (${result.importType})`,
            command: "npm-import-validator.showPackageInfo",
            arguments: [result.importName],
          };
        }
      } else {
        // Invalid import
        command = {
          title: `Not found on npm registry (${result.importType})`,
          command: "npm-import-validator.showPackageInfo",
          arguments: [result.importName],
        };
      }

      if (command) {
        const codeLens = new vscode.CodeLens(result.range);
        codeLens.command = command;
        codeLenses.push(codeLens);
      }
    }

    return codeLenses;
  }
}
