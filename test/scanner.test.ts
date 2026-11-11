import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { findAsmLine } from '../src/asmMap';
import { classBases, keywords, primitiveTypes, reservedWords } from '../src/languageData';
import { callContextAt, lex, scan, symbolAt } from '../src/scanner';
import { FileScan, resolveAt } from '../src/resolver';
import { findCompiler, findLibrary, parseDiagnostics, resolveDiagnosticPath, resolveUse, check } from '../src/toolchain';
import { cursor, haveRepo, phiFiles, phiRoot } from './helpers';

const methodsSource = `phi.Methods:Library
{
\tint total: 0;
\tcall total is Add: 2 3;

\t# Says hello.
\t[SayHello: str message: 'world';]
\t\tlog 'hello ' message '\\n';
\t[end]

\t[Add: int x: 0; int y: 0;]
\t[end: x + y]
}`;

test('lexer: strings with apostrophes, block comments, asm raw blocks', () => {
    const { tokens, comments } = lex("log 'hasn't' x; #\n block\n#\nasm.A\n{\n mov eax, [{v}]\n ret\n}\n");
    assert.deepEqual(tokens.slice(0, 4).map(t => t.text), ['log', "'hasn't'", 'x', ';']);
    assert.equal(comments.length, 1);
    assert.ok(comments[0].block);
    const raw = tokens.find(t => t.kind === 'raw')!;
    assert.match(raw.text, /mov eax, \[\{v\}\]/);
    assert.equal(tokens[tokens.indexOf(raw) + 1].text, '}');
});

test('scanner: classes, methods, parameters, returns and doc comments', () => {
    const r = scan(methodsSource);
    const cls = r.symbols[0];
    assert.equal(cls.kind, 'class');
    assert.equal(cls.type, 'Library');
    assert.deepEqual(cls.children.map(c => `${c.kind}:${c.name}`), ['variable:total', 'method:SayHello', 'method:Add']);
    const say = cls.children[1];
    assert.equal(say.doc, 'Says hello.');
    assert.deepEqual(say.parameters, [{ name: 'message', type: 'str', defaultValue: "'world'" }]);
    assert.equal(say.returns, false);
    const add = cls.children[2];
    assert.equal(add.returns, true);
    assert.deepEqual(add.parameters!.map(p => p.name), ['x', 'y']);
    assert.ok(r.folding.some(f => f.startLine === 1 - 1 || f.startLine === 0));
});

test('scanner: structs, use, constants, loop counters, asm', () => {
    const r = scan(`use drivers.vga_text;
use boot.info;
const int LIMIT: 4;
struct.Task
{
\tu32 id;
\tptr<Task> next;
\tu8 name[8];
}
phi.K:Kernel
{
\tTask current;
\tptr<Task> t: new Task;
\twhile int i: 0; i < LIMIT; i++;
\t\tcurrent.id is i;
\t;;
}
asm.Double
{
\tret
}`);
    assert.deepEqual(r.uses.map(u => u.path), ['drivers.vga_text', 'boot.info']);
    assert.deepEqual(r.symbols.map(s => `${s.kind}:${s.name}`), ['const:LIMIT', 'struct:Task', 'class:K', 'asm:Double']);
    assert.deepEqual(r.symbols[1].children.map(f => `${f.name}:${f.type}`), ['id:u32', 'next:ptr<Task>', 'name:u8']);
    assert.deepEqual(r.symbols[2].children.map(f => `${f.name}:${f.type}`), ['current:Task', 't:ptr<Task>', 'i:int']);
    assert.ok(r.folding.some(f => f.kind === 'imports'));
});

test('scanner: structs that take types, and variables of them', () => {
    const r = scan(`struct.Stack<Item> has Shown
{
\tItem items[];
\tint added;

\t[Push: Item item;]
\t\titems++ item;
\t[end: items.len]
}
struct.Pair<First Second>
{
\tFirst first;
}
phi.K:Program
{
\tnew Stack<int> undo;
\tPair<u8 Stack<int>> both;
\tptr<Stack<int>> same: addr undo;
\tint a: 1;
\tint b: 2;
\tif a < b and b > a
\t\tcall undo.Push: a;
\t;;
}`);
    assert.deepEqual(r.symbols.map(s => `${s.kind}:${s.name}`), ['struct:Stack', 'struct:Pair', 'class:K']);
    assert.equal(r.symbols[0].signature, 'struct.Stack<Item> has Shown');
    assert.equal(r.symbols[1].signature, 'struct.Pair<First Second>');
    assert.deepEqual(r.symbols[0].children.map(f => `${f.kind}:${f.name}:${f.type ?? ''}`), ['field:items:Item', 'field:added:int', 'method:Push:']);
    assert.deepEqual(r.symbols[2].children.map(f => `${f.name}:${f.type}`),
        ['undo:Stack<int>', 'both:Pair<u8 Stack<int>>', 'same:ptr<Stack<int>>', 'a:int', 'b:int']);
});

test('resolver: a variable of a struct that takes types is its struct, for its fields and methods', () => {
    const { text, offset } = cursor(`struct.Stack<Item>
{
\tItem items[];

\t[Push: Item item;]
\t\titems++ item;
\t[end: items.len]
}
phi.K:Program
{
\tnew Stack<int> undo;
\tcall undo.Pu|sh: 4;
}`);
    const current: FileScan = { file: 'k.phi', result: scan(text) };
    const found = resolveAt(current, offset, [], () => undefined);
    assert.ok(found?.kind === 'symbols' && found.targets.length === 1, JSON.stringify(found?.kind));
    assert.equal(found.targets[0].symbol.kind, 'method');
    assert.equal(found.targets[0].symbol.name, 'Push');
    assert.equal(found.targets[0].symbol.container?.name, 'Stack');

    // and its type's name goes to the struct, from Stack<int> as from Stack
    const type = resolveAt(current, text.indexOf('Stack<int> undo'), [], () => undefined);
    assert.ok(type?.kind === 'symbols' && type.targets[0].symbol.kind === 'struct' && type.targets[0].symbol.name === 'Stack');
});

test('scanner: every .phi file in the PHI repository', { skip: !haveRepo && 'PHI repository not found' }, () => {
    let total = 0;
    for (const file of phiFiles()) {
        const text = fs.readFileSync(file, 'utf8');
        const r = scan(text);
        for (const s of r.allSymbols) {
            assert.ok(s.start <= s.nameStart && s.nameEnd <= s.end, `${file}: ${s.name} name outside its range`);
            assert.match(s.name, /^[A-Za-z_][\w.]*$/, `${file}: odd name ${s.name}`);
        }
        // every method header a line-based regex sees (outside block comments) is found
        const withoutComments = r.comments.reduce((t, c) => t.slice(0, c.start) + t.slice(c.start, c.end).replace(/[^\n]/g, ' ') + t.slice(c.end), text);
        const expected = (withoutComments.match(/^\s*\[\s*(?!end\b)[A-Za-z_]\w*\s*[\]:]/gm) ?? []).length;
        const found = r.allSymbols.filter(s => s.kind === 'method').length;
        assert.equal(found, expected, `${path.relative(phiRoot, file)}: found ${found} methods, expected ${expected}`);
        total += found;
    }
    assert.ok(total >= 90, `only ${total} methods in the repository`);
});

test('reserved words match the compiler, and each says what it is', { skip: !haveRepo && 'PHI repository not found' }, () => {
    const parser = fs.readFileSync(path.join(phiRoot, 'Compiler/Phi.Compiler/Syntax/Parser.cs'), 'utf8');
    const lists = [...parser.matchAll(/public static readonly HashSet<string> (?:TypeKeywords|ReservedWords) = new[^{]*\{([^}]*)\}/g)];
    assert.equal(lists.length, 2);
    const compiler = new Set(lists.flatMap(l => [...l[1].matchAll(/"(\w+)"/g)].map(m => m[1])));
    assert.ok(compiler.size > 60);
    assert.deepEqual([...compiler].filter(w => !reservedWords.has(w)), [], 'reserved by the compiler, not here');
    assert.deepEqual([...reservedWords].filter(w => !compiler.has(w)), [], 'reserved here, not by the compiler');
    assert.deepEqual([...compiler].filter(w => !keywords[w] && !primitiveTypes[w]), [], 'no hover');
});

test('every class base of the compiler is explained', { skip: !haveRepo && 'PHI repository not found' }, () => {
    const binder = fs.readFileSync(path.join(phiRoot, 'Compiler/Phi.Compiler/Semantics/Binder.cs'), 'utf8');
    const bases = [...binder.matchAll(/\["(\w+)"\] = new\[\] \{ Host\./g)].map(m => m[1]);
    assert.ok(bases.includes('Windows'));
    assert.deepEqual(bases.filter(b => !classBases[b]), []);
});

test('scanner: enums, interfaces and a struct that has one', () => {
    const r = scan('enum.Tool\n{\n\tPENCIL   # one\n\tERASER: 10\n\tFILL: ERASER + 1\n}\n\ninterface.Shape\n{\n\t[Area]\n\t[Grow: int by;]\n}\n\nstruct.Circle has Shape Solid\n{\n\tint r;\n\n\t[Area]\n\t[end: r]\n}\n');
    assert.deepEqual(r.symbols.map(s => [s.kind, s.name]), [['enum', 'Tool'], ['interface', 'Shape'], ['struct', 'Circle']]);
    assert.deepEqual(r.symbols[0].children.map(c => [c.kind, c.name, c.signature]), [
        ['enumValue', 'PENCIL', 'Tool.PENCIL'], ['enumValue', 'ERASER', 'Tool.ERASER'], ['enumValue', 'FILL', 'Tool.FILL'],
    ]);
    assert.deepEqual(r.symbols[1].children.map(c => [c.kind, c.name]), [['method', 'Area'], ['method', 'Grow']]);
    assert.equal(r.symbols[1].children[1].parameters?.[0].name, 'by');
    assert.equal(r.symbols[2].signature, 'struct.Circle has Shape Solid');
    assert.deepEqual(r.symbols[2].children.map(c => c.name), ['r', 'Area']);
});

test('resolver: an enum value, a method through an interface, and .max', () => {
    const main = "enum.Tool\n{\n\tPENCIL\n}\ninterface.Shape\n{\n\t[Area]\n}\nphi.Main:Kernel\n{\n\tTool tool: Tool.PENCIL;\n\tnew Shape s;\n\tint a: (s.Area);\n\tint most: tool.max;\n}";
    const current: FileScan = { file: 'main.phi', result: scan(main) };
    const at = (needle: string) => resolveAt(current, main.indexOf(needle), [], () => undefined);

    const value = at('PENCIL;');
    assert.ok(value?.kind === 'symbols' && value.targets[0].symbol.kind === 'enumValue');
    const type = at('Tool tool');
    assert.ok(type?.kind === 'symbols' && type.targets[0].symbol.kind === 'enum');
    const method = at('Area);');
    assert.ok(method?.kind === 'symbols' && method.targets[0].symbol.container?.kind === 'interface');
    const max = at('max;');
    assert.ok(max?.kind === 'keyword' && max.word === 'max');
    const word = at('enum.');
    assert.ok(word?.kind === 'keyword' && word.word === 'enum');
});

test('scanner: x64 blocks are raw assembly', () => {
    const r = scan('x64.Double\n{\n\tmov rax, [rsp]\n\t[not a method]\n}\nphi.A:Program\n{\n}\n');
    assert.deepEqual(r.symbols.map(s => [s.kind, s.name]), [['asm', 'Double'], ['class', 'A']]);
});

test('scanner: declarations of the newer kinds', () => {
    const r = scan("phi.A:Program\n{\n\tnew Cell corner at 0xB8000;\n\tnew Thing t: 1;\n\tchr c: 'a';\n\ti64 big: 1;\n\tptr<ptr<u8>> rows;\n\tmethod<int: int> handler;\n\tvolatile u32 ready;\n\tptr<u8> b: new u8[8];\n\tlock guard;\n\t[M]\n\t\twhile each item in rows\n\t\t;;\n\t\tif call F: 1 throws err\n\t\t;;\n\t\twhen x\n\t\t\tis Player p\n\t\t\t;;\n\t\t;;\n\t[end]\n}\n");
    const cls = r.symbols[0];
    assert.deepEqual(cls.children.filter(c => c.kind === 'variable').map(c => [c.name, c.type]), [
        ['corner', 'Cell'], ['t', 'Thing'], ['c', 'chr'], ['big', 'i64'], ['rows', 'ptr<ptr<u8>>'], ['handler', 'method<int: int>'],
        ['ready', 'u32'], ['b', 'ptr<u8>'], ['guard', 'lock'],
    ]);
    const method = cls.children.find(c => c.name === 'M')!;
    assert.deepEqual(method.children.map(c => [c.name, c.type]), [['item', undefined], ['err', 'Error'], ['p', 'Player']]);
});

test("scanner: a type after `as` isn't a declaration", () => {
    const r = scan("phi.A:Program\n{\n\t[M]\n\t\tif x is not y as int\n\t\t\terror is 'no';\n\t\t;;\n\t\tint n: y as int + 1;\n\t[end]\n}\n");
    assert.deepEqual(r.symbols[0].children[0].children.map(c => c.name), ['n']);
});

test('scanner: a struct field that is an object', () => {
    const r = scan('struct.Node\n{\n\tnew Node next: empty;\n\tnew str bio;\n}\n');
    assert.deepEqual(r.symbols[0].children.map(c => [c.kind, c.name, c.type]), [['field', 'next', 'Node'], ['field', 'bio', 'str']]);
});

test('folding: when and locked blocks, and an if on one line has no ;;', () => {
    const r = scan('phi.A:Program\n{\n\t[M]\n\t\tif outer\n\t\t\tif x return;\n\t\t\tif call F: 1 throws err\n\t\t\t\tlog err;\n\t\t\t;;\n\t\t\twhen k\n\t\t\t\tis 1\n\t\t\t\t\tlog k;\n\t\t\t\t;;\n\t\t\t;;\n\t\t\tlocked g\n\t\t\t\tlog 1;\n\t\t\t;;\n\t\t;;\n\t[end]\n}\n');
    const has = (from: number, to: number) => assert.ok(r.folding.some(f => f.startLine === from && f.endLine === to), `${from}-${to} in ${JSON.stringify(r.folding)}`);
    has(3, 15);   // if outer, past the one-line if inside it
    has(5, 6);    // if call ... throws
    has(8, 11);   // when
    has(9, 10);   // its branch
    has(13, 14);  // locked
});

test('call context: argument index for signature help', () => {
    const at = (src: string) => { const { text, offset } = cursor(src); return callContextAt(scan(text), offset); };
    assert.deepEqual(at('call Add: |'), { name: 'Add', qualifier: undefined, argument: 0 });
    assert.deepEqual(at('call Add: 2 |'), { name: 'Add', qualifier: undefined, argument: 1 });
    assert.deepEqual(at('call Add: 2 + 3 |'), { name: 'Add', qualifier: undefined, argument: 1 });
    assert.deepEqual(at('call Add: 2 +| 3'), { name: 'Add', qualifier: undefined, argument: 0 });
    assert.deepEqual(at('call x is Fat.ReadFile: \'a.txt\' buffer:i |'), { name: 'ReadFile', qualifier: 'Fat', argument: 2 });
    assert.deepEqual(at('call OS.DrawRectangle: (x + 1) y |'), { name: 'DrawRectangle', qualifier: 'OS', argument: 2 });
    assert.deepEqual(at('call OS.SetInterruptHandler: 0x09 addr |'), { name: 'SetInterruptHandler', qualifier: 'OS', argument: 1 });
    assert.equal(at('call Add: 2 3;|'), undefined);
    assert.equal(at('log x |'), undefined);
});

test('resolver: locals, class members, Class.member, fields, built-ins, use', () => {
    const lib = `struct.Point\n{\n\ti16 x;\n}\nphi.Vga:Library\n{\n\tint row: 0;\n\t[Print: str text: '';]\n\t[end]\n}`;
    const libScan: FileScan = { file: 'lib.phi', result: scan(lib) };

    const main = `use drivers.vga_text;
phi.Main:Kernel
{
\tint total: 0;
\tPoint p;
\tcall total is Add: 2 3;
\tcall Vga.Print: 'x';
\tp.x is 4;
\tcall OS.Sleep: total;
\tcall Vga.SetColor: Colors.White 0;
\t[Add: int x: 0; int y: 0;]
\t[end: x + y]
}`;
    const current: FileScan = { file: 'main.phi', result: scan(main) };
    const resolveIn = (needle: string, nth = 0, delta = 0) => {
        let offset = -1;
        for (let i = 0; i <= nth; i++) offset = main.indexOf(needle, offset + 1);
        return resolveAt(current, offset + delta, [libScan], p => (p === 'drivers.vga_text' ? 'lib.phi' : undefined));
    };

    const add = resolveIn('Add', 0);
    assert.equal(add?.kind, 'symbols');
    assert.equal(add?.kind === 'symbols' && add.targets[0].symbol.kind, 'method');

    const x = resolveIn('x + y', 0);
    assert.ok(x?.kind === 'symbols' && x.targets[0].symbol.kind === 'parameter');

    const print = resolveIn('Print', 0);
    assert.ok(print?.kind === 'symbols' && print.targets[0].file === 'lib.phi');

    const field = resolveIn('p.x', 0, 2);
    assert.ok(field?.kind === 'symbols' && field.targets[0].symbol.kind === 'field' && field.targets[0].symbol.container?.name === 'Point');

    const sleep = resolveIn('Sleep');
    assert.ok(sleep?.kind === 'builtin' && sleep.fn.parameters[0] === 'milliseconds');

    const white = resolveIn('White');
    assert.ok(white?.kind === 'color' && white.color.value === 15);

    const use = resolveIn('vga_text');
    assert.ok(use?.kind === 'use' && use.target === 'lib.phi');

    const base = resolveIn('Kernel');
    assert.ok(base?.kind === 'base');

    const kw = resolveIn('call');
    assert.ok(kw?.kind === 'keyword' && kw.word === 'call');
});

test('symbolAt finds the method around a position', () => {
    const r = scan(methodsSource);
    const m = symbolAt(r, methodsSource.indexOf("log 'hello"), ['method']);
    assert.equal(m?.name, 'SayHello');
});

test('diagnostics: compiler output is parsed', () => {
    const out = [
        "C:\\labs\\x\\error_syntax.phi:3:25: error: expected ';' but found 'log'",
        'tests/a.phi:5:6: warning: something odd',
        'lib/phi/fs/fat16.phi:1:1: error: in the library',
        'error: file not found: nope.phi',
        'tests/a.phi: no errors',
    ].join('\r\n');
    const d = parseDiagnostics(out);
    assert.equal(d.length, 4);
    assert.deepEqual(d[0], { file: 'C:\\labs\\x\\error_syntax.phi', line: 3, column: 25, severity: 'error', message: "expected ';' but found 'log'" });
    assert.equal(d[1].severity, 'warning');
    assert.equal(d[3].file, undefined);
    assert.equal(resolveDiagnosticPath('lib/phi/fs/fat16.phi', '/x', '/lib'), path.join('/lib', 'fs/fat16.phi'));
    assert.equal(resolveDiagnosticPath('lib/phi/fs/fat16.phi', '/x', undefined), undefined);
});

test('asm map: finds the code for a source line in its class or method', () => {
    const asm = [
        '; 32-bit kernel generated by phi from k.phi',
        '    ; ---- class Vga',
        '    ; ---- class K',
        '    ; 7: int cells: width * height;',
        '    mov eax, 1',
        '    ; 9: log x;',
        '    ; method K.Area',
        '    ; 44: [end: w * h]',
        '    ; method Vga.Print',
        '    ; 7: log text;',
    ].join('\n');
    assert.deepEqual(findAsmLine(asm, 'K', undefined, 7), { line: 3, exact: true });
    assert.deepEqual(findAsmLine(asm, 'K', undefined, 8), { line: 3, exact: false });
    assert.deepEqual(findAsmLine(asm, 'K', 'Area', 44), { line: 7, exact: true });
    assert.deepEqual(findAsmLine(asm, 'Vga', 'Print', 7), { line: 9, exact: true });
    assert.deepEqual(findAsmLine(asm, 'Vga', undefined, 7), { line: 1, exact: false });
});

test('toolchain: finds the compiler and library in the PHI repository', { skip: !haveRepo && 'PHI repository not found' }, () => {
    const compiler = findCompiler('', [path.join(phiRoot, 'samples')]);
    const library = findLibrary('', compiler, [path.join(phiRoot, 'samples')]);
    assert.ok(library && fs.existsSync(path.join(library, 'drivers', 'vga_text.phi')));
    assert.equal(resolveUse('drivers.vga_text', path.join(phiRoot, 'samples', 'kernel.phi'), library), path.join(library!, 'drivers', 'vga_text.phi'));
    assert.equal(resolveUse('no.such', path.join(phiRoot, 'samples', 'kernel.phi'), library), undefined);
    if (compiler) assert.match(path.basename(compiler), /^phi(\.exe)?$/);
});

test('toolchain: phi check reports errors with locations', { skip: !haveRepo && 'PHI repository not found' }, async (t) => {
    const compiler = findCompiler('', [phiRoot]);
    if (!compiler) { t.skip('phi compiler not built'); return; }
    const bad = await check(compiler, path.join(phiRoot, 'tests', 'error_syntax.phi'));
    assert.equal(bad.code, 1);
    assert.ok(bad.diagnostics.length >= 3);
    assert.deepEqual(bad.diagnostics.map(d => [d.line, d.column]), [[3, 25], [5, 6], [8, 1]]);
    assert.equal(path.resolve(bad.diagnostics[0].file!), path.join(phiRoot, 'tests', 'error_syntax.phi'));
    const good = await check(compiler, path.join(phiRoot, 'tests', 'hello.phi'));
    assert.equal(good.code, 0);
    assert.equal(good.diagnostics.length, 0);
});
