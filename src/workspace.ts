// Scans of open documents and files on disk, the files a document can see through `use`,
// and where the compiler and standard library are.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileScan } from './resolver';
import { PhiSymbol, ScanResult, scan } from './scanner';
import { findCompiler, findLibrary, isInside, resolveUse } from './toolchain';

const excludeGlob = '{**/build/**,**/node_modules/**,**/.git/**,**/bin/**,**/obj/**}';

/** Temporary copies written for checking unsaved files; never indexed. */
export const isTempCheckFile = (file: string) => /\.phicheck\.phi$/i.test(file);

const resultOfSymbol = new WeakMap<PhiSymbol, ScanResult>();

/** The scan a symbol came from, for turning its offsets into positions. */
export function scanResultOf(symbol: PhiSymbol): ScanResult | undefined {
    return resultOfSymbol.get(symbol);
}

function register(fileScan: FileScan): FileScan {
    for (const s of fileScan.result.allSymbols) resultOfSymbol.set(s, fileScan.result);
    return fileScan;
}

export class PhiWorkspace implements vscode.Disposable {
    compiler: string | undefined;
    library: string | undefined;

    private readonly cache = new Map<string, { stamp: string; scan: FileScan }>();
    private fileList: Promise<string[]> | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires when the compiler or library location changes. */
    readonly onDidChangeToolchain = this.changed.event;

    constructor(private readonly output: vscode.OutputChannel) {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.phi');
        const forget = (uri: vscode.Uri) => {
            if (isTempCheckFile(uri.fsPath)) return;
            this.cache.delete(this.key(uri.fsPath));
        };
        watcher.onDidChange(forget);
        watcher.onDidCreate(uri => { forget(uri); this.fileList = undefined; });
        watcher.onDidDelete(uri => { forget(uri); this.fileList = undefined; });
        this.disposables.push(watcher, this.changed);
        this.refreshToolchain();
    }

    dispose() {
        for (const d of this.disposables) d.dispose();
    }

    /** Looks for the compiler and library again (after a settings change, or a new build). */
    refreshToolchain() {
        const config = vscode.workspace.getConfiguration('phi');
        const searchDirs = [
            ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
            ...vscode.workspace.textDocuments.filter(d => d.languageId === 'phi' && d.uri.scheme === 'file').map(d => path.dirname(d.fileName)),
        ];
        const compiler = findCompiler(config.get<string>('compilerPath'), searchDirs);
        const library = findLibrary(config.get<string>('libraryPath'), compiler, searchDirs);
        if (compiler !== this.compiler || library !== this.library) {
            this.compiler = compiler;
            this.library = library;
            this.output.appendLine(`compiler: ${compiler ?? '(not found)'}`);
            this.output.appendLine(`library:  ${library ?? '(not found)'}`);
            this.changed.fire();
        }
    }

    /** Environment for running the compiler, with the configured NASM and QEMU paths. */
    environment(): NodeJS.ProcessEnv {
        const config = vscode.workspace.getConfiguration('phi');
        const env = { ...process.env };
        const qemu = config.get<string>('qemuPath');
        const nasm = config.get<string>('nasmPath');
        if (qemu) env.PHI_QEMU = qemu;
        if (nasm) env.PHI_NASM = nasm;
        return env;
    }

    key(file: string): string {
        const resolved = path.resolve(file);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    sameFile(a: string, b: string): boolean {
        return this.key(a) === this.key(b);
    }

    scanDocument(doc: vscode.TextDocument): FileScan {
        const key = this.key(doc.fileName) + (doc.uri.scheme === 'file' ? '' : `#${doc.uri.toString()}`);
        const stamp = `v${doc.version}`;
        const hit = this.cache.get(key);
        if (hit && hit.stamp === stamp) return hit.scan;
        const result = register({ file: doc.fileName, result: scan(doc.getText()) });
        this.cache.set(key, { stamp, scan: result });
        return result;
    }

    /** A file's scan: from its open editor if it has one, else from disk. */
    scanFile(file: string): FileScan | undefined {
        const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && this.sameFile(d.fileName, file));
        if (open) return this.scanDocument(open);

        const key = this.key(file);
        let stat: fs.Stats;
        try { stat = fs.statSync(file); } catch { return undefined; }
        const stamp = `${stat.mtimeMs}:${stat.size}`;
        const hit = this.cache.get(key);
        if (hit && hit.stamp === stamp) return hit.scan;
        try {
            const result = register({ file, result: scan(fs.readFileSync(file, 'utf8')) });
            this.cache.set(key, { stamp, scan: result });
            return result;
        } catch {
            return undefined;
        }
    }

    resolveUse(dotted: string, fromFile: string): string | undefined {
        return resolveUse(dotted, fromFile, this.library);
    }

    /** The files a file can see through `use`, directly or through other used files. */
    useClosure(start: FileScan): FileScan[] {
        const out: FileScan[] = [];
        const seen = new Set([this.key(start.file)]);
        const queue = [start];
        while (queue.length) {
            const current = queue.shift()!;
            for (const u of current.result.uses) {
                const file = this.resolveUse(u.path, current.file);
                if (!file || seen.has(this.key(file))) continue;
                seen.add(this.key(file));
                const s = this.scanFile(file);
                if (s) { out.push(s); queue.push(s); }
            }
        }
        return out;
    }

    /** Every .phi file in the workspace (not build output). */
    workspaceFiles(): Promise<string[]> {
        this.fileList ??= Promise.resolve(vscode.workspace.findFiles('**/*.phi', excludeGlob, 5000))
            .then(uris => uris.map(u => u.fsPath).filter(f => !isTempCheckFile(f)));
        return this.fileList;
    }

    async workspaceScans(): Promise<FileScan[]> {
        const files = await this.workspaceFiles();
        return files.map(f => this.scanFile(f)).filter((s): s is FileScan => !!s);
    }

    /** Standard library files, as scans. */
    libraryScans(): FileScan[] {
        if (!this.library) return [];
        const out: FileScan[] = [];
        const walk = (dir: string) => {
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (e.name.endsWith('.phi')) {
                    const s = this.scanFile(p);
                    if (s) out.push(s);
                }
            }
        };
        walk(this.library);
        return out;
    }

    /** `use` names for the standard library: drivers.vga_text, ... */
    libraryModules(): { name: string; file: string }[] {
        if (!this.library) return [];
        return this.libraryScans().map(s => ({
            name: path.relative(this.library!, s.file).replace(/\.phi$/, '').split(path.sep).join('.'),
            file: s.file,
        }));
    }

    /** `use` names for .phi files next to a file (in its folder's subfolders). */
    localModules(fromFile: string): { name: string; file: string }[] {
        const base = path.dirname(fromFile);
        const out: { name: string; file: string }[] = [];
        const walk = (dir: string, depth: number) => {
            if (depth > 3) return;
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (!['build', 'node_modules', '.git', 'bin', 'obj'].includes(e.name) && !e.name.endsWith('.rootfs') && /^[A-Za-z_]\w*$/.test(e.name)) walk(p, depth + 1);
                } else if (depth > 0 && /^[A-Za-z_]\w*\.phi$/.test(e.name) && !isTempCheckFile(p)) {
                    out.push({ name: path.relative(base, p).replace(/\.phi$/, '').split(path.sep).join('.'), file: p });
                }
            }
        };
        walk(base, 0);
        return out;
    }

    isLibraryFile(file: string): boolean {
        return !!this.library && isInside(file, this.library);
    }
}
