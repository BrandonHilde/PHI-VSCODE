// Hovers, go to definition, references, rename, completion, signature help, outline and folding.

import * as path from 'path';
import * as vscode from 'vscode';
import { BuiltinFunction, builtinColors, builtinFunctions, builtinHooks } from './builtins.generated';
import { PhiServer } from './languageServer';
import { classBases, keywords, primitiveTypes, standardLibrary } from './languageData';
import { FileScan, Resolution, Target, findBuiltin, isMember, resolveAt, sameTarget, structOf, visibleLocals } from './resolver';
import { PhiSymbol, ScanResult, callContextAt, isInCommentOrString, lineOf, symbolAt } from './scanner';
import { PhiWorkspace, scanResultOf } from './workspace';

const selector: vscode.DocumentSelector = [{ language: 'phi' }];

export function registerFeatures(context: vscode.ExtensionContext, ws: PhiWorkspace, server: PhiServer) {
    const features = new Features(ws, server);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(selector, features),
        vscode.languages.registerDefinitionProvider(selector, features),
        vscode.languages.registerReferenceProvider(selector, features),
        vscode.languages.registerDocumentHighlightProvider(selector, features),
        vscode.languages.registerRenameProvider(selector, features),
        vscode.languages.registerDocumentSymbolProvider(selector, features, { label: 'PHI' }),
        vscode.languages.registerWorkspaceSymbolProvider(features),
        vscode.languages.registerFoldingRangeProvider(selector, features),
        vscode.languages.registerCompletionItemProvider(selector, features, '.', ' ', '['),
        vscode.languages.registerSignatureHelpProvider(selector, features, { triggerCharacters: [':', ' '], retriggerCharacters: [' '] }),
    );
}

// ---------------------------------------------------------------------------------------------

function toRange(result: ScanResult, start: number, end: number): vscode.Range {
    const pos = (offset: number) => {
        const line = lineOf(result.lineStarts, offset);
        return new vscode.Position(line, offset - result.lineStarts[line]);
    };
    return new vscode.Range(pos(start), pos(end));
}

function scanOf(target: Target): ScanResult {
    return scanResultOf(target.symbol)!;
}

const kindLabel: Record<string, string> = {
    class: 'class', struct: 'struct', field: 'field', asm: 'asm block', method: 'method', isr: 'interrupt handler',
    event: 'event', const: 'constant', variable: 'variable', parameter: 'parameter',
};

function describeContainer(s: PhiSymbol): string {
    const c = s.container;
    if (!c) return '';
    switch (s.kind) {
        case 'field': return `field of struct \`${c.name}\``;
        case 'parameter': return `parameter of \`${c.name}\``;
        case 'variable':
        case 'const':
            return c.kind === 'class' ? `${kindLabel[s.kind]} in class \`${c.name}\`` : `local ${kindLabel[s.kind]} in \`${c.name}\``;
        default: return `${kindLabel[s.kind]} in class \`${c.name}\``;
    }
}

function builtinSignature(fn: BuiltinFunction): string {
    const params = fn.parameters.length ? ': ' + fn.parameters.join(' ') : '';
    return `call ${fn.returns ? 'result is ' : ''}${fn.name}${params};`;
}

function builtinMarkdown(fn: BuiltinFunction): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendCodeblock(builtinSignature(fn), 'phi');
    md.appendMarkdown(fn.description.replace(/^(32-bit|program|kernel): /, ''));
    const where = /^(32-bit|program|kernel):/.exec(fn.description)?.[1];
    const notes: string[] = [];
    if (fn.returns) notes.push('Returns a value.');
    if (fn.onlyIn === 'Boot') notes.push('Only in the boot sector (`Bootloader` class).');
    else if (where === '32-bit') notes.push('32-bit kernels and programs.');
    else if (where === 'program') notes.push('User programs.');
    else if (where === 'kernel') notes.push('32-bit kernels.');
    if (fn.textParameters.length) notes.push(`Text arguments: ${fn.textParameters.map(i => '`' + fn.parameters[i] + '`').join(', ')}.`);
    if (fn.aliases.length) notes.push(`Also written ${fn.aliases.map(a => '`' + a + '`').join(', ')}.`);
    if (notes.length) md.appendMarkdown('\n\n' + notes.join(' '));
    return md;
}

function symbolMarkdown(target: Target, ws: PhiWorkspace): vscode.MarkdownString {
    const s = target.symbol;
    const md = new vscode.MarkdownString();
    md.appendCodeblock(s.signature, 'phi');
    const lines: string[] = [];
    const container = describeContainer(s);
    if (s.kind === 'class' && s.type && classBases[s.type]) lines.push(`*${s.type}*: ${classBases[s.type]}`);
    else if (container) lines.push(container[0].toUpperCase() + container.slice(1));
    if (s.kind === 'method') lines.push(s.returns ? 'Returns a value (`[end: value]`).' : 'Returns nothing.');
    if (s.kind === 'asm') lines.push('Assembly block. `call x is ' + s.name + ';` stores what it leaves in `eax`.');
    if (lines.length) md.appendMarkdown(lines.join(' · '));
    if (s.doc) md.appendMarkdown('\n\n' + s.doc.replace(/\n/g, '  \n'));
    const where = ws.isLibraryFile(target.file) ? `lib/phi/${path.relative(ws.library!, target.file).replace(/\\/g, '/')}` : vscode.workspace.asRelativePath(target.file);
    md.appendMarkdown(`\n\n*${where}*`);
    return md;
}

function keywordMarkdown(word: string): vscode.MarkdownString | undefined {
    const info = keywords[word] ?? primitiveTypes[word];
    if (word === 'OS' || word === 'Bootloader') {
        return new vscode.MarkdownString(`**${word}**: built-in functions. Type \`${word}.\` to see them.`);
    }
    if (word === 'Colors') return new vscode.MarkdownString('**Colors**: the 16 VGA text colors, `Colors.Black` … `Colors.White`.');
    if (!info) return undefined;
    const md = new vscode.MarkdownString();
    md.appendCodeblock(info.syntax, 'phi');
    md.appendMarkdown(info.description);
    return md;
}

function symbolKind(s: PhiSymbol): vscode.SymbolKind {
    switch (s.kind) {
        case 'class': return vscode.SymbolKind.Class;
        case 'struct': return vscode.SymbolKind.Struct;
        case 'field': return vscode.SymbolKind.Field;
        case 'asm': return vscode.SymbolKind.Function;
        case 'method': return vscode.SymbolKind.Method;
        case 'isr': return vscode.SymbolKind.Event;
        case 'event': return vscode.SymbolKind.Event;
        case 'const': return vscode.SymbolKind.Constant;
        case 'parameter': return vscode.SymbolKind.TypeParameter;
        default: return vscode.SymbolKind.Variable;
    }
}

function completionKind(s: PhiSymbol): vscode.CompletionItemKind {
    switch (s.kind) {
        case 'class': return vscode.CompletionItemKind.Class;
        case 'struct': return vscode.CompletionItemKind.Struct;
        case 'field': return vscode.CompletionItemKind.Field;
        case 'asm': return vscode.CompletionItemKind.Function;
        case 'method': case 'isr': case 'event': return vscode.CompletionItemKind.Method;
        case 'const': return vscode.CompletionItemKind.Constant;
        default: return vscode.CompletionItemKind.Variable;
    }
}

// ---------------------------------------------------------------------------------------------

class Features implements
    vscode.HoverProvider, vscode.DefinitionProvider, vscode.ReferenceProvider, vscode.DocumentHighlightProvider,
    vscode.RenameProvider, vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider, vscode.FoldingRangeProvider,
    vscode.CompletionItemProvider, vscode.SignatureHelpProvider {

    constructor(private readonly ws: PhiWorkspace, private readonly server: PhiServer) {}

    private current(doc: vscode.TextDocument): FileScan {
        return this.ws.scanDocument(doc);
    }

    /** Resolve with the files `use` makes visible first; fall back to the whole workspace. */
    private async resolve(scan: FileScan, offset: number, closureCache?: Map<string, FileScan[]>): Promise<Resolution | undefined> {
        const key = this.ws.key(scan.file);
        let closure = closureCache?.get(key);
        if (!closure) {
            closure = this.ws.useClosure(scan);
            closureCache?.set(key, closure);
        }
        const resolveUse = (p: string) => this.ws.resolveUse(p, scan.file);
        const first = resolveAt(scan, offset, closure, resolveUse);
        if (first && (first.kind !== 'symbols' || first.targets.length)) return first;
        const everything = [...closure, ...(await this.ws.workspaceScans())];
        return resolveAt(scan, offset, everything, resolveUse);
    }

    // ---- hover

    async provideHover(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const scan = this.current(doc);
        const offset = doc.offsetAt(position);
        if (isInCommentOrString(scan.result, offset)) return undefined;
        const r = await this.resolve(scan, offset);
        if (!r) return undefined;
        const range = toRange(scan.result, r.start, r.end);

        switch (r.kind) {
            case 'symbols': {
                const mds = r.targets.slice(0, 3).map(t => symbolMarkdown(t, this.ws));
                if (r.targets.length > 3) mds.push(new vscode.MarkdownString(`*…and ${r.targets.length - 3} more definitions*`));
                return new vscode.Hover(mds, range);
            }
            case 'builtin': return new vscode.Hover(builtinMarkdown(r.fn), range);
            case 'hook': {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(`[${r.hook.name}]\n    ...\n[end]`, 'phi');
                md.appendMarkdown(`Event: ${r.hook.description}. Every register is saved and restored around it; keep it short.`);
                return new vscode.Hover(md, range);
            }
            case 'color': {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(`Colors.${r.color.name}`, 'phi');
                md.appendMarkdown(`VGA text color **${r.color.value}** (\`0x${r.color.value.toString(16).toUpperCase()}\`).`);
                return new vscode.Hover(md, range);
            }
            case 'keyword': {
                const md = keywordMarkdown(r.word);
                return md ? new vscode.Hover(md, range) : undefined;
            }
            case 'base': return new vscode.Hover(new vscode.MarkdownString(`**${r.base}**: ${classBases[r.base]}`), range);
            case 'use': {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(`use ${r.path};`, 'phi');
                if (r.target) {
                    const lib = this.ws.isLibraryFile(r.target);
                    md.appendMarkdown(lib ? `Standard library: ${standardLibrary[r.path] ?? ''}\n\n*lib/phi/${path.relative(this.ws.library!, r.target).replace(/\\/g, '/')}*` : `*${vscode.workspace.asRelativePath(r.target)}*`);
                } else if (standardLibrary[r.path]) {
                    md.appendMarkdown(`Standard library: ${standardLibrary[r.path]}`);
                } else {
                    md.appendMarkdown(`$(warning) Can't find \`${r.path.replace(/\./g, '/')}.phi\` next to this file or in the standard library.`);
                    md.supportThemeIcons = true;
                }
                return new vscode.Hover(md, range);
            }
        }
    }

    // ---- definitions and references

    async provideDefinition(doc: vscode.TextDocument, position: vscode.Position, token?: vscode.CancellationToken): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
        // the compiler knows; what it doesn't answer for (a {name} in an asm block) is the scanner's
        const known = await this.server.definition(doc, position, token);
        if (known && (!Array.isArray(known) || known.length)) return known;

        const scan = this.current(doc);
        const offset = doc.offsetAt(position);
        if (isInCommentOrString(scan.result, offset)) return undefined;
        const r = await this.resolve(scan, offset);
        if (!r) return undefined;
        const origin = toRange(scan.result, r.start, r.end);
        if (r.kind === 'use' && r.target) {
            const zero = new vscode.Range(0, 0, 0, 0);
            return [{ originSelectionRange: origin, targetUri: vscode.Uri.file(r.target), targetRange: zero, targetSelectionRange: zero }];
        }
        if (r.kind !== 'symbols') return undefined;
        return r.targets.map(t => {
            const result = scanOf(t);
            return {
                originSelectionRange: origin,
                targetUri: vscode.Uri.file(t.file),
                targetRange: toRange(result, t.symbol.start, t.symbol.end),
                targetSelectionRange: toRange(result, t.symbol.nameStart, t.symbol.nameEnd),
            };
        });
    }

    /** Every place a declaration is used, in the files that can see it. */
    private async references(doc: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean, onlyThisFile: boolean, token?: vscode.CancellationToken): Promise<{ targets: Target[]; locations: vscode.Location[] } | undefined> {
        const scan = this.current(doc);
        const r = await this.resolve(scan, doc.offsetAt(position));
        if (!r || r.kind !== 'symbols') return undefined;
        const targets = r.targets;
        const name = targets[0].symbol.name.split('.').pop()!;
        const same = (t: Target) => targets.some(x => sameTarget(x, t, f => this.ws.key(f)));

        let files: FileScan[] = [scan];
        if (!onlyThisFile) {
            const all = new Map<string, FileScan>();
            for (const f of [scan, ...this.ws.useClosure(scan), ...(await this.ws.workspaceScans())]) all.set(this.ws.key(f.file), f);
            // library files that declare a target can refer to it too
            for (const t of targets) { const s = this.ws.scanFile(t.file); if (s) all.set(this.ws.key(s.file), s); }
            files = [...all.values()];
        }

        const locations: vscode.Location[] = [];
        const closures = new Map<string, FileScan[]>();
        for (const file of files) {
            if (token?.isCancellationRequested) return undefined;
            const tokens = file.result.tokens;
            if (!file.result.text.includes(name)) continue;
            for (const t of tokens) {
                if (t.kind === 'ident' && t.text === name) {
                    const res = await this.resolve(file, t.start, closures);
                    if (res?.kind !== 'symbols' || !res.targets.some(same)) continue;
                    const isDecl = targets.some(x => this.ws.sameFile(x.file, file.file) && x.symbol.nameStart === t.start);
                    if (isDecl && !includeDeclaration) continue;
                    locations.push(new vscode.Location(vscode.Uri.file(file.file), toRange(file.result, t.start, t.end)));
                } else if (t.kind === 'raw') {
                    // {name} inside asm blocks refers to a class variable or constant
                    if (!targets.some(x => isMember(x.symbol) && (x.symbol.kind === 'variable' || x.symbol.kind === 'const'))) continue;
                    const re = new RegExp(`\\{\\s*(${name})\\s*[}.]`, 'g');
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(t.text))) {
                        const start = t.start + m.index + m[0].indexOf(name);
                        locations.push(new vscode.Location(vscode.Uri.file(file.file), toRange(file.result, start, start + name.length)));
                    }
                }
            }
        }
        return { targets, locations };
    }

    async provideReferences(doc: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken) {
        return (await this.references(doc, position, context.includeDeclaration, false, token))?.locations;
    }

    async provideDocumentHighlights(doc: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const scan = this.current(doc);
        if (isInCommentOrString(scan.result, doc.offsetAt(position))) return undefined;
        const refs = await this.references(doc, position, true, true, token);
        return refs?.locations.map(l => new vscode.DocumentHighlight(l.range));
    }

    async prepareRename(doc: vscode.TextDocument, position: vscode.Position) {
        const scan = this.current(doc);
        const r = await this.resolve(scan, doc.offsetAt(position));
        if (!r || r.kind !== 'symbols') throw new Error('Only names declared in PHI code can be renamed.');
        if (r.targets.some(t => t.symbol.kind === 'event')) throw new Error('Event handlers are named after their event.');
        return { range: toRange(scan.result, r.start, r.end), placeholder: doc.getText(toRange(scan.result, r.start, r.end)) };
    }

    async provideRenameEdits(doc: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken) {
        if (!/^[A-Za-z_]\w*$/.test(newName)) throw new Error(`'${newName}' isn't a valid PHI name.`);
        const refs = await this.references(doc, position, true, false, token);
        if (!refs) return undefined;
        const edit = new vscode.WorkspaceEdit();
        for (const l of refs.locations) edit.replace(l.uri, l.range, newName);
        return edit;
    }

    // ---- outline, workspace symbols, folding

    provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
        const scan = this.current(doc);
        const convert = (s: PhiSymbol): vscode.DocumentSymbol => {
            const detail = s.kind === 'class' ? s.type ?? ''
                : s.kind === 'method' ? (s.parameters ?? []).map(p => `${p.type} ${p.name}`).join(', ') + (s.returns ? ' → value' : '')
                : s.type ?? '';
            const sym = new vscode.DocumentSymbol(s.name, detail, symbolKind(s), toRange(scan.result, s.start, Math.max(s.end, s.nameEnd)), toRange(scan.result, s.nameStart, s.nameEnd));
            // parameters and method locals would crowd the outline
            sym.children = s.children.filter(c => c.kind !== 'parameter' && !(c.container && ['method', 'isr', 'event'].includes(c.container.kind))).map(convert);
            return sym;
        };
        return scan.result.symbols.map(convert);
    }

    async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        const q = query.toLowerCase();
        const out: vscode.SymbolInformation[] = [];
        for (const scan of await this.ws.workspaceScans()) {
            if (token.isCancellationRequested) break;
            for (const s of scan.result.allSymbols) {
                if (s.kind === 'parameter' || (s.container && ['method', 'isr', 'event'].includes(s.container.kind))) continue;
                if (q && !fuzzy(s.name.toLowerCase(), q)) continue;
                out.push(new vscode.SymbolInformation(s.name, symbolKind(s), s.container?.name ?? '',
                    new vscode.Location(vscode.Uri.file(scan.file), toRange(scan.result, s.nameStart, s.nameEnd))));
            }
        }
        return out;
    }

    provideFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
        const scan = this.current(doc);
        return scan.result.folding.map(f => new vscode.FoldingRange(f.startLine, f.endLine,
            f.kind === 'comment' ? vscode.FoldingRangeKind.Comment : f.kind === 'imports' ? vscode.FoldingRangeKind.Imports : undefined));
    }

    // ---- completion

    /**
     * The compiler says which names can go here, and the scanner knows how to describe them. The
     * words it has lists of itself (use paths, class bases, method headers, OS. and Colors., with
     * their documents and swatches) are its own to answer.
     */
    async provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
        const scanned = await this.scannedCompletions(doc, position, context);
        const before = doc.lineAt(position.line).text.slice(0, position.character);
        if (/^\s*use\s|\bphi\.\w+\s*:\s*\w*$|^\s*\[\s*\w*$|\b(?:OS|Bootloader|Colors)\s*\.\s*\w*$/.test(before)) return scanned;
        // (a space only opens the list after `call`, and the scanner decides that)
        if (context.triggerCharacter === ' ' && !scanned) return undefined;

        const known = await this.server.completions(doc, position, context, token);
        const described = Array.isArray(scanned) ? scanned : scanned?.items ?? [];
        if (!known.length) return this.server.running && doc.uri.scheme === 'file' && /\.\s*\w*$/.test(before) ? [] : scanned;

        const labelOf = (i: vscode.CompletionItem) => (typeof i.label === 'string' ? i.label : i.label.label);
        const byLabel = new Map(described.map(i => [labelOf(i), i]));
        const merged = known.map(item => {
            const more = byLabel.get(labelOf(item));
            if (more) {
                item.documentation = more.documentation ?? item.documentation;
                item.sortText = more.sortText ?? item.sortText;
                item.insertText = more.insertText ?? item.insertText;
                item.command = more.command ?? item.command;
                item.label = more.label;
            }
            return item;
        });
        // after a dot it's only what the compiler says that thing has; elsewhere a name can also
        // be found in another class, which the scanner lists
        if (/\.\s*\w*$/.test(before)) return merged;
        const said = new Set(known.map(labelOf));
        return [...merged, ...described.filter(i => !said.has(labelOf(i)))];
    }

    private async scannedCompletions(doc: vscode.TextDocument, position: vscode.Position, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
        const scan = this.current(doc);
        const offset = doc.offsetAt(position);
        if (isInCommentOrString(scan.result, offset)) return undefined;
        const before = doc.lineAt(position.line).text.slice(0, position.character);

        // use a.b
        const use = /^\s*use\s+([\w.]*)$/.exec(before);
        if (use) return this.useCompletions(doc, new vscode.Range(position.line, position.character - use[1].length, position.line, position.character));

        // phi.Name:Base
        if (/\bphi\.\w+\s*:\s*\w*$/.test(before)) {
            return Object.entries(classBases).map(([name, description]) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
                item.documentation = new vscode.MarkdownString(description);
                return item;
            });
        }

        // Qualifier.member
        const dotted = /([A-Za-z_]\w*|\]|\d+)\s*\.\s*(\w*)$/.exec(before);
        if (dotted) return this.memberCompletions(scan, offset, dotted[1]);
        if (context.triggerCharacter === '.') return undefined;

        // [ at the start of a line: method headers
        if (/^\s*\[\s*\w*$/.test(before)) return this.headerCompletions();
        if (context.triggerCharacter === '[') return undefined;
        // a space only opens the list right after `call`
        if (context.triggerCharacter === ' ' && !/\bcall\s+$/.test(before)) return undefined;

        return this.generalCompletions(scan, offset, /\bcall\s+(?:[\w.:]+\s+(?:is|=)\s+)?\w*$/.test(before));
    }

    private useCompletions(doc: vscode.TextDocument, range: vscode.Range): vscode.CompletionItem[] {
        const items = new Map<string, vscode.CompletionItem>();
        const add = (name: string, detail: string, doc?: string) => {
            if (items.has(name)) return;
            const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
            item.detail = detail;
            if (doc) item.documentation = new vscode.MarkdownString(doc);
            // replace the whole dotted path typed so far, not just the word after the last '.'
            item.range = range;
            item.insertText = name + ';';
            item.filterText = name;
            items.set(name, item);
        };
        if (doc.uri.scheme === 'file') for (const m of this.ws.localModules(doc.fileName)) add(m.name, vscode.workspace.asRelativePath(m.file));
        const lib = this.ws.libraryModules();
        for (const m of lib) add(m.name, 'standard library', standardLibrary[m.name]);
        if (!lib.length) for (const [name, d] of Object.entries(standardLibrary)) add(name, 'standard library', d);
        return [...items.values()];
    }

    private headerCompletions(): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const end = new vscode.CompletionItem('end', vscode.CompletionItemKind.Keyword);
        end.documentation = new vscode.MarkdownString('Ends a method. `[end: value]` returns a value.');
        items.push(end);
        const isr = new vscode.CompletionItem('isr', vscode.CompletionItemKind.Keyword);
        isr.insertText = new vscode.SnippetString('isr ${1:Handler}');
        isr.documentation = keywordMarkdown('isr');
        items.push(isr);
        for (const hook of builtinHooks) {
            const item = new vscode.CompletionItem(hook.name, vscode.CompletionItemKind.Event);
            item.documentation = new vscode.MarkdownString(hook.description);
            items.push(item);
        }
        return items;
    }

    private async memberCompletions(scan: FileScan, offset: number, qualifier: string): Promise<vscode.CompletionItem[] | undefined> {
        if (qualifier === 'OS' || qualifier === 'Bootloader') {
            const seen = new Set<string>();
            const items: vscode.CompletionItem[] = [];
            for (const fn of builtinFunctions) {
                for (const full of [fn.name, ...fn.aliases]) {
                    const [q, name] = full.split('.');
                    if (q !== qualifier || seen.has(name)) continue;
                    seen.add(name);
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                    item.detail = fn.parameters.length ? `${full}: ${fn.parameters.join(' ')}${fn.returns ? ' → value' : ''}` : `${full}${fn.returns ? ' → value' : ''}`;
                    item.documentation = builtinMarkdown(fn);
                    if (full !== fn.name) item.sortText = '~' + name; // aliases last
                    items.push(item);
                }
            }
            for (const hook of builtinHooks) {
                const [q, name] = hook.name.split('.');
                if (q !== qualifier) continue;
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Event);
                item.detail = `[${hook.name}] event`;
                item.documentation = new vscode.MarkdownString(hook.description);
                items.push(item);
            }
            return items;
        }

        if (qualifier === 'Colors') {
            return builtinColors.map((c, i) => {
                const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Color);
                item.detail = `${c.value} (0x${c.value.toString(16).toUpperCase()})`;
                item.documentation = vgaSwatch(c.value);
                item.sortText = String(i).padStart(2, '0');
                return item;
            });
        }

        const closure = this.ws.useClosure(scan);
        const workspace = (await this.ws.workspaceScans());
        const visible = [scan, ...closure];

        if (qualifier === 'asm' || qualifier === 'arm') {
            return this.items(visible.flatMap(f => f.result.symbols.filter(s => s.kind === 'asm')));
        }

        // Class.member: look in visible files, then the workspace
        for (const files of [visible, workspace]) {
            const cls = files.flatMap(f => f.result.symbols).filter(s => s.kind === 'class' && s.name === qualifier);
            if (cls.length) return this.items(cls.flatMap(c => c.children.filter(isMember)));
        }

        // variable.field
        const len = new vscode.CompletionItem('len', vscode.CompletionItemKind.Property);
        len.documentation = keywordMarkdown('len');
        const variable = /^[A-Za-z_]/.test(qualifier)
            ? visibleLocals(scan, offset).find(s => s.name === qualifier)
              ?? visible.flatMap(f => f.result.allSymbols).find(s => s.name === qualifier && isMember(s))
            : undefined;
        const struct = structOf(variable?.type);
        const structs = [...visible, ...workspace].flatMap(f => f.result.symbols).filter(s => s.kind === 'struct');
        if (struct) {
            const def = structs.find(s => s.name === struct);
            if (def) return this.items(def.children);
        }
        if (variable && !struct) return [len];
        // x:i.field and similar: every field of every visible struct
        const visibleStructs = visible.flatMap(f => f.result.symbols).filter(s => s.kind === 'struct');
        return [...this.items(visibleStructs.flatMap(s => s.children)), len];
    }

    private items(symbols: PhiSymbol[]): vscode.CompletionItem[] {
        const seen = new Set<string>();
        const out: vscode.CompletionItem[] = [];
        for (const s of symbols) {
            if (seen.has(s.name)) continue;
            seen.add(s.name);
            out.push(this.symbolItem(s));
        }
        return out;
    }

    private symbolItem(s: PhiSymbol, sortPrefix = '1'): vscode.CompletionItem {
        const item = new vscode.CompletionItem({ label: s.name, description: s.container ? s.container.name : undefined }, completionKind(s));
        item.detail = s.signature;
        if (s.doc) item.documentation = new vscode.MarkdownString(s.doc);
        item.sortText = sortPrefix + s.name;
        return item;
    }

    private async generalCompletions(scan: FileScan, offset: number, afterCall: boolean): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];
        const names = new Set<string>();
        const push = (item: vscode.CompletionItem) => {
            const label = typeof item.label === 'string' ? item.label : item.label.label;
            if (names.has(label)) return;
            names.add(label);
            items.push(item);
        };

        const closure = this.ws.useClosure(scan);
        const visible = [scan, ...closure];

        if (afterCall) {
            // methods and asm blocks first
            const method = symbolAt(scan.result, offset, ['class']);
            for (const s of method?.children.filter(c => c.kind === 'method') ?? []) push(this.symbolItem(s, '0'));
            for (const f of visible) for (const s of f.result.allSymbols) {
                if (s.kind === 'method' && isMember(s)) push(this.symbolItem(s, '1'));
                if (s.kind === 'asm') push(this.symbolItem(s, '1'));
                if (s.kind === 'class') push(this.symbolItem(s, '2'));
            }
            for (const q of ['OS', 'Bootloader']) push(this.prefixItem(q));
            return items;
        }

        for (const s of visibleLocals(scan, offset)) push(this.symbolItem(s, '0'));
        for (const f of visible) for (const s of f.result.allSymbols) {
            if (['class', 'struct', 'asm'].includes(s.kind) || (s.kind === 'const' && !s.container)) push(this.symbolItem(s, '2'));
            else if (isMember(s)) push(this.symbolItem(s, '2'));
        }
        for (const q of ['OS', 'Bootloader', 'Colors']) push(this.prefixItem(q));

        for (const [word, info] of Object.entries(keywords)) {
            if (['isr', 'end', 'len'].includes(word)) continue;
            const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.Keyword);
            item.documentation = new vscode.MarkdownString().appendCodeblock(info.syntax, 'phi').appendMarkdown(info.description);
            item.sortText = '5' + word;
            push(item);
        }
        for (const [word, info] of Object.entries(primitiveTypes)) {
            const item = new vscode.CompletionItem(word, vscode.CompletionItemKind.TypeParameter);
            item.documentation = new vscode.MarkdownString(info.description);
            item.sortText = '4' + word;
            if (word === 'ptr') item.insertText = new vscode.SnippetString('ptr<${1:u8}> ');
            push(item);
        }
        return items;
    }

    private prefixItem(name: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        item.documentation = keywordMarkdown(name);
        item.insertText = name + '.';
        item.command = { command: 'editor.action.triggerSuggest', title: 'members' };
        item.sortText = '3' + name;
        return item;
    }

    // ---- signature help

    async provideSignatureHelp(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.SignatureHelp | undefined> {
        const scan = this.current(doc);
        const offset = doc.offsetAt(position);
        if (isInCommentOrString(scan.result, offset)) return undefined;
        const ctx = callContextAt(scan.result, offset);
        if (!ctx) return undefined;

        let label: string;
        let params: { label: string; doc?: string }[];
        let documentation: vscode.MarkdownString | undefined;

        const builtin = ctx.qualifier ? findBuiltin(ctx.qualifier, ctx.name) : undefined;
        if (builtin) {
            if (!builtin.parameters.length) return undefined;
            params = builtin.parameters.map((p, i) => ({ label: p, doc: builtin.textParameters.includes(i) ? 'text (a str or ptr<u8>)' : undefined }));
            label = `${builtin.name}: ${builtin.parameters.join(' ')}`;
            documentation = new vscode.MarkdownString(builtin.description);
        } else {
            const nameOffset = (() => {
                // resolve the method name token itself
                const line = doc.lineAt(position.line).text;
                const idx = line.lastIndexOf(ctx.name + ':', position.character);
                return idx >= 0 ? doc.offsetAt(new vscode.Position(position.line, idx)) : -1;
            })();
            let method: PhiSymbol | undefined;
            if (nameOffset >= 0) {
                const r = await this.resolve(scan, nameOffset);
                if (r?.kind === 'symbols') method = r.targets.map(t => t.symbol).find(s => s.kind === 'method');
            }
            if (!method) {
                const files = [scan, ...this.ws.useClosure(scan), ...(await this.ws.workspaceScans())];
                method = files.flatMap(f => f.result.allSymbols).find(s => s.kind === 'method' && s.name === ctx.name && (!ctx.qualifier || s.container?.name === ctx.qualifier));
            }
            if (!method?.parameters?.length) return undefined;
            params = method.parameters.map(p => ({ label: `${p.type} ${p.name}`, doc: p.defaultValue !== undefined ? `default: ${p.defaultValue}` : undefined }));
            label = `${method.container ? method.container.name + '.' : ''}${method.name}: ${params.map(p => p.label).join(' ')}`;
            if (method.doc) documentation = new vscode.MarkdownString(method.doc);
        }

        const sig = new vscode.SignatureInformation(label, documentation);
        let at = label.indexOf(': ') + 2;
        sig.parameters = params.map(p => {
            const start = label.indexOf(p.label, at);
            at = start + p.label.length;
            return new vscode.ParameterInformation([start, start + p.label.length], p.doc);
        });
        const help = new vscode.SignatureHelp();
        help.signatures = [sig];
        help.activeSignature = 0;
        help.activeParameter = Math.min(ctx.argument, params.length - 1);
        return help;
    }
}

function fuzzy(name: string, query: string): boolean {
    let i = 0;
    for (const c of name) if (c === query[i]) i++;
    return i === query.length;
}

const vgaRgb = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
    '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];

function vgaSwatch(value: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`VGA color ${value}: \`${vgaRgb[value]}\``);
    return md;
}
