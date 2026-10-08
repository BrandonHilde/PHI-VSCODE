// Check, build, run and test commands, and the `phi` task type for tasks.json.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findAsmLine } from './asmMap';
import { PhiDiagnostics } from './diagnostics';
import { symbolAt } from './scanner';
import { PhiWorkspace } from './workspace';

type PhiCommand = 'check' | 'build' | 'run' | 'test';

interface PhiTaskDefinition extends vscode.TaskDefinition {
    type: 'phi';
    command: PhiCommand;
    file?: string;
    args?: string[];
}

export function registerCommands(context: vscode.ExtensionContext, ws: PhiWorkspace, diagnostics: PhiDiagnostics) {
    const tasks = new PhiTasks(ws);

    const activePhiFile = (): vscode.TextDocument | undefined => {
        const doc = vscode.window.activeTextEditor?.document;
        if (doc?.languageId === 'phi' && doc.uri.scheme === 'file') return doc;
        void vscode.window.showWarningMessage('Open a saved .phi file first.');
        return undefined;
    };

    const requireCompiler = async (): Promise<boolean> => {
        if (!ws.compiler) ws.refreshToolchain();
        if (ws.compiler) return true;
        const choice = await vscode.window.showErrorMessage(
            "Can't find the phi compiler. Build it with `dotnet build PHI.sln`, put phi on PATH, or set phi.compilerPath.",
            'Locate phi…', 'Open Settings');
        if (choice === 'Locate phi…') await vscode.commands.executeCommand('phi.locateCompiler');
        if (choice === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'phi.compilerPath');
        return !!ws.compiler;
    };

    /** Saves open .phi files: a build reads every file the program uses from disk. */
    const saveAll = async () => {
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.languageId === 'phi' && doc.isDirty && doc.uri.scheme === 'file') await doc.save();
        }
    };

    const runFileTask = async (command: 'build' | 'run', args: string[] = []) => {
        const doc = activePhiFile();
        if (!doc || !(await requireCompiler())) return undefined;
        await saveAll();
        return tasks.execute({ type: 'phi', command, file: doc.fileName, args });
    };

    context.subscriptions.push(
        vscode.tasks.registerTaskProvider('phi', tasks),

        vscode.commands.registerCommand('phi.check', async () => {
            const doc = activePhiFile();
            if (!doc || !(await requireCompiler())) return;
            const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'PHI: checking' }, () => diagnostics.check(doc, true));
            if (!result) return;
            if (result.errors || result.warnings) {
                const parts = [result.errors && `${result.errors} error${result.errors > 1 ? 's' : ''}`, result.warnings && `${result.warnings} warning${result.warnings > 1 ? 's' : ''}`].filter(Boolean);
                void vscode.commands.executeCommand('workbench.actions.view.problems');
                vscode.window.setStatusBarMessage(`$(error) PHI: ${parts.join(', ')} in ${path.basename(doc.fileName)}`, 5000);
            } else {
                vscode.window.setStatusBarMessage(`$(check) PHI: no errors in ${path.basename(doc.fileName)}`, 5000);
            }
        }),

        vscode.commands.registerCommand('phi.build', () => runFileTask('build')),
        vscode.commands.registerCommand('phi.run', () => runFileTask('run')),
        vscode.commands.registerCommand('phi.runDebug', async () => {
            await runFileTask('run', ['--debug']);
            void vscode.window.showInformationMessage('QEMU is paused, waiting for gdb on localhost:1234 (target remote localhost:1234).');
        }),

        vscode.commands.registerCommand('phi.test', async () => {
            if (!(await requireCompiler())) return;
            await saveAll();
            const folder = findTestsFolder();
            await tasks.execute({ type: 'phi', command: 'test', ...(folder ? { file: folder } : {}) });
        }),

        vscode.commands.registerCommand('phi.showAssembly', async () => {
            const doc = activePhiFile();
            if (!doc) return;
            const editor = vscode.window.activeTextEditor!;
            const outDir = path.join(path.dirname(doc.fileName), 'build', path.basename(doc.fileName, '.phi'));

            // build first when the assembly is missing or older than the source
            const asmFiles = () => ['kernel.asm', 'os.asm', 'boot.asm', 'program.asm'].map(f => path.join(outDir, f)).filter(f => fs.existsSync(f));
            const stale = () => {
                const files = asmFiles();
                if (!files.length) return true;
                const asmTime = Math.min(...files.map(f => fs.statSync(f).mtimeMs));
                return doc.isDirty || fs.statSync(doc.fileName).mtimeMs > asmTime;
            };
            if (stale()) {
                if (!(await requireCompiler())) return;
                await saveAll();
                const code = await tasks.execute({ type: 'phi', command: 'build', file: doc.fileName }, true);
                if (code !== 0) {
                    void vscode.window.showErrorMessage('PHI: the build failed; see the terminal and the Problems panel.');
                    return;
                }
            }

            let files = asmFiles();
            if (!files.length) {
                // any other .asm the compiler produced (except the boot stages it adds)
                files = safeList(outDir).filter(f => f.endsWith('.asm') && !/^stage\d\.asm$/.test(f)).map(f => path.join(outDir, f));
            }
            if (!files.length) {
                void vscode.window.showWarningMessage(`PHI: no generated assembly in ${vscode.workspace.asRelativePath(outDir)}.`);
                return;
            }

            // the unit the cursor's class belongs to: boot.asm for the Bootloader, os.asm for the rest
            const scan = ws.scanDocument(doc);
            const offset = doc.offsetAt(editor.selection.active);
            const cls = symbolAt(scan.result, offset, ['class']);
            const method = symbolAt(scan.result, offset, ['method', 'isr', 'event']);
            let file = files[0];
            if (files.length > 1) {
                file = files.find(f => path.basename(f) === (cls?.type === 'Bootloader' ? 'boot.asm' : 'os.asm')) ?? files[0];
            }

            const asm = fs.readFileSync(file, 'utf8');
            const where = findAsmLine(asm, cls?.name, method?.kind === 'event' ? method.name.split('.').pop() : method?.name, editor.selection.active.line + 1);
            const asmDoc = await vscode.workspace.openTextDocument(file);
            const selection = where ? new vscode.Range(where.line, 0, where.line, 0) : undefined;
            await vscode.window.showTextDocument(asmDoc, { viewColumn: vscode.ViewColumn.Beside, preview: true, selection });
        }),

        vscode.commands.registerCommand('phi.locateCompiler', async () => {
            const picked = await vscode.window.showOpenDialog({
                title: 'Locate the phi compiler',
                canSelectMany: false,
                openLabel: 'Use this compiler',
                filters: process.platform === 'win32' ? { 'phi compiler': ['exe'] } : undefined,
            });
            if (!picked?.length) return;
            await vscode.workspace.getConfiguration('phi').update('compilerPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
            diagnostics.resetWarning();
            ws.refreshToolchain();
        }),
    );
}

function findTestsFolder(): string | undefined {
    const doc = vscode.window.activeTextEditor?.document;
    const starts = [...(doc?.uri.scheme === 'file' ? [path.dirname(doc.fileName)] : []), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)];
    for (const start of starts) {
        let dir = start;
        while (true) {
            if (path.basename(dir) === 'tests' && fs.existsSync(path.join(dir, 'README.md'))) return dir;
            const tests = path.join(dir, 'tests');
            if (fs.existsSync(tests) && fs.statSync(tests).isDirectory()) return tests;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return undefined;
}

function safeList(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

class PhiTasks implements vscode.TaskProvider {
    constructor(private readonly ws: PhiWorkspace) {}

    provideTasks(): vscode.Task[] {
        const doc = vscode.window.activeTextEditor?.document;
        const list: vscode.Task[] = [];
        if (doc?.languageId === 'phi' && doc.uri.scheme === 'file') {
            for (const command of ['build', 'run', 'check'] as const) {
                const task = this.create({ type: 'phi', command, file: doc.fileName });
                if (task) list.push(task);
            }
        }
        const tests = findTestsFolder();
        if (tests) {
            const task = this.create({ type: 'phi', command: 'test', file: tests });
            if (task) list.push(task);
        }
        return list;
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as PhiTaskDefinition;
        return this.create(def, task.scope);
    }

    create(def: PhiTaskDefinition, scope?: vscode.WorkspaceFolder | vscode.TaskScope): vscode.Task | undefined {
        if (!this.ws.compiler) this.ws.refreshToolchain();
        const compiler = this.ws.compiler;
        if (!compiler) return undefined;

        let file = def.file;
        if (!file && def.command !== 'test') {
            const doc = vscode.window.activeTextEditor?.document;
            if (doc?.languageId !== 'phi') return undefined;
            file = doc.fileName;
        }

        // ${file} and other variables are substituted by VS Code when the task runs
        const literal = file && !file.includes('${');
        const cwd = def.command === 'test'
            ? (literal ? path.dirname(file!) : undefined) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            : literal ? path.dirname(file!) : '${fileDirname}';

        const args = [def.command, ...(file ? [file] : []), ...(def.args ?? [])];
        const execution = new vscode.ProcessExecution(compiler, args, { cwd, env: this.ws.environment() as Record<string, string> });
        const name = `${def.command}${file && literal ? ' ' + path.basename(file) : ''}`;
        const task = new vscode.Task(def, scope ?? vscode.TaskScope.Workspace, name, 'phi', execution, ['$phi']);

        if (def.command === 'build') task.group = vscode.TaskGroup.Build;
        if (def.command === 'test') task.group = vscode.TaskGroup.Test;
        task.presentationOptions = def.command === 'run'
            ? { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, focus: true, clear: true }
            : { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: true };
        return task;
    }

    /** Runs a task; with wait, resolves to its exit code when it finishes. */
    async execute(def: PhiTaskDefinition, wait = false): Promise<number | undefined> {
        const task = this.create(def);
        if (!task) return undefined;
        const execution = await vscode.tasks.executeTask(task);
        if (!wait) return undefined;
        return new Promise(resolve => {
            const listener = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === execution) {
                    listener.dispose();
                    resolve(e.exitCode);
                }
            });
        });
    }
}
