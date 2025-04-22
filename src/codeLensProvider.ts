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

    for (const result of results) {
      let command: vscode.Command | undefined;

      if (result.existsOnNpm) {
        // Valid import - show version
        if (result.packageInfo) {
          command = {
            title: `v${result.packageInfo.version}`,
            command: "npm-import-validator.showPackageInfo",
            arguments: [result.importName],
          };
        }
      } else {
        // Invalid import
        command = {
          title: `Not found on npm registry`,
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
