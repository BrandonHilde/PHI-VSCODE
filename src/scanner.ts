// A fast, error-tolerant reader for PHI source. The lexer follows the compiler's
// (Compiler/Phi.Compiler/Syntax/Lexer.cs) rules exactly; the structure pass only looks for
// declarations, so it keeps working on code that doesn't compile yet.
//
// Nothing here depends on VS Code, so it can be tested with plain Node.

import { primitiveTypeNames, reservedWords } from './languageData';

export type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'raw' | 'eof';

export interface Token {
    kind: TokenKind;
    text: string;
    start: number;
    end: number;
    /** a line break separates this token from the one before it */
    startsLine: boolean;
}

export interface Comment {
    start: number;
    end: number;
    block: boolean;
    /** the text without the '#' markers */
    body: string;
}

export type SymbolKind =
    | 'class' | 'struct' | 'field' | 'asm'
    | 'method' | 'isr' | 'event'
    | 'const' | 'variable' | 'parameter';

export interface Parameter {
    name: string;
    type: string;
    defaultValue?: string;
}

export interface PhiSymbol {
    name: string;
    kind: SymbolKind;
    /** the class, struct or method it belongs to */
    container?: PhiSymbol;
    /** offsets of the whole declaration */
    start: number;
    end: number;
    /** offsets of the name */
    nameStart: number;
    nameEnd: number;
    /** the declared type of a variable, field, constant or parameter; the base of a class */
    type?: string;
    /** the declaration as written, for hovers */
    signature: string;
    parameters?: Parameter[];
    /** a method that ends with [end: value] */
    returns?: boolean;
    /** comments directly above (or after) the declaration */
    doc?: string;
    children: PhiSymbol[];
}

export interface UseDeclaration {
    /** as written: drivers.vga_text */
    path: string;
    start: number;
    end: number;
    pathStart: number;
    pathEnd: number;
}

export interface FoldingRegion {
    startLine: number;
    endLine: number;
    kind?: 'comment' | 'imports';
}

export interface ScanResult {
    text: string;
    tokens: Token[];
    comments: Comment[];
    /** classes, structs and asm blocks, with their members as children */
    symbols: PhiSymbol[];
    /** every symbol, including members and locals */
    allSymbols: PhiSymbol[];
    uses: UseDeclaration[];
    folding: FoldingRegion[];
    lineStarts: number[];
}

const isLetter = (c: string) => /[\p{L}_]/u.test(c);
const isLetterOrDigit = (c: string) => /[\p{L}\p{N}]/u.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';
const isHex = (c: string) => /[0-9A-Fa-f]/.test(c);
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' || c === ' ' || c === '﻿';

const twoCharPunct = new Set([';;', '++', '--', '**', '//', '%%', '^^', '==', '!=', '<=', '>=', '<<', '>>']);

export function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
}

export function lineOf(lineStarts: number[], offset: number): number {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
}

// ---------------------------------------------------------------------------------------------
// lexer

export function lex(text: string): { tokens: Token[]; comments: Comment[] } {
    const tokens: Token[] = [];
    const comments: Comment[] = [];
    let pos = text.startsWith('﻿') ? 1 : 0;
    let sawNewline = true;

    const peek = (ahead = 0) => (pos + ahead < text.length ? text[pos + ahead] : '\0');

    function skipComment() {
        const start = pos;
        pos++; // '#'

        // a '#' with only whitespace after it on its line opens a block comment
        let scan = pos;
        while (scan < text.length && text[scan] !== '\n' && isSpace(text[scan])) scan++;
        const block = scan >= text.length || text[scan] === '\n';

        if (block) {
            const close = text.indexOf('#', scan);
            if (close < 0) {
                comments.push({ start, end: text.length, block: true, body: text.slice(start + 1) });
                pos = text.length;
                return;
            }
            if (text.slice(start, close).includes('\n')) sawNewline = true;
            pos = close + 1;
            while (pos < text.length && text[pos] !== '\n') pos++; // the closing line may carry a remark
            comments.push({ start, end: pos, block: true, body: text.slice(start + 1, close) });
            return;
        }

        while (pos < text.length && text[pos] !== '\n') pos++;
        comments.push({ start, end: pos, block: false, body: text.slice(start + 1, pos) });
    }

    function make(kind: TokenKind, start: number): Token {
        const token = { kind, text: text.slice(start, pos), start, end: pos, startsLine: sawNewline };
        sawNewline = false;
        return token;
    }

    function next(): Token {
        const start = pos;
        if (pos >= text.length) return make('eof', start);
        const c = text[pos];

        if (isLetter(c)) {
            pos++;
            while (pos < text.length && (isLetterOrDigit(text[pos]) || text[pos] === '_')) pos++;
            return make('ident', start);
        }

        if (isDigit(c)) {
            if (c === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
                pos += 2;
                while (isHex(peek()) || peek() === '_') pos++;
                return make('number', start);
            }
            while (isDigit(peek()) || peek() === '_') pos++;
            if (peek() === 'b' && !isLetterOrDigit(peek(1)) && peek(1) !== '_') pos++;
            else if (peek() === '.' && isDigit(peek(1))) {
                pos++;
                while (isDigit(peek())) pos++;
            }
            return make('number', start);
        }

        if (c === "'") {
            pos++;
            while (pos < text.length) {
                const ch = text[pos++];
                if (ch === '\\' && pos < text.length) { pos++; continue; }
                if (ch === "'" && !isLetterOrDigit(peek())) break;
            }
            return make('string', start);
        }

        const two = text.substr(pos, 2);
        pos += twoCharPunct.has(two) ? 2 : 1;
        return make('punct', start);
    }

    while (true) {
        while (pos < text.length) {
            const c = text[pos];
            if (c === '\n') { sawNewline = true; pos++; }
            else if (isSpace(c)) pos++;
            else if (c === '#') skipComment();
            else break;
        }

        const token = next();
        tokens.push(token);

        // asm.Name { ... } holds raw assembly: capture it untouched
        const n = tokens.length;
        if (token.text === '{' && token.kind === 'punct' && n >= 4
            && tokens[n - 2].kind === 'ident' && tokens[n - 3].text === '.'
            && (tokens[n - 4].text === 'asm' || tokens[n - 4].text === 'arm') && tokens[n - 4].kind === 'ident') {
            const rawStart = pos;
            let depth = 1;
            while (pos < text.length) {
                if (text[pos] === '{') depth++;
                else if (text[pos] === '}' && --depth === 0) break;
                pos++;
            }
            tokens.push({ kind: 'raw', text: text.slice(rawStart, pos), start: rawStart, end: pos, startsLine: false });
        }

        if (token.kind === 'eof') return { tokens, comments };
    }
}

// ---------------------------------------------------------------------------------------------
// structure

const primitive = new Set(primitiveTypeNames);
const statementEnders = new Set([';', ';;', '{', '}', ']']);

interface Frame {
    kind: 'class' | 'struct' | 'method' | 'brace';
    symbol?: PhiSymbol;
}

export function scan(text: string): ScanResult {
    const { tokens, comments } = lex(text);
    const lineStarts = computeLineStarts(text);
    const line = (offset: number) => lineOf(lineStarts, offset);

    const symbols: PhiSymbol[] = [];
    const allSymbols: PhiSymbol[] = [];
    const uses: UseDeclaration[] = [];
    const folding: FoldingRegion[] = [];

    const frames: Frame[] = [];
    const controls: number[] = []; // start lines of open if/while/... blocks
    let pendingHeader: PhiSymbol | undefined; // a class or struct waiting for its '{'

    const docs = commentIndex(text, comments, lineStarts);

    const at = (i: number): Token => tokens[Math.min(i, tokens.length - 1)];
    const is = (i: number, text: string) => at(i).text === text && at(i).kind !== 'string' && at(i).kind !== 'raw';
    const isIdent = (i: number) => at(i).kind === 'ident';
    const isName = (i: number) => isIdent(i) && !reservedWords.has(at(i).text);

    const statementStart = (i: number) => i === 0 || at(i).startsLine || statementEnders.has(at(i - 1).text);

    const currentClass = () => [...frames].reverse().find(f => f.kind === 'class')?.symbol;
    const currentMethod = () => {
        const top = frames[frames.length - 1];
        return top?.kind === 'method' ? top.symbol : undefined;
    };

    function add(symbol: PhiSymbol, parent: PhiSymbol | undefined) {
        symbol.container = parent;
        if (symbol.kind !== 'parameter')
            symbol.doc ??= docs.above(line(symbol.start)) ?? docs.trailing(line(symbol.start));
        (parent ? parent.children : symbols).push(symbol);
        allSymbols.push(symbol);
    }

    /** end of the statement that starts at token i: the offset after its ';' (or its line) */
    function statementEnd(i: number): { end: number; next: number } {
        const startLine = line(at(i).start);
        let j = i;
        while (at(j).kind !== 'eof') {
            if (at(j).text === ';' || at(j).text === ']') return { end: at(j).end, next: j };
            if (j > i && at(j).startsLine && line(at(j).start) !== startLine && at(j).text !== ':') return { end: at(j - 1).end, next: j - 1 };
            j++;
        }
        return { end: at(j - 1).end, next: j - 1 };
    }

    /** a type at token i: int, u8, ptr<Task>, Task; returns its text and the token after it */
    function readType(i: number, allowStruct: boolean): { type: string; next: number } | undefined {
        if (is(i, 'ptr') && is(i + 1, '<') && isIdent(i + 2) && is(i + 3, '>'))
            return { type: `ptr<${at(i + 2).text}>`, next: i + 4 };
        if (isIdent(i) && primitive.has(at(i).text)) return { type: at(i).text, next: i + 1 };
        if (allowStruct && isName(i) && /^[A-Z]/.test(at(i).text)) return { type: at(i).text, next: i + 1 };
        return undefined;
    }

    /**
     * A declaration starting at token i: `type name ...;` (or `const type NAME ...;`).
     * Struct-typed declarations (Task t;) are only recognized at the start of a statement.
     */
    function tryDeclaration(i: number, kind: SymbolKind, parent: PhiSymbol | undefined, until?: number): number | undefined {
        let j = i;
        let isConst = false;
        if (is(j, 'const')) { isConst = true; j++; }

        const t = readType(j, true);
        if (!t || !isName(t.next)) return undefined;
        const nameToken = at(t.next);

        // a struct-typed declaration needs something after the name that only a declaration has
        if (!primitive.has(t.type) && !t.type.startsWith('ptr<')) {
            if (!statementStart(i)) return undefined;
            const after = at(t.next + 1).text;
            if (![':', '=', ';', '['].includes(after)) return undefined;
        }

        let end: number;
        let next: number;
        if (until !== undefined) {
            // a parameter: runs to the next ';' inside the method header
            let k = t.next;
            while (k < until && at(k).text !== ';') k++;
            end = at(Math.min(k, until - 1)).end;
            next = k;
        } else {
            ({ end, next } = statementEnd(i));
        }

        const signature = text.slice(at(i).start, end).replace(/\s+/g, ' ').trim();
        const symbol: PhiSymbol = {
            name: nameToken.text,
            kind: isConst ? 'const' : kind,
            start: at(i).start,
            end,
            nameStart: nameToken.start,
            nameEnd: nameToken.end,
            type: t.type,
            signature: signature.endsWith(';') || kind === 'parameter' ? signature : signature + ';',
            children: [],
        };
        add(symbol, parent);
        return next;
    }

    function openMethod(i: number): number {
        const open = at(i);
        // find the closing ']'
        let close = i + 1;
        while (at(close).kind !== 'eof' && at(close).text !== ']') close++;

        // a method still open (missing [end]) ends here
        if (currentMethod()) closeMethod(open.start, false);

        let symbol: PhiSymbol | undefined;
        const header = text.slice(open.start, at(close).end);

        if (is(i + 1, 'isr') && isIdent(i + 2)) {
            symbol = method('isr', at(i + 2));
        } else if (isIdent(i + 1) && is(i + 2, '.') && isIdent(i + 3)) {
            const name = `${at(i + 1).text}.${at(i + 3).text}`;
            symbol = method('event', at(i + 1), name, at(i + 3).end);
        } else if (isIdent(i + 1)) {
            symbol = method('method', at(i + 1));
            symbol.parameters = [];
            if (is(i + 2, ':')) {
                let k = i + 3;
                while (k < close) {
                    const next = tryDeclaration(k, 'parameter', symbol, close);
                    if (next === undefined) { k++; continue; }
                    const p = symbol.children[symbol.children.length - 1];
                    const valueAt = text.indexOf(':', p.nameEnd);
                    const defaultValue = valueAt >= 0 && valueAt < p.end ? text.slice(valueAt + 1, p.end).replace(/;$/, '').trim() : undefined;
                    symbol.parameters.push({ name: p.name, type: p.type ?? 'int', defaultValue: defaultValue || undefined });
                    k = next + 1;
                }
            }
        }

        if (symbol) {
            symbol.signature = header.replace(/\s+/g, ' ');
            frames.push({ kind: 'method', symbol });
        }
        return close;

        function method(kind: SymbolKind, nameToken: Token, name = nameToken.text, nameEnd = nameToken.end): PhiSymbol {
            const s: PhiSymbol = {
                name, kind, start: open.start, end: at(close).end,
                nameStart: nameToken.start, nameEnd, signature: '', children: [],
            };
            add(s, currentClass());
            return s;
        }
    }

    function closeMethod(end: number, returns: boolean) {
        const top = frames[frames.length - 1];
        if (top?.kind !== 'method' || !top.symbol) return;
        frames.pop();
        const m = top.symbol;
        m.end = end;
        m.returns = returns;
        fold(line(m.start), line(end) - 1);
    }

    function fold(startLine: number, endLine: number, kind?: FoldingRegion['kind']) {
        if (endLine > startLine) folding.push({ startLine, endLine, kind });
    }

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === 'eof') break;
        if (t.kind === 'string' || t.kind === 'number') continue;

        const top = frames[frames.length - 1];

        // use a.b;
        if (t.text === 'use' && t.kind === 'ident' && isIdent(i + 1)) {
            let j = i + 1;
            while (is(j + 1, '.') && isIdent(j + 2)) j += 2;
            const semicolon = is(j + 1, ';') ? j + 1 : j;
            uses.push({
                path: text.slice(at(i + 1).start, at(j).end).replace(/\s+/g, ''),
                start: t.start, end: at(semicolon).end,
                pathStart: at(i + 1).start, pathEnd: at(j).end,
            });
            i = semicolon;
            continue;
        }

        // phi.Name:Base
        if (t.text === 'phi' && is(i + 1, '.') && isIdent(i + 2)) {
            const name = at(i + 2);
            const base = is(i + 3, ':') && isIdent(i + 4) ? at(i + 4).text : undefined;
            pendingHeader = {
                name: name.text, kind: 'class', start: t.start, end: name.end,
                nameStart: name.start, nameEnd: name.end, type: base,
                signature: `phi.${name.text}${base ? ':' + base : ''}`, children: [],
            };
            add(pendingHeader, undefined);
            i = base ? i + 4 : i + 2;
            continue;
        }

        // struct.Name
        if (t.text === 'struct' && is(i + 1, '.') && isIdent(i + 2)) {
            const name = at(i + 2);
            pendingHeader = {
                name: name.text, kind: 'struct', start: t.start, end: name.end,
                nameStart: name.start, nameEnd: name.end, signature: `struct.${name.text}`, children: [],
            };
            add(pendingHeader, undefined);
            i += 2;
            continue;
        }

        // asm.Name { raw }
        if ((t.text === 'asm' || t.text === 'arm') && is(i + 1, '.') && isIdent(i + 2) && is(i + 3, '{')) {
            const name = at(i + 2);
            const close = at(i + 4).kind === 'raw' ? i + 5 : i + 4;
            const end = is(close, '}') ? at(close).end : at(close).start;
            add({
                name: name.text, kind: 'asm', start: t.start, end,
                nameStart: name.start, nameEnd: name.end, signature: `${t.text}.${name.text}`, children: [],
            }, undefined);
            fold(line(t.start), line(end) - 1);
            i = is(close, '}') ? close : close - 1;
            continue;
        }

        if (t.text === '{' && t.kind === 'punct') {
            if (pendingHeader) {
                frames.push({ kind: pendingHeader.kind === 'class' ? 'class' : 'struct', symbol: pendingHeader });
                pendingHeader = undefined;
            } else {
                frames.push({ kind: 'brace' });
            }
            continue;
        }

        if (t.text === '}' && t.kind === 'punct') {
            // an unclosed method ends with its class
            while (frames.length && frames[frames.length - 1].kind === 'method') closeMethod(t.start, false);
            const frame = frames.pop();
            if (frame?.symbol) {
                frame.symbol.end = t.end;
                fold(line(frame.symbol.start), line(t.start) - 1);
            }
            controls.length = 0;
            continue;
        }

        // struct fields
        if (top?.kind === 'struct') {
            const next = tryDeclaration(i, 'field', top.symbol);
            if (next !== undefined) i = next;
            continue;
        }

        // method headers and [end]
        if (t.text === '[' && t.kind === 'punct' && statementStart(i) && (top?.kind === 'class' || top?.kind === 'method')) {
            if (is(i + 1, 'end')) {
                let close = i + 1;
                while (at(close).kind !== 'eof' && at(close).text !== ']') close++;
                closeMethod(at(close).end, is(i + 2, ':'));
                i = close;
            } else {
                i = openMethod(i);
            }
            continue;
        }

        // control blocks, for folding
        if (t.kind === 'ident' && ['if', 'elif', 'else', 'while', 'unsafe'].includes(t.text) && statementStart(i)) {
            controls.push(line(t.start));
            if (t.text === 'while') {
                // while int i: 0; ...  declares a loop counter
                const next = tryDeclaration(i + 1, 'variable', currentMethod() ?? currentClass());
                if (next !== undefined) i = next;
            }
            continue;
        }

        if (t.text === ';;' && t.kind === 'punct') {
            const start = controls.pop();
            if (start !== undefined) fold(start, line(t.start) - 1);
            continue;
        }

        // declarations in a class or method
        if (top?.kind === 'class' || top?.kind === 'method' || (!top && t.text === 'const')) {
            if (at(i - 1).text === 'new' || at(i - 1).text === '.') continue;
            const next = tryDeclaration(i, 'variable', currentMethod() ?? currentClass());
            if (next !== undefined) i = next;
        }
    }

    // methods or classes left open at the end of the file
    for (const frame of frames.reverse()) {
        if (frame.symbol) frame.symbol.end = text.length;
    }

    // comments: block comments and runs of line comments fold
    for (let c = 0; c < comments.length; c++) {
        const comment = comments[c];
        if (comment.block) { fold(line(comment.start), line(comment.end), 'comment'); continue; }
        let last = c;
        while (last + 1 < comments.length && !comments[last + 1].block
               && line(comments[last + 1].start) === line(comments[last].start) + 1
               && docs.isFullLine(comments[last + 1])) last++;
        if (last > c && docs.isFullLine(comment)) fold(line(comment.start), line(comments[last].start), 'comment');
        c = last;
    }

    if (uses.length > 1) {
        const first = line(uses[0].start);
        const lastUse = line(uses[uses.length - 1].start);
        if (lastUse - first === uses.length - 1) fold(first, lastUse, 'imports');
    }

    return { text, tokens, comments, symbols, allSymbols, uses, folding, lineStarts };
}

/** Comments indexed by line, to attach them to the declarations they describe. */
function commentIndex(text: string, comments: Comment[], lineStarts: number[]) {
    const fullLine = new Map<number, Comment>(); // last line of a comment that has no code before it
    const trailing = new Map<number, Comment>();

    const isFullLine = (c: Comment) => text.slice(lineStarts[lineOf(lineStarts, c.start)], c.start).trim() === '';
    const clean = (body: string) => body.replace(/^ ?/gm, '').trim();

    for (const c of comments) {
        if (isFullLine(c)) fullLine.set(lineOf(lineStarts, c.end), c);
        else trailing.set(lineOf(lineStarts, c.start), c);
    }

    return {
        isFullLine,
        above(declLine: number): string | undefined {
            const parts: string[] = [];
            let l = declLine - 1;
            while (fullLine.has(l)) {
                const c = fullLine.get(l)!;
                parts.unshift(c.block ? clean(c.body.split('\n').map(s => s.trim()).join('\n')) : clean(c.body));
                if (c.block) break;
                l = lineOf(lineStarts, c.start) - 1;
            }
            const doc = parts.join('\n').trim();
            return doc || undefined;
        },
        trailing(declLine: number): string | undefined {
            const c = trailing.get(declLine);
            return c ? clean(c.body) || undefined : undefined;
        },
    };
}

// ---------------------------------------------------------------------------------------------
// queries

/** The innermost symbol of the given kinds whose range contains offset. */
export function symbolAt(result: ScanResult, offset: number, kinds: SymbolKind[]): PhiSymbol | undefined {
    let best: PhiSymbol | undefined;
    for (const s of result.allSymbols) {
        if (kinds.includes(s.kind) && s.start <= offset && offset <= s.end) {
            if (!best || s.start >= best.start) best = s;
        }
    }
    return best;
}

/** The token containing offset (or ending exactly at it). */
export function tokenAt(result: ScanResult, offset: number): { token: Token; index: number } | undefined {
    const tokens = result.tokens;
    let lo = 0, hi = tokens.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = tokens[mid];
        if (offset < t.start) hi = mid - 1;
        else if (offset > t.end) lo = mid + 1;
        else {
            // prefer an identifier when offset sits between two tokens
            if (offset === t.end && mid + 1 < tokens.length && tokens[mid + 1].start === offset && tokens[mid + 1].kind === 'ident')
                return { token: tokens[mid + 1], index: mid + 1 };
            return { token: t, index: mid };
        }
    }
    return undefined;
}

export function isInCommentOrString(result: ScanResult, offset: number): boolean {
    for (const c of result.comments) if (offset > c.start && offset <= c.end) return true;
    const hit = tokenAt(result, offset);
    return !!hit && hit.token.kind === 'string' && offset > hit.token.start && offset < hit.token.end;
}

/**
 * A reference at offset: the identifier under it, plus the name before a '.', if any
 * (Vga.Print, OS.Sleep, task.id).
 */
export function referenceAt(result: ScanResult, offset: number): { name: string; qualifier?: string; start: number; end: number; index: number } | undefined {
    const hit = tokenAt(result, offset);
    if (!hit || hit.token.kind !== 'ident') return undefined;
    const { token, index } = hit;
    const tokens = result.tokens;
    let qualifier: string | undefined;
    if (index >= 2 && tokens[index - 1].text === '.' && tokens[index - 1].kind === 'punct') {
        const q = tokens[index - 2];
        qualifier = q.kind === 'ident' ? q.text : q.text === ']' || q.kind === 'number' ? '' : undefined;
    }
    return { name: token.text, qualifier, start: token.start, end: token.end, index };
}

/**
 * Where offset is inside the arguments of a `call Name: ...` statement: the method name and
 * which argument the cursor is on. Arguments are separated by spaces, and a binary operator
 * joins its neighbours into one argument.
 */
export function callContextAt(result: ScanResult, offset: number): { name: string; qualifier?: string; argument: number } | undefined {
    const tokens = result.tokens;
    // the last token that starts before offset
    let i = tokens.findIndex(t => t.start >= offset) - 1;
    if (i < -1) i = tokens.length - 2;
    if (i < 0) return undefined;

    // walk back to the start of the statement
    let start = i;
    while (start > 0) {
        const t = tokens[start];
        if (t.kind === 'punct' && (t.text === ';' || t.text === ';;' || t.text === '{' || t.text === '}')) {
            if (start === i && t.end <= offset && t.text === ';') return undefined; // just after the end
            start++;
            break;
        }
        if (t.kind === 'ident' && t.text === 'call') break;
        start--;
    }
    if (tokens[start]?.text !== 'call') return undefined;

    // call [target is] [Q.]Name: args
    let j = start + 1;
    for (let k = j; k < Math.min(j + 8, tokens.length) && tokens[k].start < offset; k++) {
        if ((tokens[k].text === 'is' || tokens[k].text === '=') && tokens[k].kind !== 'string') { j = k + 1; break; }
        if (tokens[k].text === ':' && k + 1 < tokens.length && /^[A-Z]/.test(tokens[k - 1]?.text ?? '')) break;
    }

    let qualifier: string | undefined;
    if (tokens[j]?.kind !== 'ident') return undefined;
    let name = tokens[j].text;
    if (tokens[j + 1]?.text === '.' && tokens[j + 2]?.kind === 'ident') {
        qualifier = name;
        name = tokens[j + 2].text;
        j += 2;
    }
    if (tokens[j + 1]?.text !== ':' || tokens[j + 1].end > offset) return undefined;

    // count arguments between the ':' and offset
    const binary = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '>', '<=', '>=', ':', '.',
                            'and', 'or', 'is', 'below', 'above', 'atmost', 'atleast']);
    const prefix = new Set(['-', '~', '!', 'not', 'addr', 'in', 'inw', 'ind', 'new']);
    let argument = 0;
    let expectOperand = true;
    let seenAny = false;

    for (let k = j + 2; k < tokens.length && tokens[k].start < offset; k++) {
        const t = tokens[k];
        if (t.kind === 'eof') break;
        const word = t.kind === 'string' ? '' : t.text;

        if (!expectOperand && binary.has(word)) {
            if (word === 'not' && tokens[k - 1]?.text === 'is') continue;
            expectOperand = true;
            continue;
        }
        if (prefix.has(word)) {
            // after a complete argument, a prefix operator (addr x, not x, ~x) starts the next one
            if (!expectOperand && word !== '-') argument++;
            expectOperand = true;
            continue;
        }

        if (!expectOperand) argument++; // a new operand after a complete one starts the next argument
        seenAny = true;
        expectOperand = false;

        if (word === '(') {
            let depth = 1;
            while (++k < tokens.length && tokens[k].start < offset && depth > 0) {
                if (tokens[k].text === '(') depth++;
                else if (tokens[k].text === ')') depth--;
            }
            if (depth > 0) return { name, qualifier, argument };
            k--;
        }
        if (word === 'ptr' && tokens[k + 1]?.text === '<') k += 3;
    }

    // whitespace after a complete argument means the cursor is on the next one
    const last = tokens.slice(0, tokens.findIndex(t => t.start >= offset) === -1 ? tokens.length : tokens.findIndex(t => t.start >= offset)).pop();
    if (seenAny && !expectOperand && last && last.end < offset) argument++;

    return { name, qualifier, argument };
}
