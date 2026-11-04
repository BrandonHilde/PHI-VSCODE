// Runs `phi lsp`, the compiler's language server: errors as you type, and what names really mean.
// On Windows a running program's files can't be replaced, and phi is rebuilt all the time while
// working on PHI, so the server runs from a copy of it and starts again when phi changes. A phi too
// old to have `phi lsp` leaves `running` false, and the extension does what it can without it.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CompletionRequest, DefinitionRequest, LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { PhiWorkspace } from './workspace';

/** Copies of phi from earlier builds are left for a day, as another window can be running one. */
const COPIES = path.join(os.tmpdir(), 'phi-lsp');
const OLD_COPY_MS = 24 * 60 * 60 * 1000;

/** A build writes many files: wait for it to be over. */
const BUILD_SETTLES_MS = 1500;

export class PhiServer implements vscode.Disposable {
    private client: LanguageClient | undefined;
    private watcher: fs.FSWatcher | undefined;
    private timer: NodeJS.Timeout | undefined;
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [this.changed];

    /** Fires when the server starts or stops answering. */
    readonly onDidChangeRunning = this.changed.event;

    constructor(private readonly ws: PhiWorkspace, private readonly output: vscode.OutputChannel) {
        this.disposables.push(ws.onDidChangeToolchain(() => void this.restart()));
    }

    get running(): boolean {
        return this.client?.isRunning() ?? false;
    }

    dispose() {
        clearTimeout(this.timer);
        this.watcher?.close();
        for (const d of this.disposables) d.dispose();
        void this.stop();
    }

    async start() {
        const compiler = this.ws.compiler;
        this.watchForBuild(compiler);
        if (!compiler) return;

        let client: LanguageClient | undefined;
        try {
            client = new LanguageClient(
                'phi',
                'PHI',
                { command: this.runnableCopy(compiler), args: ['lsp'] },
                {
                    documentSelector: [{ scheme: 'file', language: 'phi' }],
                    outputChannel: this.output,
                    revealOutputChannelOn: RevealOutputChannelOn.Never,
                    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.phi') },
                    middleware: {
                        // the extension's own providers ask the server, and add what they know
                        provideDefinition: () => undefined,
                        provideCompletionItem: () => undefined,
                        handleDiagnostics: (uri, diagnostics, next) => next(uri, validating() ? diagnostics : []),
                    },
                });
            await client.start();
            this.client = client;
            this.output.appendLine(`language server: ${compiler} lsp`);
        } catch (e) {
            this.output.appendLine(`no language server (${compiler} lsp): ${e}. Rebuild PHI to get it.`);
            this.client = undefined;
            void client?.dispose().catch(() => undefined);
        }
        this.changed.fire();
    }

    private async stop() {
        const stopping = this.client;
        this.client = undefined;
        if (stopping) await stopping.stop().catch(() => undefined);
    }

    async restart() {
        await this.stop();
        await this.start();
    }

    /** What the server says a name at this place is; nothing without one, or when it doesn't know. */
    async definition(doc: vscode.TextDocument, position: vscode.Position, token?: vscode.CancellationToken): Promise<vscode.Definition | vscode.DefinitionLink[] | undefined> {
        const client = this.askable(doc);
        if (!client) return undefined;
        try {
            const params = client.code2ProtocolConverter.asTextDocumentPositionParams(doc, position);
            return await client.protocol2CodeConverter.asDefinitionResult(await client.sendRequest(DefinitionRequest.type, params, token), token);
        } catch (e) {
            this.output.appendLine(`language server: definition: ${e}`);
            return undefined;
        }
    }

    /** The names the server says could go at this place. */
    async completions(doc: vscode.TextDocument, position: vscode.Position, context: vscode.CompletionContext, token?: vscode.CancellationToken): Promise<vscode.CompletionItem[]> {
        const client = this.askable(doc);
        if (!client) return [];
        try {
            const params = client.code2ProtocolConverter.asCompletionParams(doc, position, context);
            const answer = await client.protocol2CodeConverter.asCompletionResult(await client.sendRequest(CompletionRequest.type, params, token), undefined, token);
            return Array.isArray(answer) ? answer : answer?.items ?? [];
        } catch (e) {
            this.output.appendLine(`language server: completion: ${e}`);
            return [];
        }
    }

    /** The client to ask about this document: only saved files are the server's (not untitled ones). */
    private askable(doc: vscode.TextDocument): LanguageClient | undefined {
        return this.running && doc.uri.scheme === 'file' ? this.client : undefined;
    }

    /**
     * A copy of phi to run, so the original can be rebuilt: one folder for each build, found by
     * what's in phi's own files. A phi that isn't a built folder runs where it is.
     */
    private runnableCopy(compiler: string): string {
        const folder = path.dirname(compiler);
        const own = ['phi.dll', 'Phi.Compiler.dll'].map(f => path.join(folder, f));
        if (!own.every(f => fs.existsSync(f))) return compiler;

        const hash = crypto.createHash('sha256');
        for (const file of own) hash.update(fs.readFileSync(file));
        const copy = path.join(COPIES, hash.digest('hex').slice(0, 16));

        if (!fs.existsSync(path.join(copy, 'done'))) {
            fs.mkdirSync(copy, { recursive: true });
            for (const file of fs.readdirSync(folder).filter(f => /\.(dll|exe|json)$/.test(f) || f === 'phi')) {
                fs.copyFileSync(path.join(folder, file), path.join(copy, file));
            }
            fs.writeFileSync(path.join(copy, 'done'), '');
        }
        removeOldCopies(copy);
        return path.join(copy, path.basename(compiler));
    }

    /** Start again when phi is rebuilt, since its library and its checks are inside it. */
    private watchForBuild(compiler: string | undefined) {
        this.watcher?.close();
        this.watcher = undefined;
        if (!compiler) return;
        const dll = path.join(path.dirname(compiler), 'phi.dll');
        if (!fs.existsSync(dll)) return;

        let last = fs.statSync(dll).mtimeMs;
        this.watcher = fs.watch(path.dirname(dll), () => {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                try {
                    const built = fs.statSync(dll).mtimeMs;
                    if (built === last) return;
                    last = built;
                    this.output.appendLine('phi was rebuilt');
                    void this.restart();
                } catch {
                    // in the middle of a build: there'll be another event
                }
            }, BUILD_SETTLES_MS);
        });
    }
}

function validating(): boolean {
    return vscode.workspace.getConfiguration('phi').get<string>('validate', 'onType') !== 'off';
}

function removeOldCopies(keep: string) {
    for (const name of fs.readdirSync(COPIES)) {
        const copy = path.join(COPIES, name);
        if (copy === keep) continue;
        try {
            if (Date.now() - fs.statSync(copy).mtimeMs > OLD_COPY_MS) fs.rmSync(copy, { recursive: true, force: true });
        } catch {
            // one that's still running: there's always next time
        }
    }
}
