// Reference text for keywords, types and the standard library, taken from docs/language.md.

export interface KeywordInfo {
    /** how it's written, shown as code */
    syntax: string;
    description: string;
}

export const primitiveTypes: Record<string, KeywordInfo> = {
    int: { syntax: 'int name: 0;', description: '4 bytes, signed: -2147483648 to 2147483647 (also `i32`).' },
    i32: { syntax: 'i32 name: 0;', description: '4 bytes, signed: -2147483648 to 2147483647 (same as `int`).' },
    u32: { syntax: 'u32 name: 0;', description: '4 bytes, unsigned: 0 to 4294967295. Math with a `u32` or a pointer is unsigned.' },
    i64: { syntax: 'i64 name: 0;', description: '8 bytes, signed. Math with one on either side happens in 64 bits.' },
    u64: { syntax: 'u64 name: 0;', description: '8 bytes, unsigned. Math with one on either side happens in 64 bits, unsigned.' },
    f16: { syntax: 'f16 name: 1.5;', description: '2 bytes, floating point.' },
    f32: { syntax: 'f32 name: 1.5;', description: '4 bytes, floating point.' },
    f64: { syntax: 'f64 name: 1.5;', description: '8 bytes, floating point.' },
    chr: { syntax: "chr name: 'a';", description: 'A character: 1 byte, 0 to 255, that `log` and text write as its character. A `str`\'s characters (`name:0`) are `chr`. A method ending in one gives a `chr`, if each `return` is a character too.' },
    lock: { syntax: 'lock name;\n\nlocked name\n    ...\n;;', description: 'What a `locked` block holds, so that only one thread (or core) runs it at a time.' },
    i16: { syntax: 'i16 name: 0;', description: '2 bytes, signed: -32768 to 32767.' },
    u16: { syntax: 'u16 name: 0;', description: '2 bytes, unsigned: 0 to 65535.' },
    i8: { syntax: 'i8 name: 0;', description: '1 byte, signed: -128 to 127.' },
    u8: { syntax: 'u8 name: 0;', description: '1 byte, unsigned: 0 to 255 (also `byt`). Wraps around at 256.' },
    byt: { syntax: 'byt name: 0;', description: '1 byte, unsigned: 0 to 255 (same as `u8`).' },
    bln: { syntax: 'bln name: false;', description: '1 byte: `true` or `false` (stored as 1 and 0).' },
    str: {
        syntax: "str name: 'text';   str buffer: [40];",
        description: 'Text with a fixed amount of room, decided when it is declared: the length of its first value, `[n]` characters, 11 for a number, or as much as another `str`. Longer text is cut to fit. `.len` is its current length.',
    },
    ptr: {
        syntax: 'ptr<T> name: address;',
        description: 'A 32-bit address of memory holding `T` values. Index it like an array (`p:3`); adding to it moves it by that many *bytes*. Never bounds-checked. A `ptr<u8>` prints as zero-terminated text.',
    },
    var: { syntax: 'var name: value;', description: '`str` if every value is a string, otherwise `int`.' },
    dec: { syntax: 'dec', description: 'Decimal numbers. **Not supported yet.**' },
    fin: { syntax: 'fin', description: 'Fixed decimal numbers. **Not supported yet.**' },
};

export const keywords: Record<string, KeywordInfo> = {
    phi: {
        syntax: 'phi.Name:Base\n{\n    ...\n}',
        description: 'A class. The base says where its code runs: `Bootloader` (the 512-byte boot sector), `OS` (16-bit code loaded after it), `Kernel` (a 32-bit kernel), `Program` (a user program inside a kernel) or `Library` (shared code).',
    },
    struct: { syntax: 'struct.Name\n{\n    u32 id;\n    ptr<Name> next;\n}', description: 'A struct. Fields are laid out in order with no padding. Structs can contain structs, fixed arrays and pointers.' },
    asm: { syntax: 'asm.Name\n{\n    mov eax, [{value}]\n    ret\n}', description: 'A block of NASM assembly. `{name}` is a class variable\'s address, `{CONST}` a constant\'s value. Must end with `ret`. Call it with `call Name;`; `call x is Name;` stores `eax`.' },
    arm: { syntax: 'arm.Name { ... }', description: 'An ARM assembly block. Parsed, but can\'t be called yet.' },
    use: { syntax: 'use drivers.vga_text;', description: '`use a.b;` loads `a/b.phi`: next to this file, then next to the main program, then from the standard library (`lib/phi`). Each file is loaded once, and its classes run first.' },
    const: { syntax: 'const u16 COM1: 0x3F8;', description: 'A constant. Its value must be known when the program is built. Takes no memory; usable as an array size and inside `asm.` blocks as `{NAME}`.' },
    if: { syntax: 'if condition\n    ...\n;;', description: 'Runs the block when the condition is true (any number but 0). The condition ends at the end of its line. Blocks end with `;;`.' },
    elif: { syntax: 'elif condition\n    ...\n;;', description: 'Another condition, checked when the `if` before it was false.' },
    else: { syntax: 'else\n    ...\n;;', description: 'Runs when every `if`/`elif` before it was false.' },
    while: { syntax: 'while condition\n    ...\n;;\n\nwhile int i: 0; i < n; i++;\n    ...\n;;', description: 'Repeats the block while the condition is true. The second form declares a counter, a condition and a step.' },
    unsafe: { syntax: 'unsafe\n    buffer:i is 0;\n;;', description: 'Code inside isn\'t bounds-checked: you promise every index is in range.' },
    call: { syntax: 'call Method: arg1 arg2;\ncall result is Method: arg;', description: 'Calls a method, built-in function or `asm.` block. Arguments are separated by spaces. `call x is ...` stores what it returns.' },
    log: { syntax: "log 'Score: ' score '\\r\\n';", description: 'Prints to the screen and the serial port (COM1). Strings print as text, numbers in decimal. On the screen a new line needs `\\r\\n`.' },
    debug: { syntax: "debug 'x = ' x '\\n';", description: 'Prints to the serial port only: handy while developing.' },
    ask: { syntax: 'ask name;', description: 'Reads a line from the keyboard into a `str`.' },
    exit: { syntax: 'exit 0;', description: 'Stops QEMU with an exit code (used by tests); halts on real hardware. In a program, ends the program.' },
    out: { syntax: "out 0x3F8 'A';", description: 'Writes a byte to an I/O port. A negative value needs parentheses: `out port (-1);`.' },
    outw: { syntax: 'outw port value;', description: 'Writes 16 bits to an I/O port.' },
    outd: { syntax: 'outd port value;', description: 'Writes 32 bits to an I/O port.' },
    in: { syntax: 'u8 status: in 0x3FD;', description: 'Reads a byte from an I/O port.' },
    inw: { syntax: 'u16 value: inw port;', description: 'Reads 16 bits from an I/O port.' },
    ind: { syntax: 'u32 value: ind port;', description: 'Reads 32 bits from an I/O port.' },
    new: { syntax: 'new Task t: 1 2;\nptr<Task> p: new Task;\nptr<u8> b: new u8[512];', description: 'An object PHI frees when it\'s done with it, or memory from the heap, all zeros. In 32-bit kernels and every program.' },
    free: { syntax: 'free pointer;', description: 'Gives memory from `new` back to the heap. Freeing twice stops the program with a message.' },
    addr: { syntax: 'ptr<u8> p: addr buffer;\ncall OS.SetInterruptHandler: 0x09 addr Handler;', description: 'The address of a variable, element or field (as a pointer), or of a method (for interrupt handlers).' },
    is: { syntax: 'x is 5;\nif x is 5', description: 'Assignment (like `=`), or the comparison `==` in a condition. `is not` is `!=`.' },
    not: { syntax: 'if not ready', description: 'Logical not (also `!`). `is not` compares for inequality.' },
    and: { syntax: 'if a and b', description: 'True when both sides are true.' },
    or: { syntax: 'if a or b', description: 'True when either side is true.' },
    below: { syntax: 'if lives below 3', description: 'Word form of `<`.' },
    above: { syntax: 'if lives above 0', description: 'Word form of `>`.' },
    atmost: { syntax: 'if score atmost 10', description: 'Word form of `<=`.' },
    atleast: { syntax: 'if score atleast best', description: 'Word form of `>=`.' },
    has: { syntax: "if list has x\nif text has 'abc'\n\nstruct.Circle has Shape", description: 'Whether an array holds a value, or text holds other text or a character. After a struct\'s name, the interfaces it has.' },
    enum: { syntax: 'enum.Tool\n{\n    PENCIL\n    ERASER: 10\n}\n\nTool tool: Tool.PENCIL;', description: 'Named values of a type of their own. Each is one more than the one before unless it says.' },
    interface: { syntax: 'interface.Shape\n{\n    [Area]\n    [Grow: int by;]\n}\n\nstruct.Circle has Shape', description: 'The methods a struct with it has. A variable of it holds any such struct, and calling a method runs that struct\'s.' },
    x64: { syntax: 'x64.Name\n{\n    mov rax, 1\n    ret\n}', description: 'A block of 64-bit NASM assembly, beside the `asm.Name` block of the same name for 32 bits. It\'s called the same way: `call asm.Name;`.' },
    sys: { syntax: 'sys.Read: 3  int fd  ptr<u8> buffer  u32 count;\n\ncall n is sys.Read: fd addr buffer 512;', description: 'A system call of a Linux module, by its number.' },
    foreign: { syntax: 'struct.Message foreign\n\nint done: (User32.EnumWindows: addr foreign OnWindow 0);', description: 'For outside code: a struct laid out as C does, or the place outside code can call a method.' },
    volatile: { syntax: 'volatile u32 ready;', description: 'Memory that changes by itself, like a device\'s, or another thread\'s: it\'s read and written every time.' },
    into: { syntax: 'method<str into: int> writer;', description: 'In a method value\'s type: the method writes this parameter, which is the caller\'s own text.' },
    each: { syntax: 'while each score in scores\n    ...\n;;', description: 'Goes through an array\'s elements in order, without a counter.' },
    when: { syntax: "when key\n    is 'q' 27\n        exit 0;\n    ;;\n    else\n        ...\n    ;;\n;;", description: 'Runs the first branch whose values match, or its `else`.' },
    atomic: { syntax: 'atomic hits++;\natomic owner is 7;', description: 'One step on a number that no other thread or core can come between.' },
    locked: { syntax: 'lock guard;\n\nlocked guard\n    ...\n;;', description: 'A block only one thread (or core) at a time runs under this `lock`.' },
    throw: { syntax: "throw 'no such file: ' path;", description: 'Stops with an error: an `if call ... throws` around it catches it, and otherwise the program stops and says so.' },
    throws: { syntax: 'if call Load: path throws err\n    log err;\n;;', description: 'Runs the block if the call stopped with an error, which is in the name after `throws`.' },
    break: { syntax: 'while true\n    if done break;\n;;', description: 'Leaves the innermost `while` loop.' },
    continue: { syntax: 'while int i: 0; i < n; i++;\n    if i is skip continue;\n;;', description: 'Skips to the next turn of the innermost `while` loop (its step still runs).' },
    return: { syntax: 'return;\nreturn value;', description: 'Leaves the method early, with a value in a method that has one.' },
    sizeof: { syntax: 'int bytes: sizeof Entry;', description: 'The size in bytes of a type, struct or variable. For a `str` variable, its room plus the ending zero.' },
    as: { syntax: 'w:0.data as ptr<Note>\ncount as u8', description: 'Uses a value as another type: a pointer as another kind of pointer, or a number as a smaller type.' },
    takes: { syntax: 'node.next takes head;', description: 'Hands an object over without copying: frees what the left side held, gives it the right side\'s memory, and leaves the right side `empty`.' },
    empty: { syntax: 'new Node next: empty;\nwhile walk.next is not empty', description: 'No object: what a `new` variable or field holds before one is assigned.' },
    at: { syntax: 'new Cell corner at 0xB8000;', description: 'An object over memory that already exists (device memory, a table the BIOS left). Nothing is allocated or freed.' },
    method: { syntax: 'method<int int: int> handler;', description: 'A method as a value: a variable, field or array that holds a method to call later.' },
    true: { syntax: 'true', description: 'Stored as 1.' },
    false: { syntax: 'false', description: 'Stored as 0.' },
    isr: { syntax: '[isr Name]\n    ...\n    call OS.EndOfInterrupt: 1;\n[end]', description: 'An interrupt handler: saves and restores every register and returns with `iret`. No parameters, no return value, and it can\'t be called with `call`. Install it with `call OS.SetInterruptHandler: vector addr Name;`.' },
    end: { syntax: '[end]\n[end: value]', description: 'Ends a method. `[end: value]` returns a value: a number, a `chr`, a pointer, a `str` or an object.' },
    len: { syntax: 'list.len', description: 'The number of elements of an array in use, or the current length of a `str`.' },
    max: { syntax: 'list.max', description: 'The most elements an array can hold, or the most characters a `str` can.' },
};

export const classBases: Record<string, string> = {
    Bootloader: '16-bit boot sector at `0x7C00`; exactly one, and it must fit in 512 bytes.',
    OS: '16-bit code loaded at `0x7E00` after the boot sector (up to 32 KB) by `call Bootloader.JumpToSectorTwo;`.',
    Kernel: '32-bit protected-mode kernel, loaded at `0x10000` (up to 512 KB).',
    Program: 'A program: in a kernel\'s `rootfs` folder it runs on PHI OS, and with `--target` it\'s an ordinary Linux or Windows program, in 32 or 64 bits.',
    Library: 'Shared code, like drivers. It joins whichever program uses it.',
    Linux: 'A module only for Linux programs, 32 or 64 bits.',
    Linux32: 'A module only for 32-bit Linux programs.',
    Linux64: 'A module only for 64-bit Linux programs.',
    Windows: 'A module only for Windows programs, 32 or 64 bits.',
    PhiOS: 'A module only for programs on PHI OS.',
};

/** Standard library files, for when the library folder itself can't be found. */
export const standardLibrary: Record<string, string> = {
    'drivers.vga_text': 'class `Vga`: `Clear`, `SetColor: fg bg`, `SetCursor: row column`, `PutChar: c`, `Print: text`, `PrintNumber: n`, scrolling, the hardware cursor',
    'boot.info': '32-bit kernels: `Boot.info`, a `ptr<BootInfo>` to what the loader found (memory map, boot drive, cursor)',
    'memory.frames': '32-bit kernels: class `Frames`, physical memory in 4 KB frames',
    'memory.paging': '32-bit kernels: class `Paging`, identity paging with page 0 unmapped',
    'memory.heap': '32-bit kernels: class `Heap`: `Alloc: size`, `Free: address`, `LargestFree`',
    'memory.list': '32-bit kernels: class `List`, a growable list of u32 values',
    'drivers.ata': 'class `Ata`: `Read: lba count buffer`, `Write: lba count buffer` for the IDE disk',
    'drivers.disk': 'class `Disk`: the disk\'s FAT partition as numbered sectors',
    'fs.fat16': '32-bit kernels: class `Fat`: `ReadFile`, `WriteFile`, `Delete`, `List`, `Exists`, `FileSize`',
    'proc.process': '32-bit kernels: class `Process`: `Spawn: path`, `Wait: pid`, `WaitAll`',
    'user.text': 'class `Text` (any program): `Length`, `Equal`, `StartsWith`, `CopyWord`, `Append`, `ToNumber`, ...',
    'drivers.rtc': 'class `Rtc`: `Read` fills in `year month day hour minute second` from the CMOS clock',
};

export const primitiveTypeNames = Object.keys(primitiveTypes).filter(t => t !== 'ptr');

/** Words that can never be a variable or method name (the compiler's Parser.ReservedWords). */
export const reservedWords = new Set<string>([
    ...Object.keys(primitiveTypes), 'method',
    'phi', 'struct', 'enum', 'interface', 'asm', 'x64', 'arm', 'sys', 'foreign', 'use', 'const', 'volatile', 'into',
    'if', 'elif', 'else', 'while', 'each', 'when', 'unsafe', 'call',
    'break', 'continue', 'return', 'atomic', 'locked', 'throw', 'throws',
    'log', 'debug', 'ask', 'exit', 'out', 'outw', 'outd', 'in', 'inw', 'ind', 'new', 'free', 'addr',
    'sizeof', 'as', 'takes', 'empty', 'at',
    'is', 'not', 'and', 'or', 'below', 'above', 'atmost', 'atleast', 'true', 'false', 'has', 'isr', 'end',
]);
