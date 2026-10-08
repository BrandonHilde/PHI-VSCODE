// Runs inside VS Code (see test/integration/run.ts): opens the PHI repository and checks every
// language feature through VS Code's own commands, the way the editor would call them.

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
const results: string[] = [];

async function step(name: string, body: () => Promise<void>) {
    try {
        await body();
        results.push(`PASS ${name}`);
    } catch (e) {
        results.push(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 3).join('\n     ')}`);
    }
}

async function open(relative: string) {
    const doc = await vscode.workspace.openTextDocument(path.join(root, relative));
    await vscode.window.showTextDocument(doc);
    return doc;
}

/** Position of the nth occurrence of needle (plus delta characters). */
function at(doc: vscode.TextDocument, needle: string, delta = 0, nth = 0): vscode.Position {
    let index = -1;
    for (let i = 0; i <= nth; i++) {
        index = doc.getText().indexOf(needle, index + 1);
        assert.ok(index >= 0, `'${needle}' not found`);
    }
    return doc.positionAt(index + delta);
}

function hoverText(hovers: vscode.Hover[]): string {
    return hovers.flatMap(h => h.contents).map(c => (typeof c === 'string' ? c : 'value' in c ? c.value : '')).join('\n');
}

async function waitFor<T>(what: string, poll: () => T | undefined, timeoutMs = 20000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = poll();
        if (value !== undefined) return value;
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`timed out waiting for ${what}`);
}

export async function run(): Promise<void> {
    const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'phi-language');
    assert.ok(ext, 'extension not loaded');

    const kernel = await open('samples/kernel.phi');
    await ext!.activate();
    assert.equal(kernel.languageId, 'phi');

    await step('hover on a library method shows its signature', async () => {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', kernel.uri, at(kernel, 'Vga.Print', 5));
        const text = hoverText(hovers);
        assert.match(text, /\[Print: /);
        assert.match(text, /lib\/phi\/drivers\/vga_text\.phi/);
    });

    await step('hover on a built-in color and keyword', async () => {
        const color = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', kernel.uri, at(kernel, 'Colors.White', 8)));
        assert.match(color, /15/);
        const kw = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', kernel.uri, at(kernel, 'while', 1)));
        assert.match(kw, /Repeats the block/);
    });

    await step('go to definition: Vga.Clear opens the driver', async () => {
        const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', kernel.uri, at(kernel, 'Vga.Clear', 5));
        assert.ok(defs.length >= 1);
        const uri = 'targetUri' in defs[0] ? defs[0].targetUri : defs[0].uri;
        assert.match(uri.fsPath.replace(/\\/g, '/'), /lib\/phi\/drivers\/vga_text\.phi$/);
    });

    await step('go to definition: use path opens the file', async () => {
        const defs = await vscode.commands.executeCommand<vscode.LocationLink[]>('vscode.executeDefinitionProvider', kernel.uri, at(kernel, 'boot.info', 6));
        assert.match(defs[0].targetUri.fsPath.replace(/\\/g, '/'), /lib\/phi\/boot\/info\.phi$/);
    });

    await step('go to definition: struct field through a pointer (r:0.base)', async () => {
        const defs = await vscode.commands.executeCommand<vscode.LocationLink[]>('vscode.executeDefinitionProvider', kernel.uri, at(kernel, 'r:0.base', 5));
        assert.ok(defs.length >= 1, 'no definition');
        const text = (await vscode.workspace.openTextDocument(defs[0].targetUri)).getText(defs[0].targetSelectionRange);
        assert.equal(text, 'base');
    });

    await step('outline lists the class and its variables', async () => {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', kernel.uri);
        const cls = symbols.find(s => s.name === 'Hello');
        assert.ok(cls, JSON.stringify(symbols.map(s => s.name)));
        assert.deepEqual(cls!.children.map(c => c.name).slice(0, 3), ['boot', 'regions', 'usableKb']);
    });

    await step('completion after OS. lists built-ins', async () => {
        const doc = await vscode.workspace.openTextDocument({ language: 'phi', content: 'phi.T:Kernel\n{\n\tcall OS.\n}' });
        const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(2, 9), '.');
        const labels = list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.ok(labels.includes('Sleep') && labels.includes('GetTicks') && labels.includes('TimerEvent'), labels.join(','));
    });

    await step('completion after Vga. lists the class members', async () => {
        const edit = new vscode.WorkspaceEdit();
        const pos = at(kernel, 'call Vga.Clear;');
        edit.insert(kernel.uri, pos, 'call Vga.\n\t');
        await vscode.workspace.applyEdit(edit);
        const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', kernel.uri, pos.translate(0, 9), '.');
        const labels = list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
        await vscode.commands.executeCommand('undo');
        assert.ok(labels.includes('Print') && labels.includes('SetColor'), labels.join(','));
    });

    await step('completion for use lists the standard library', async () => {
        const doc = await vscode.workspace.openTextDocument({ language: 'phi', content: 'use dri' });
        const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 7));
        const labels = list.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label));
        assert.ok(labels.includes('drivers.vga_text') && labels.includes('fs.fat16'), labels.join(','));
    });

    await step('signature help for Vga.SetColor and OS.DrawRectangle', async () => {
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', kernel.uri, at(kernel, 'Colors.Blue'), ' ');
        assert.ok(help?.signatures.length, 'no signature');
        assert.match(help.signatures[0].label, /SetColor: /);
        assert.equal(help.activeParameter, 1);

        const doc = await vscode.workspace.openTextDocument({ language: 'phi', content: 'phi.T:Bootloader\n{\n\tcall OS.DrawRectangle: 1 2 \n}' });
        const h2 = await vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', doc.uri, new vscode.Position(2, 28), ' ');
        assert.equal(h2.signatures[0].label, 'OS.DrawRectangle: x y width height color');
        assert.equal(h2.activeParameter, 2);
    });

    await step('folding ranges cover the class and blocks', async () => {
        const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', kernel.uri);
        assert.ok(ranges.length >= 4, `${ranges.length} ranges`);
        assert.ok(ranges.some(r => r.kind === vscode.FoldingRangeKind.Comment));
    });

    const methods = await open('tests/methods.phi');

    await step('references to a method include its calls', async () => {
        const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', methods.uri, at(methods, '[Add', 1));
        const lines = refs.filter(r => r.uri.fsPath === methods.uri.fsPath).map(r => r.range.start.line).sort((a, b) => a - b);
        assert.ok(lines.length >= 3, JSON.stringify(lines)); // two calls and the declaration
    });

    await step('rename a parameter changes its uses only', async () => {
        const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', methods.uri, at(methods, 'int minutes', 4), 'mins');
        const edits = edit.get(methods.uri);
        assert.equal(edits.length, 2, JSON.stringify(edits.map(e => e.range.start)));
    });

    await step('document highlights for a variable', async () => {
        const hs = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>('vscode.executeDocumentHighlights', methods.uri, at(methods, 'int total', 4));
        assert.ok(hs.length >= 4, `${hs.length}`);
    });

    await step('workspace symbols find library classes', async () => {
        const syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', 'ReadFile');
        assert.ok(syms.some(s => s.name === 'ReadFile' && s.containerName === 'Fat'), syms.map(s => `${s.containerName}.${s.name}`).join(','));
    });

    await step('phi check errors appear in the Problems panel', async () => {
        const bad = await open('tests/error_syntax.phi');
        const diags = await waitFor('diagnostics', () => {
            const d = vscode.languages.getDiagnostics(bad.uri);
            return d.length >= 3 ? d : undefined;
        });
        const sorted = diags.sort((a, b) => a.range.start.line - b.range.start.line);
        // "expected ';'" is reported at the end of line 3: the string before it is underlined
        const first = sorted[0];
        assert.equal(first.range.start.line, 2);
        assert.equal(bad.getText(first.range), "'missing semicolon'");
        assert.match(first.message, /expected ';'/);
        assert.equal(first.source, 'phi');
        // "expected a variable name but found ':'" points at the ':'
        assert.equal(bad.getText(sorted[1].range), ':');
        assert.equal(sorted[1].severity, vscode.DiagnosticSeverity.Error);
    });

    await step('a file without errors has no diagnostics', async () => {
        const good = await open('tests/hello.phi');
        await vscode.commands.executeCommand('phi.check');
        await new Promise(r => setTimeout(r, 1500));
        assert.equal(vscode.languages.getDiagnostics(good.uri).length, 0);
    });

    await step('errors in a used file are reported on that file', async () => {
        const chain = await open('tests/error_use_chain.phi');
        const diags = await waitFor('diagnostics', () => {
            const d = vscode.languages.getDiagnostics(chain.uri);
            return d.length >= 1 ? d : undefined;
        });
        assert.ok(diags.some(d => /can't find support\/missing_file\.phi/.test(d.message)));
    });

    await step('checking while typing uses a hidden copy and cleans it up', async () => {
        const config = vscode.workspace.getConfiguration('phi');
        await config.update('validate', 'onType', vscode.ConfigurationTarget.Global);
        await config.update('validateDelay', 200, vscode.ConfigurationTarget.Global);
        try {
            const doc = await open('tests/hello.phi');
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, new vscode.Position(4, 0), '\tint : 5;\n');
            await vscode.workspace.applyEdit(edit);
            assert.ok(doc.isDirty);
            const diags = await waitFor('on-type diagnostics', () => {
                const d = vscode.languages.getDiagnostics(doc.uri);
                return d.length ? d : undefined;
            });
            assert.equal(diags[0].range.start.line, 4);
            assert.match(diags[0].message, /expected a variable name/);

            await vscode.commands.executeCommand('workbench.action.files.revert');
            await waitFor('diagnostics to clear', () => (vscode.languages.getDiagnostics(doc.uri).length === 0 ? true : undefined));
            const fs = await import('fs');
            const leftovers = fs.readdirSync(path.join(root, 'tests')).filter(f => f.includes('.phicheck.'));
            assert.deepEqual(leftovers, []);
        } finally {
            await config.update('validate', undefined, vscode.ConfigurationTarget.Global);
            await config.update('validateDelay', undefined, vscode.ConfigurationTarget.Global);
        }
    });

    await step('show generated assembly builds and jumps to the line', async () => {
        const doc = await open('tests/hello.phi');
        const editor = vscode.window.activeTextEditor!;
        const line = at(doc, "log 'PHI boots'").line;
        editor.selection = new vscode.Selection(line, 2, line, 2);
        await vscode.commands.executeCommand('phi.showAssembly');
        const asmEditor = await waitFor('the .asm editor', () => {
            const e = vscode.window.visibleTextEditors.find(e => e.document.fileName.endsWith('.asm'));
            return e && e.selection.active.line > 0 ? e : undefined;
        }, 60000);
        assert.match(path.basename(asmEditor.document.fileName), /^boot\.asm$/);
        const text = asmEditor.document.lineAt(asmEditor.selection.active.line).text;
        assert.match(text, new RegExp(`; ${line + 1}: log 'PHI boots'`));
    });

    const report = results.join('\n');
    console.log('\n' + report + '\n');
    const failed = results.filter(r => r.startsWith('FAIL')).length;
    if (failed) throw new Error(`${failed} of ${results.length} integration checks failed`);
}
