// This is a new file to ensure proper extension activation
import * as vscode from "vscode";

/**
 * Ensures the extension is properly activated
 */
export async function ensureActivation(): Promise<boolean> {
  try {
    // Check if the view container exists
    const viewContainers = vscode.window.registerTreeDataProvider;
    if (!viewContainers) {
      console.error("Tree data provider API not available");
      return false;
    }

    // Check if we're in a workspace
    if (
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      console.log("No workspace folders found, some features may be limited");
      // Set context to indicate we're not in a workspace
      await vscode.commands.executeCommand(
        "setContext",
        "workbenchState",
        "empty"
      );
    } else {
      // Set context to indicate we're in a workspace
      await vscode.commands.executeCommand(
        "setContext",
        "workbenchState",
        "workspace"
      );
    }

    // Ensure the extension is ready
    await vscode.commands.executeCommand(
      "setContext",
      "npmImportValidatorReady",
      true
    );

    return true;
  } catch (error) {
    console.error("Error during activation check:", error);
    return false;
  }
}
