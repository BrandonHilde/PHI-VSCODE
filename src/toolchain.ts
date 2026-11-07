// Finding and running the phi compiler. No VS Code dependency, so it can be tested with Node.

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const exe = process.platform === 'win32' ? 'phi.exe' : 'phi';

export interface CompilerDiagnostic {
    /** as printed by the compiler: absolute, relative to the check's folder, or lib/phi/... */
    file?: string;
    /** 1-based; undefined for problems that aren't tied to a place */
    line?: number;
    column?: number;
    severity: 'error' | 'warning';
    message: string;
}

const located = /^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.*)$/;
const unlocated = /^(error|warning):\s+(.*)$/;

/** Parses `file:line:col: error: message` lines (and plain `error: message` lines). */
export function parseDiagnostics(output: string): CompilerDiagnostic[] {
    const result: CompilerDiagnostic[] = [];
    for (const raw of output.split(/\r?\n/)) {
        const lineText = raw.trimEnd();
        let m = located.exec(lineText);
        if (m) {
            result.push({ file: m[1], line: +m[2], column: +m[3], severity: m[4] as 'error' | 'warning', message: m[5] });
            continue;
        }
        m = unlocated.exec(lineText);
        if (m) result.push({ severity: m[1] as 'error' | 'warning', message: m[2] });
    }
    return result;
}

function isFile(p: string): boolean {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDirectory(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function* ancestors(dir: string): Generator<string> {
    let current = path.resolve(dir);
    while (true) {
        yield current;
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
    }
}

function expandHome(p: string): string {
    return p.startsWith('~') ? path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(1)) : p;
}

/**
 * The compiler to use: the configured path, then `phi` on PATH, then a build of the compiler
 * inside one of the search folders or their parents (Compiler/Phi.Cli/bin/<config>/net10.0).
 */
export function findCompiler(configured: string | undefined, searchDirs: string[]): string | undefined {
    if (configured && configured.trim()) {
        const p = expandHome(configured.trim());
        if (isFile(p)) return p;
        if (isDirectory(p) && isFile(path.join(p, exe))) return path.join(p, exe);
        return undefined;
    }

    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (dir && isFile(path.join(dir, exe))) return path.join(dir, exe);
    }

    const seen = new Set<string>();
    for (const start of searchDirs) {
        for (const dir of ancestors(start)) {
            if (seen.has(dir)) break;
            seen.add(dir);
            const found = newestBuild(path.join(dir, 'Compiler', 'Phi.Cli', 'bin'));
            if (found) return found;
        }
    }
    return undefined;
}

/** The most recently built phi executable under bin/<config>/<framework>/ */
function newestBuild(bin: string): string | undefined {
    if (!isDirectory(bin)) return undefined;
    let best: { file: string; time: number } | undefined;
    for (const config of safeReaddir(bin)) {
        for (const framework of safeReaddir(path.join(bin, config))) {
            const file = path.join(bin, config, framework, exe);
            if (!isFile(file)) continue;
            const time = fs.statSync(file).mtimeMs;
            if (!best || time > best.time) best = { file, time };
        }
    }
    return best?.file;
}

function safeReaddir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

/** The standard library folder (lib/phi): configured, next to the compiler's repository, or in a search folder. */
export function findLibrary(configured: string | undefined, compiler: string | undefined, searchDirs: string[]): string | undefined {
    if (configured && configured.trim()) {
        const p = expandHome(configured.trim());
        return isDirectory(p) ? p : undefined;
    }
    const starts = [...(compiler ? [path.dirname(compiler)] : []), ...searchDirs];
    for (const start of starts) {
        for (const dir of ancestors(start)) {
            const lib = path.join(dir, 'lib', 'phi');
            if (isDirectory(lib) && isDirectory(path.join(lib, 'drivers'))) return lib;
        }
    }
    return undefined;
}

/**
 * Resolves `use a.b;` written in `fromFile` the way the compiler does: next to that file, next
 * to the main program, then in the standard library.
 */
export function resolveUse(dotted: string, fromFile: string, library: string | undefined, mainFile?: string): string | undefined {
    const relative = dotted.split('.').join(path.sep) + '.phi';
    for (const near of [fromFile, mainFile]) {
        if (!near || (library && isInside(near, library))) continue;
        const local = path.join(path.dirname(near), relative);
        if (isFile(local)) return local;
    }
    if (library) {
        const lib = path.join(library, relative);
        if (isFile(lib)) return lib;
    }
    return undefined;
}

export function isInside(file: string, dir: string): boolean {
    const rel = path.relative(dir, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Maps a path printed by the compiler to a file on disk. */
export function resolveDiagnosticPath(printed: string, cwd: string, library: string | undefined): string | undefined {
    const normalized = printed.replace(/\\/g, '/');
    if (normalized.startsWith('lib/phi/')) {
        return library ? path.join(library, normalized.slice('lib/phi/'.length)) : undefined;
    }
    return path.resolve(cwd, printed);
}

export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    /** the process couldn't be started (for example, the compiler path is wrong) */
    spawnError?: Error;
}

export function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal }): Promise<RunResult> {
    return new Promise(resolve => {
        cp.execFile(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            timeout: options.timeoutMs ?? 30000,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
            signal: options.signal,
        }, (error, stdout, stderr) => {
            const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
            if (err && typeof err.code === 'string') {
                resolve({ code: null, stdout: String(stdout), stderr: String(stderr), spawnError: err });
                return;
            }
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

/** Runs `phi check` on a file and returns what it reported. */
export async function check(compiler: string, file: string, options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): Promise<RunResult & { diagnostics: CompilerDiagnostic[] }> {
    const result = await run(compiler, ['check', file], { cwd: path.dirname(file), env: options.env, signal: options.signal });
    return { ...result, diagnostics: result.spawnError ? [] : parseDiagnostics(result.stderr + '\n' + result.stdout) };
}
