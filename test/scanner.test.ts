import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { findAsmLine } from '../src/asmMap';
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
