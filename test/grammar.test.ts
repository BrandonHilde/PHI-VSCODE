import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';
import { haveRepo, phiFiles, phiRoot } from './helpers';

const root = path.resolve(__dirname, '../..');

let registry: vsctm.Registry | undefined;
async function grammar(scope = 'source.phi'): Promise<vsctm.IGrammar> {
    if (!registry) {
        const wasm = fs.readFileSync(path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer;
        await oniguruma.loadWASM(wasm);
        registry = new vsctm.Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (sources: string[]) => new oniguruma.OnigScanner(sources),
                createOnigString: (s: string) => new oniguruma.OnigString(s),
            }),
            loadGrammar: async (scopeName: string) => {
                const files: Record<string, string> = {
                    'source.phi': 'syntaxes/phi.tmLanguage.json',
                    'markdown.phi.codeblock': 'syntaxes/phi.markdown.tmLanguage.json',
                };
                const file = files[scopeName];
                if (!file) return null;
                return vsctm.parseRawGrammar(fs.readFileSync(path.join(root, file), 'utf8'), path.join(root, file));
            },
        });
    }
    return (await registry.loadGrammar(scope))!;
}

interface Tok { text: string; scopes: string[]; line: number }

async function tokenize(source: string): Promise<Tok[]> {
    const g = await grammar();
    const out: Tok[] = [];
    let state = vsctm.INITIAL;
    source.split(/\r?\n/).forEach((lineText, line) => {
        const r = g.tokenizeLine(lineText, state);
        for (const t of r.tokens) out.push({ text: lineText.slice(t.startIndex, t.endIndex), scopes: t.scopes, line });
        state = r.ruleStack;
    });
    return out;
}

/** The scopes of the first token whose text is `text` (on `line`, if given). */
function scopesOf(tokens: Tok[], text: string, line?: number): string[] {
    const t = tokens.find(t => t.text === text && (line === undefined || t.line === line));
    assert.ok(t, `no token '${text}' in ${JSON.stringify(tokens.map(t => t.text))}`);
    return t.scopes;
}

function hasScope(tokens: Tok[], text: string, scope: string, line?: number) {
    const scopes = scopesOf(tokens, text, line);
    assert.ok(scopes.some(s => s.startsWith(scope)), `'${text}' has ${scopes.join(' ')}, expected ${scope}`);
}

test('class headers, bases and blocks', async () => {
    const t = await tokenize("phi.Hello:Kernel\n{\n\tlog 'hi';\n}");
    hasScope(t, 'phi', 'storage.type.class');
    hasScope(t, 'Hello', 'entity.name.type.class');
    hasScope(t, 'Kernel', 'support.class.base');
    hasScope(t, 'log', 'keyword.other.io');
});

test("strings: a quote before a letter doesn't close them", async () => {
    const t = await tokenize("log 'hasn't' x;\nlog 'it''s';");
    const inString = t.filter(x => x.line === 0 && x.scopes.some(s => s.startsWith('string.quoted.single')));
    assert.equal(inString.map(x => x.text).join(''), "'hasn't'");
    const after = t.filter(x => x.line === 0 && x.text.includes('x'));
    assert.ok(after.length && after.every(x => !x.scopes.some(s => s.startsWith('string'))), 'x after the string is code');
    hasScope(t, ';', 'punctuation.terminator', 0);
});

test('escapes, valid and unknown', async () => {
    const t = await tokenize("log 'a\\r\\n\\t\\0\\\\\\'b \\q';");
    hasScope(t, '\\r', 'constant.character.escape');
    hasScope(t, "\\'", 'constant.character.escape');
    hasScope(t, '\\q', 'invalid.illegal');
});

test('comments: line, trailing, and block comments opened by a lone #', async () => {
    const t = await tokenize("# top\nlog 'one'; # trailing\nstr h: '# not a comment';\n#\n\tlog 'inside';\n#\nlog 'after';\nx is 1; #\n  still comment\n# closing remark\nlog 'code';");
    hasScope(t, ' top', 'comment.line');
    hasScope(t, ' trailing', 'comment.line');
    hasScope(t, "# not a comment", 'string.quoted');
    hasScope(t, "\tlog 'inside';", 'comment.block');
    hasScope(t, 'log', 'keyword.other.io', 6);
    hasScope(t, '  still comment', 'comment.block');
    hasScope(t, ' closing remark', 'comment.block');
    hasScope(t, 'log', 'keyword.other.io', 10);
});

test('numbers', async () => {
    const t = await tokenize('int a: 0x2A + 101010b + 1_000 + 42 + 3.14;');
    hasScope(t, '0x2A', 'constant.numeric.hex');
    hasScope(t, '101010b', 'constant.numeric.binary');
    hasScope(t, '1_000', 'constant.numeric.integer');
    hasScope(t, '3.14', 'constant.numeric.decimal');
});

test('declarations, types and pointers', async () => {
    const t = await tokenize('int count: 0;\nptr<Task> t: addr tasks:0;\nTask current;\nconst u16 COM1: 0x3F8;\nptr<u8> b: new u8[512];');
    hasScope(t, 'int', 'storage.type.primitive');
    hasScope(t, 'count', 'variable.other.declaration');
    hasScope(t, 'ptr', 'storage.type.ptr');
    hasScope(t, 'Task', 'entity.name.type', 1);
    hasScope(t, 't', 'variable.other.declaration', 1);
    hasScope(t, 'Task', 'entity.name.type.struct', 2);
    hasScope(t, 'current', 'variable.other.declaration');
    hasScope(t, 'const', 'storage.modifier.const');
    hasScope(t, 'COM1', 'variable.other.constant');
    hasScope(t, 'u8', 'storage.type.primitive', 4);
    hasScope(t, 'new', 'keyword.operator.new');
});

test('control flow and ;; block ends', async () => {
    const t = await tokenize('if score > best and lives above 0\n\tlog x;\n;;\nelse\n;;\nwhile int i: 0; i < days.len; i++;\n;;');
    hasScope(t, 'if', 'keyword.control.conditional');
    hasScope(t, 'and', 'keyword.operator.logical');
    hasScope(t, 'above', 'keyword.operator.comparison');
    hasScope(t, ';;', 'keyword.control.block-end', 2);
    hasScope(t, 'while', 'keyword.control.loop');
    hasScope(t, 'len', 'support.variable.property.len');
    hasScope(t, '++', 'keyword.operator.assignment.compound');
});

test('early exits, objects and casts', async () => {
    const t = await tokenize("if done return;\nif skip continue;\nbreak;\nnode.next takes head;\nwhile walk is not empty\n;;\nnew Cell corner at 0xB8000;\nint n: sizeof Entry;\nptr<Note> p: raw as ptr<Note>;\nmethod<int> on_key;");
    hasScope(t, 'return', 'keyword.control.flow', 0);
    hasScope(t, 'continue', 'keyword.control.flow', 1);
    hasScope(t, 'break', 'keyword.control.flow', 2);
    hasScope(t, 'takes', 'keyword.operator.memory', 3);
    hasScope(t, 'empty', 'constant.language.empty', 4);
    hasScope(t, 'at', 'keyword.operator.memory', 6);
    hasScope(t, 'sizeof', 'keyword.operator.memory', 7);
    hasScope(t, 'as', 'keyword.operator.cast', 8);
    hasScope(t, 'method', 'storage.type.method', 9);
});

test('methods: headers, parameters, [end], isr and events', async () => {
    const t = await tokenize("[Add: int x: 0; int y: 0;]\n[end: x + y]\n[isr Keyboard]\n[end]\n[OS.TimerEvent]\n[end]\n[Counter]\n[end]");
    hasScope(t, 'Add', 'entity.name.function');
    hasScope(t, 'x', 'variable.other.declaration', 0);
    hasScope(t, 'end', 'keyword.control.end', 1);
    hasScope(t, 'isr', 'storage.modifier.isr');
    hasScope(t, 'Keyboard', 'entity.name.function.isr');
    hasScope(t, 'TimerEvent', 'entity.name.function.event');
    hasScope(t, 'Counter', 'entity.name.function', 6);
});

test('array sizes are not method headers', async () => {
    const t = await tokenize('int squares[5];\nstr buffer: [40];');
    hasScope(t, 'squares', 'variable.other.declaration');
    assert.ok(!t.some(x => x.scopes.some(s => s.startsWith('meta.method'))));
});

test('calls: user methods, Class.Method, built-ins, results and asm', async () => {
    const t = await tokenize("call Greet: 'PHI';\ncall total is Add: 2 3;\ncall Vga.SetColor: Colors.White Colors.Blue;\ncall OS.Sleep: 300;\ncall asm.Double;\nlog 'still code';");
    hasScope(t, 'Greet', 'entity.name.function');
    hasScope(t, 'total', 'variable.other');
    hasScope(t, 'Add', 'entity.name.function');
    hasScope(t, 'Vga', 'entity.name.type.class');
    hasScope(t, 'SetColor', 'entity.name.function');
    hasScope(t, 'White', 'support.constant.color');
    hasScope(t, 'Sleep', 'support.function.builtin');
    hasScope(t, 'asm', 'storage.type.asm');
    hasScope(t, 'log', 'keyword.other.io', 5); // 'call asm.Double;' must not open an asm block
});

test('asm blocks: instructions, registers, interpolation, comments', async () => {
    const t = await tokenize('asm.Double\n{\n\tmov eax, [{value}]\n\tmov ecx, {LIMIT}\nloop: add eax, 0x10 ; double it\n\tret\n}\nlog x;');
    hasScope(t, 'asm', 'storage.type.asm');
    hasScope(t, 'Double', 'entity.name.function.asm');
    hasScope(t, 'mov', 'keyword.other.instruction');
    hasScope(t, 'eax', 'variable.language.register');
    hasScope(t, 'value', 'variable.other');
    hasScope(t, 'LIMIT', 'constant.other');
    hasScope(t, 'loop', 'entity.name.function.label');
    hasScope(t, 'add', 'keyword.other.instruction');
    hasScope(t, '; double it', 'comment.line.semicolon');
    hasScope(t, 'ret', 'keyword.other.instruction');
    hasScope(t, 'log', 'keyword.other.io', 7);
    assert.ok(scopesOf(t, 'mov').includes('meta.embedded.block.asm.phi'));
});

test('use statements and structs', async () => {
    const t = await tokenize('use drivers.vga_text;\nstruct.Point\n{\n\ti16 x;\n}');
    hasScope(t, 'use', 'keyword.control.import');
    hasScope(t, 'drivers.vga_text', 'entity.name.namespace');
    hasScope(t, 'struct', 'storage.type.struct');
    hasScope(t, 'Point', 'entity.name.type.struct');
});

test('structs that take types: the heading, and variables of one', async () => {
    const t = await tokenize([
        'struct.Map<Key Value> has Shown',
        '{',
        '\tKey keys[];',
        '}',
        'phi.K:Program',
        '{',
        '\tnew Stack<int> undo;',
        '\tPair<u8 Player> both;',
        '\tnew Map<str Stack<int>> deep;',
        '\tif total < limit and limit > 3',
        '\t;;',
        '}',
    ].join('\n'));
    hasScope(t, 'Map', 'entity.name.type.struct', 0);
    hasScope(t, 'Key', 'entity.name.type.parameter', 0);
    hasScope(t, 'Value', 'entity.name.type.parameter', 0);
    hasScope(t, 'has', 'keyword.other.has', 0);
    hasScope(t, ' Shown', 'entity.other.inherited-class', 0);
    hasScope(t, 'new', 'keyword.operator.new', 6);
    hasScope(t, 'Stack', 'entity.name.type.struct', 6);
    hasScope(t, 'int', 'storage.type', 6);
    hasScope(t, 'undo', 'variable.other.declaration', 6);
    hasScope(t, 'Pair', 'entity.name.type.struct', 7);
    hasScope(t, 'Player', 'entity.name.type.struct', 7);
    hasScope(t, 'both', 'variable.other.declaration', 7);
    hasScope(t, 'deep', 'variable.other.declaration', 8);
    // a comparison is no type: nothing between its < and > is one
    const limit = t.filter(x => x.line === 9 && x.text.includes('limit'));
    assert.ok(limit.every(x => !x.scopes.some(s => s.startsWith('entity.name.type'))), JSON.stringify(limit));
});

test('every type of the compiler highlights as a type', async () => {
    for (const type of ['i64', 'u64', 'f16', 'f32', 'f64', 'chr', 'lock']) {
        const t = await tokenize(`${type} thing;`);
        hasScope(t, type, 'storage.type.primitive');
        hasScope(t, 'thing', 'variable.other.declaration');
    }
});

test('enums, interfaces and a struct that has one', async () => {
    const t = await tokenize('enum.Tool\n{\n\tPENCIL\n}\ninterface.Shape\n{\n\t[Area]\n}\nstruct.Circle foreign has Shape Solid\n{\n}');
    hasScope(t, 'enum', 'storage.type.enum');
    hasScope(t, 'Tool', 'entity.name.type.enum');
    hasScope(t, 'PENCIL', 'constant.other');
    hasScope(t, 'interface', 'storage.type.interface');
    hasScope(t, 'Shape', 'entity.name.type.interface');
    hasScope(t, 'Area', 'entity.name.function');
    hasScope(t, 'foreign', 'storage.modifier.foreign');
    hasScope(t, 'has', 'keyword.other.has');
    hasScope(t, ' Shape Solid', 'entity.other.inherited-class');
});

test('when, each, threads and errors', async () => {
    const t = await tokenize("when key\n\tis 'q'\n\t;;\n;;\nwhile each x in list\n;;\nlocked guard\n;;\natomic hits++;\nthrow 'no';\nif call Load: p throws err\n;;\nvolatile u32 ready;\nmethod<str into: int> writer;\nlog list.max;");
    hasScope(t, 'when', 'keyword.control.conditional', 0);
    hasScope(t, 'each', 'keyword.control.loop', 4);
    hasScope(t, 'locked', 'keyword.control.lock', 6);
    hasScope(t, 'atomic', 'keyword.control.lock', 8);
    hasScope(t, 'throw', 'keyword.control.exception', 9);
    hasScope(t, 'throws', 'keyword.control.exception', 10);
    hasScope(t, 'volatile', 'storage.modifier.volatile', 12);
    hasScope(t, 'into', 'storage.modifier.into', 13);
    hasScope(t, 'max', 'support.variable.property.max', 14);
});

test('systems: class bases, x64 blocks, system calls and outside libraries', async () => {
    const t = await tokenize("phi.Files:Windows\n{\n}\nx64.Double\n{\n\tmov r8d, [rsp]\n\tret\n}\nlog 'code';\nsys.Read: 3  int fd;\nint id: (sys.GetPid);\nuse 'kernel32.dll' as Kernel32;");
    hasScope(t, 'Windows', 'support.class.base', 0);
    hasScope(t, 'x64', 'storage.type.asm', 3);
    hasScope(t, 'Double', 'entity.name.function.asm', 3);
    hasScope(t, 'mov', 'keyword.other.instruction', 5);
    hasScope(t, 'r8d', 'variable.language.register', 5);
    hasScope(t, 'rsp', 'variable.language.register', 5);
    hasScope(t, 'log', 'keyword.other.io', 8);
    hasScope(t, 'sys', 'storage.type.sys', 9);
    hasScope(t, 'Read', 'support.function.system-call', 9);
    hasScope(t, 'GetPid', 'support.function.system-call', 10);
    hasScope(t, "'kernel32.dll'", 'string.quoted.single', 11);
    hasScope(t, 'Kernel32', 'entity.name.type.class', 11);
});

test('fenced ```phi blocks in Markdown', async () => {
    const g = await grammar('markdown.phi.codeblock');
    let state = vsctm.INITIAL;
    const scopes: string[][] = [];
    for (const line of ['```phi', "log 'hi';", '```']) {
        const r = g.tokenizeLine(line, state);
        scopes.push(...r.tokens.map(t => t.scopes));
        state = r.ruleStack;
    }
    assert.ok(scopes.some(s => s.includes('keyword.other.io.phi')));
});

test('every .phi file in the PHI repository highlights without invalid tokens', { skip: !haveRepo && 'PHI repository not found' }, async () => {
    const files = phiFiles();
    assert.ok(files.length > 50);
    for (const file of files) {
        if (/error_/.test(path.basename(file))) continue;
        const tokens = await tokenize(fs.readFileSync(file, 'utf8'));
        const bad = tokens.find(t => t.scopes.some(s => s.startsWith('invalid')));
        assert.ok(!bad, `${path.relative(phiRoot, file)}:${bad && bad.line + 1}: '${bad?.text}' is ${bad?.scopes.join(' ')}`);
    }
});
