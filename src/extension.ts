import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { PhiDiagnostics } from './diagnostics';
import { registerFeatures } from './features';
import { PhiWorkspace } from './workspace';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('PHI');
    const ws = new PhiWorkspace(output);
    const diagnostics = new PhiDiagnostics(ws, output, context.globalState);
    context.subscriptions.push(output, ws, diagnostics);

    registerFeatures(context, ws);
    registerCommands(context, ws, diagnostics);

    // the status bar shows which compiler is in use while a .phi file is open
    const status = vscode.window.createStatusBarItem('phi.status', vscode.StatusBarAlignment.Right, 100);
    status.name = 'PHI';
    const updateStatus = () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId !== 'phi') { status.hide(); return; }
        if (ws.compiler) {
            status.text = '$(circuit-board) PHI';
            status.tooltip = new vscode.MarkdownString(`**PHI**\n\nCompiler: \`${ws.compiler}\`\n\nLibrary: \`${ws.library ?? 'not found'}\`\n\nClick to check this file.`);
            status.command = 'phi.check';
            status.backgroundColor = undefined;
        } else {
            status.text = '$(warning) PHI';
            status.tooltip = "Can't find the phi compiler. Click to locate it.";
            status.command = 'phi.locateCompiler';
            status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        status.show();
    };

    context.subscriptions.push(
        status,
        vscode.window.onDidChangeActiveTextEditor(updateStatus),
        ws.onDidChangeToolchain(updateStatus),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('phi.compilerPath') || e.affectsConfiguration('phi.libraryPath')) ws.refreshToolchain();
            if (e.affectsConfiguration('phi.validate')) diagnostics.checkAllOpen();
        }),
        // a .phi file outside the workspace may sit inside the PHI repository: look again
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'phi' && (!ws.compiler || !ws.library)) ws.refreshToolchain();
        }),
    );

    updateStatus();
    diagnostics.checkAllOpen();
}

export function deactivate() {
    // everything is disposed through context.subscriptions
}
