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
    new: { syntax: 'ptr<Task> t: new Task;\nptr<u8> b: new u8[512];', description: '32-bit kernels: memory from the kernel heap, all zeros. Returns 0 when the heap has no room.' },
    free: { syntax: 'free pointer;', description: '32-bit kernels: gives memory from `new` back to the heap. Freeing twice stops the kernel with a message.' },
    addr: { syntax: 'ptr<u8> p: addr buffer;\ncall OS.SetInterruptHandler: 0x09 addr Handler;', description: 'The address of a variable, element or field (as a pointer), or of a method (for interrupt handlers).' },
    is: { syntax: 'x is 5;\nif x is 5', description: 'Assignment (like `=`), or the comparison `==` in a condition. `is not` is `!=`.' },
    not: { syntax: 'if not ready', description: 'Logical not (also `!`). `is not` compares for inequality.' },
    and: { syntax: 'if a and b', description: 'True when both sides are true.' },
    or: { syntax: 'if a or b', description: 'True when either side is true.' },
    below: { syntax: 'if lives below 3', description: 'Word form of `<`.' },
    above: { syntax: 'if lives above 0', description: 'Word form of `>`.' },
    atmost: { syntax: 'if score atmost 10', description: 'Word form of `<=`.' },
    atleast: { syntax: 'if score atleast best', description: 'Word form of `>=`.' },
    true: { syntax: 'true', description: 'Stored as 1.' },
    false: { syntax: 'false', description: 'Stored as 0.' },
    isr: { syntax: '[isr Name]\n    ...\n    call OS.EndOfInterrupt: 1;\n[end]', description: 'An interrupt handler: saves and restores every register and returns with `iret`. No parameters, no return value, and it can\'t be called with `call`. Install it with `call OS.SetInterruptHandler: vector addr Name;`.' },
    end: { syntax: '[end]\n[end: value]', description: 'Ends a method. `[end: value]` returns a value (a number or a `str`).' },
    len: { syntax: 'list.len', description: 'The number of elements of an array, or the current length of a `str`.' },
};

export const classBases: Record<string, string> = {
    Bootloader: '16-bit boot sector at `0x7C00`; exactly one, and it must fit in 512 bytes.',
    OS: '16-bit code loaded at `0x7E00` after the boot sector (up to 32 KB) by `call Bootloader.JumpToSectorTwo;`.',
    Kernel: '32-bit protected-mode kernel, loaded at `0x10000` (up to 512 KB).',
    Program: 'A user program that runs inside a 32-bit kernel in ring 3. Put it in a kernel\'s `rootfs` folder.',
    Library: 'Shared code, like drivers. It joins whichever program uses it.',
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

/** Words that can never be a variable or method name. */
export const reservedWords = new Set<string>([
    ...Object.keys(primitiveTypes),
    'phi', 'struct', 'asm', 'arm', 'use', 'const', 'if', 'elif', 'else', 'while', 'unsafe', 'call',
    'log', 'debug', 'ask', 'exit', 'out', 'outw', 'outd', 'in', 'inw', 'ind', 'new', 'free', 'addr',
    'is', 'not', 'and', 'or', 'below', 'above', 'atmost', 'atleast', 'true', 'false', 'has', 'isr', 'end',
]);
