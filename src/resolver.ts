// Works out what a name at a position refers to. Follows the compiler's lookup order: the
// current method, the current class, then other classes; `Class.name` picks a class.
// No VS Code dependency.

import { BuiltinColor, BuiltinFunction, BuiltinHook, builtinColors, builtinFunctions, builtinHooks } from './builtins.generated';
import { classBases, reservedWords } from './languageData';
import { PhiSymbol, ScanResult, referenceAt, symbolAt } from './scanner';

export interface FileScan {
    file: string;
    result: ScanResult;
}

export interface Target {
    file: string;
    symbol: PhiSymbol;
}

export type Resolution =
    | { kind: 'symbols'; targets: Target[]; start: number; end: number }
    | { kind: 'builtin'; fn: BuiltinFunction; start: number; end: number }
    | { kind: 'hook'; hook: BuiltinHook; start: number; end: number }
    | { kind: 'color'; color: BuiltinColor; start: number; end: number }
    | { kind: 'keyword'; word: string; start: number; end: number }
    | { kind: 'base'; base: string; start: number; end: number }
    | { kind: 'use'; path: string; target?: string; start: number; end: number };

const builtinByName = new Map<string, BuiltinFunction>();
for (const fn of builtinFunctions) {
    builtinByName.set(fn.name, fn);
    for (const alias of fn.aliases) builtinByName.set(alias, fn);
}

export function findBuiltin(qualifier: string, name: string): BuiltinFunction | undefined {
    return builtinByName.get(`${qualifier}.${name}`);
}

const memberKinds = new Set(['method', 'isr', 'event', 'variable', 'const']);
const topKinds = new Set(['class', 'struct', 'asm']);

/** Class-level members: methods, variables and constants declared directly in a class. */
export function isMember(s: PhiSymbol): boolean {
    return memberKinds.has(s.kind) && s.container?.kind === 'class';
}

function topLevel(scans: FileScan[], name: string, kinds = topKinds): Target[] {
    const out: Target[] = [];
    for (const { file, result } of scans)
        for (const s of result.symbols) if (s.name === name && kinds.has(s.kind)) out.push({ file, symbol: s });
    return out;
}

function members(scans: FileScan[], name: string, className?: string): Target[] {
    const out: Target[] = [];
    for (const { file, result } of scans)
        for (const s of result.allSymbols)
            if (s.name === name && isMember(s) && (!className || s.container!.name === className)) out.push({ file, symbol: s });
    return out;
}

function fields(scans: FileScan[], name: string, structName?: string): Target[] {
    const out: Target[] = [];
    for (const { file, result } of scans)
        for (const s of result.allSymbols)
            if (s.kind === 'field' && s.name === name && (!structName || s.container?.name === structName)) out.push({ file, symbol: s });
    return out;
}

/** The struct a variable's type names: Task, ptr<Task> → Task */
export function structOf(type: string | undefined): string | undefined {
    if (!type) return undefined;
    const m = /^ptr<(\w+)>$/.exec(type);
    const name = m ? m[1] : type;
    return /^[A-Z]/.test(name) ? name : undefined;
}

/** Variables, parameters and constants visible at offset in the current file, innermost first. */
export function visibleLocals(current: FileScan, offset: number): PhiSymbol[] {
    const out: PhiSymbol[] = [];
    const method = symbolAt(current.result, offset, ['method', 'isr', 'event']);
    if (method) out.push(...method.children);
    const cls = symbolAt(current.result, offset, ['class']);
    if (cls) out.push(...cls.children);
    return out;
}

function dedupe(targets: Target[]): Target[] {
    const seen = new Set<string>();
    return targets.filter(t => {
        const key = `${t.file}#${t.symbol.nameStart}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * @param current the file the position is in
 * @param related files whose symbols are visible: the `use` closure first, then the workspace
 * @param resolveUse maps `use a.b` to a file
 */
export function resolveAt(current: FileScan, offset: number, related: FileScan[], resolveUse: (dotted: string) => string | undefined): Resolution | undefined {
    const { result } = current;
    const all = [current, ...related.filter(r => r.file !== current.file)];

    for (const u of result.uses) {
        if (offset >= u.pathStart && offset <= u.pathEnd) return { kind: 'use', path: u.path, target: resolveUse(u.path), start: u.pathStart, end: u.pathEnd };
    }

    const ref = referenceAt(result, offset);
    if (!ref) return undefined;
    const { name, qualifier, start, end, index } = ref;
    const tokens = result.tokens;
    const span = { start, end };

    // phi.Name:Base
    if (index >= 4 && tokens[index - 1].text === ':' && tokens[index - 3].text === '.' && tokens[index - 4].text === 'phi' && classBases[name])
        return { kind: 'base', base: name, ...span };

    if (qualifier === 'OS' || qualifier === 'Bootloader') {
        const hook = builtinHooks.find(h => h.name === `${qualifier}.${name}`);
        if (hook) return { kind: 'hook', hook, ...span };
        const fn = findBuiltin(qualifier, name);
        return fn ? { kind: 'builtin', fn, ...span } : undefined;
    }

    if (qualifier === 'Colors') {
        const color = builtinColors.find(c => c.name === name);
        return color ? { kind: 'color', color, ...span } : undefined;
    }

    if (qualifier === 'asm' || qualifier === 'arm') {
        return wrap(topLevel(all, name, new Set(['asm'])));
    }

    if (qualifier !== undefined) {
        // Class.member
        if (qualifier && topLevel(all, qualifier, new Set(['class'])).length) {
            if (name === 'len') return { kind: 'keyword', word: 'len', ...span };
            return wrap(members(all, name, qualifier));
        }
        if (name === 'len') return { kind: 'keyword', word: 'len', ...span };

        // variable.field: use the variable's struct type when it's known
        if (qualifier) {
            const variable = lookupUnqualified(qualifier, false)[0];
            const struct = structOf(variable?.symbol.type);
            if (struct) {
                const typed = fields(all, name, struct);
                if (typed.length) return wrap(typed);
            }
        } else {
            // x:i.field or (expr).field: find the struct through the indexed variable when possible
            const base = indexedVariable(index - 2);
            const struct = base ? structOf(lookupUnqualified(base, false)[0]?.symbol.type) : undefined;
            if (struct) {
                const typed = fields(all, name, struct);
                if (typed.length) return wrap(typed);
            }
        }
        const any = fields(all, name);
        if (any.length) return wrap(any);
    }

    if (reservedWords.has(name) || name === 'len') return { kind: 'keyword', word: name, ...span };

    // the OS / Bootloader / Colors prefixes themselves
    if (name === 'OS' || name === 'Bootloader' || name === 'Colors') return { kind: 'keyword', word: name, ...span };

    return wrap(lookupUnqualified(name, true));

    function wrap(targets: Target[]): Resolution | undefined {
        const unique = dedupe(targets);
        return unique.length ? { kind: 'symbols', targets: unique, ...span } : undefined;
    }

    /** for `list:i.field`, the name of `list` (index points at the token before the '.') */
    function indexedVariable(i: number): string | undefined {
        // skip back over the index: a number, a name or a parenthesized expression
        if (i >= 0 && tokens[i].text === ')') {
            let depth = 1;
            while (--i >= 0 && depth > 0) {
                if (tokens[i].text === ')') depth++;
                else if (tokens[i].text === '(') depth--;
            }
        } else {
            i--;
        }
        if (i >= 1 && tokens[i].text === ':' && tokens[i - 1].kind === 'ident') return tokens[i - 1].text;
        return undefined;
    }

    function lookupUnqualified(word: string, includeFields: boolean): Target[] {
        // 1. the current method, then the current class (variables have fixed places, so a
        //    name can be used before its declaration)
        const method = symbolAt(result, offset, ['method', 'isr', 'event']);
        const cls = symbolAt(result, offset, ['class']);
        for (const scope of [method, cls]) {
            const own = scope?.children.filter(s => s.name === word) ?? [];
            if (own.length) return own.map(symbol => ({ file: current.file, symbol }));
        }
        // 2. classes, structs and asm blocks
        const tops = topLevel(all, word);
        if (tops.length) return tops;
        // 3. members of other classes
        const others = members(all, word);
        if (others.length) return others;
        // 4. top-level constants
        const consts: Target[] = [];
        for (const { file, result: r } of all)
            for (const s of r.symbols) if (s.kind === 'const' && s.name === word) consts.push({ file, symbol: s });
        if (consts.length) return consts;
        // 5. struct fields (inside a struct, or as a last resort)
        return includeFields ? fields(all, word) : [];
    }
}

/** True when two targets are the same declaration. */
export function sameTarget(a: Target, b: Target, normalize: (file: string) => string = f => f): boolean {
    return normalize(a.file) === normalize(b.file) && a.symbol.nameStart === b.symbol.nameStart;
}
