// The language server (languageServer.ts) shows errors as you type. This is for a phi too old to
// have one: it runs `phi check` and shows what that reports in the Problems panel.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PhiServer } from './languageServer';
import { CompilerDiagnostic, check, resolveDiagnosticPath } from './toolchain';
import { PhiWorkspace } from './workspace';

type Mode = 'onSave' | 'onType' | 'off';

export class PhiDiagnostics implements vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('phi');

    /** for each checked file: the diagnostics it produced, by the file they're in */
    private readonly byRoot = new Map<string, Map<string, vscode.Diagnostic[]>>();
    private readonly running = new Map<string, AbortController>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly disposables: vscode.Disposable[] = [];
    private warnedMissing = false;

    constructor(private readonly ws: PhiWorkspace, private readonly output: vscode.OutputChannel, private readonly state: vscode.Memento, private readonly server: PhiServer) {
        this.disposables.push(
            server.onDidChangeRunning(() => this.serverChanged()),
            this.collection,
            vscode.workspace.onDidOpenTextDocument(doc => this.schedule(doc, 0)),
            vscode.workspace.onDidSaveTextDocument(doc => this.schedule(doc, 0)),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (this.mode() === 'onType' && e.contentChanges.length) this.schedule(e.document, this.delay());
            }),
            vscode.workspace.onDidCloseTextDocument(doc => this.forget(doc)),
            ws.onDidChangeToolchain(() => this.checkAllOpen()),
        );
    }

    dispose() {
        for (const t of this.timers.values()) clearTimeout(t);
        for (const c of this.running.values()) c.abort();
        for (const d of this.disposables) d.dispose();
    }

    private serverChanged() {
        if (this.server.running) {
            for (const t of this.timers.values()) clearTimeout(t);
            this.timers.clear();
            this.collection.clear();
            this.byRoot.clear();
        } else {
            this.checkAllOpen();
        }
    }

    private mode(): Mode {
        return vscode.workspace.getConfiguration('phi').get<Mode>('validate', 'onType');
    }

    private delay(): number {
        return vscode.workspace.getConfiguration('phi').get<number>('validateDelay', 600);
    }

    checkAllOpen() {
        if (this.server.running) return;
        if (this.mode() === 'off') {
            this.collection.clear();
            this.byRoot.clear();
            return;
        }
        for (const doc of vscode.workspace.textDocuments) this.schedule(doc, 0);
    }

    private schedule(doc: vscode.TextDocument, delay: number) {
        if (doc.languageId !== 'phi' || doc.uri.scheme !== 'file' || this.mode() === 'off' || this.server.running) return;
        const key = this.ws.key(doc.fileName);
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            void this.check(doc);
        }, delay));
    }

    private forget(doc: vscode.TextDocument) {
        const key = this.ws.key(doc.fileName);
        this.running.get(key)?.abort();
        const old = this.byRoot.get(key);
        this.byRoot.delete(key);
        if (old) this.publish(old.keys());
    }

    /**
     * Checks a document. An unsaved document is checked through a hidden copy next to it (so
     * `use` paths resolve the same way) only when validation runs while typing, or when forced.
     * @returns the number of errors and warnings found, or undefined if it couldn't run
     */
    async check(doc: vscode.TextDocument, force = false): Promise<{ errors: number; warnings: number } | undefined> {
        if (doc.languageId !== 'phi' || doc.uri.scheme !== 'file') return undefined;
        if (this.server.running) return this.fromServer(doc);
        const compiler = this.ws.compiler;
        if (!compiler) {
            this.warnMissingCompiler();
            return undefined;
        }

        const key = this.ws.key(doc.fileName);
        this.running.get(key)?.abort();
        const abort = new AbortController();
        this.running.set(key, abort);

        let file = doc.fileName;
        let temp: string | undefined;
        if (doc.isDirty) {
            if (this.mode() !== 'onType' && !force) return undefined;
            temp = path.join(path.dirname(doc.fileName), `.${path.basename(doc.fileName, '.phi')}.phicheck.phi`);
            try {
                fs.writeFileSync(temp, doc.getText());
            } catch (e) {
                this.output.appendLine(`can't write ${temp}: ${e}`);
                return undefined;
            }
            file = temp;
        }

        const version = doc.version;
        try {
            const result = await check(compiler, file, { env: this.ws.environment(), signal: abort.signal });
            if (abort.signal.aborted) return undefined;
            if (result.spawnError) {
                this.output.appendLine(`couldn't run ${compiler}: ${result.spawnError.message}`);
                this.warnMissingCompiler(result.spawnError.message);
                return undefined;
            }
            if (result.diagnostics.length) {
                this.output.appendLine(`phi check ${path.basename(doc.fileName)}:`);
                for (const line of (result.stderr + result.stdout).split(/\r?\n/).filter(Boolean)) this.output.appendLine('  ' + line.replace(temp ?? '\0', doc.fileName));
            }
            // the text changed while checking: a newer check is on its way
            if (doc.version !== version && this.mode() === 'onType') return undefined;
            return this.apply(doc, key, result.diagnostics, temp);
        } finally {
            if (this.running.get(key) === abort) this.running.delete(key);
            if (temp) fs.rm(temp, { force: true }, () => undefined);
        }
    }

    /** What the server says now. It answers a question only once its errors for this text are out. */
    private async fromServer(doc: vscode.TextDocument): Promise<{ errors: number; warnings: number }> {
        await this.server.definition(doc, new vscode.Position(0, 0));
        const found = vscode.languages.getDiagnostics(doc.uri);
        const errors = found.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
        return { errors, warnings: found.length - errors };
    }

    private apply(doc: vscode.TextDocument, key: string, found: CompilerDiagnostic[], temp: string | undefined) {
        const cwd = path.dirname(doc.fileName);
        const byFile = new Map<string, vscode.Diagnostic[]>();
        let errors = 0, warnings = 0;

        for (const d of found) {
            let target = d.file ? resolveDiagnosticPath(d.file, cwd, this.ws.library) : doc.fileName;
            let message = d.message;
            let range: vscode.Range;

            if (target && temp && this.ws.sameFile(target, temp)) target = doc.fileName;

            if (!target || !d.line) {
                // not tied to a place we can show: put it at the top of the checked file
                if (d.file && !target) message = `${d.file}:${d.line}:${d.column}: ${message}`;
                target = doc.fileName;
                range = new vscode.Range(0, 0, 0, 0);
            } else {
                range = this.rangeAt(target, doc, d.line - 1, (d.column ?? 1) - 1);
            }

            const diagnostic = new vscode.Diagnostic(range, message, d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'phi';
            if (!this.ws.sameFile(target, doc.fileName)) {
                diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(doc.uri, new vscode.Position(0, 0)), `found while checking ${path.basename(doc.fileName)}`)];
            }
            const uriKey = vscode.Uri.file(target).toString();
            byFile.set(uriKey, [...(byFile.get(uriKey) ?? []), diagnostic]);
            if (d.severity === 'warning') warnings++; else errors++;
        }

        const previous = this.byRoot.get(key);
        this.byRoot.set(key, byFile);
        // the checked file always gets published, so fixed errors disappear
        const touched = new Set<string>([doc.uri.toString(), ...byFile.keys(), ...(previous?.keys() ?? [])]);
        this.publish(touched);
        return { errors, warnings };
    }

    /** Diagnostics for a file are the union of what every checked file reported for it. */
    private publish(uris: Iterable<string>) {
        for (const uri of uris) {
            const merged: vscode.Diagnostic[] = [];
            const seen = new Set<string>();
            for (const files of this.byRoot.values()) {
                for (const d of files.get(uri) ?? []) {
                    const id = `${d.range.start.line}:${d.range.start.character}:${d.message}`;
                    if (seen.has(id)) continue;
                    seen.add(id);
                    merged.push(d);
                }
            }
            this.collection.set(vscode.Uri.parse(uri), merged);
        }
    }

    /** The range of the token at a compiler-reported position. */
    private rangeAt(file: string, checked: vscode.TextDocument, line: number, column: number): vscode.Range {
        const doc = this.ws.sameFile(file, checked.fileName) ? checked
            : vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && this.ws.sameFile(d.fileName, file));
        let text: string | undefined;
        if (doc) {
            if (line >= doc.lineCount) return new vscode.Range(line, column, line, column + 1);
            text = doc.lineAt(line).text;
        } else {
            try { text = fs.readFileSync(file, 'utf8').split(/\r?\n/)[line]; } catch { /* the file is gone */ }
        }
        if (text === undefined) return new vscode.Range(line, column, line, column + 1);

        // at the end of a line ("expected ';'"), underline the token that's missing something
        if (column >= text.trimEnd().length) {
            const before = text.slice(0, column).trimEnd();
            const m = /(?:'(?:[^'\\]|\\.)*'|[A-Za-z_]\w*|\d\w*|\S)$/.exec(before);
            if (m) return new vscode.Range(line, before.length - m[0].length, line, before.length);
            return new vscode.Range(line, column, line, column);
        }

        const rest = text.slice(column);
        const m = /^(?:[A-Za-z_]\w*|0[xX][0-9A-Fa-f_]+|\d[\w]*|'(?:[^'\\]|\\.)*'?|;;|\S)/.exec(rest);
        const length = m ? m[0].length : Math.max(1, text.length - column);
        return new vscode.Range(line, column, line, column + length);
    }

    private warnMissingCompiler(detail?: string) {
        if (this.warnedMissing || this.state.get('phi.hideMissingCompiler')) return;
        this.warnedMissing = true;
        const message = detail
            ? `PHI: couldn't run the compiler (${detail}). Check the phi.compilerPath setting.`
            : "PHI: couldn't find the phi compiler, so errors won't be shown. Build it with `dotnet build PHI.sln`, put phi on PATH, or set phi.compilerPath.";
        void vscode.window.showWarningMessage(message, 'Locate phi…', 'Open Settings', "Don't Show Again").then(async choice => {
            if (choice === 'Locate phi…') await vscode.commands.executeCommand('phi.locateCompiler');
            else if (choice === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'phi.compilerPath');
            else if (choice === "Don't Show Again") await this.state.update('phi.hideMissingCompiler', true);
        });
    }

    /** Lets the warning show again (after the user picks a compiler). */
    resetWarning() {
        this.warnedMissing = false;
    }
}
