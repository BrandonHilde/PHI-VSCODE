# Changelog

## Not yet released

- ▶ and F5 follow the file. A program by itself (`phi.Name:Program`) can't boot in QEMU, so it
  gets **Build and Run on Linux** (or **on Windows**, **on macOS**: your system's), which is
  `phi run --target linux64`, with a 32-bit one beside it in the ▶ menu; a kernel or a boot
  sector has **Build and Run in QEMU** as before. **PHI: Build for…** builds a program for
  any system.

Up to date with PHI 1.0:

- New words highlighted, described on hover and completed: C's `lng`, `ulng`, `isz` and `usz`,
  `exists`, and the class base `MacOS`. `arm.Name` blocks are described as what a macOS program
  takes.
- Methods that take types: the heading (`[Largest<Item>: Item items[];]`,
  `[Higher<Item has Ranked>: ...]`) and the types a call gives (`(Lists.Largest<int>: scores)`,
  `(counts.Sum<i64>)`) are highlighted, and the outline, hovers and signature help read such a
  method's parameters. `struct.Sorted<Item has Ranked>` shows the interface its type must have.
- Text past ASCII: `\uNNNN` and `\UNNNNNNNN` are escapes.
- `if players has p when p.score is 0` declares `p`, of what the list holds, so its fields are
  found and completed.
- `struct.Texture2D is Texture;`, another name for a struct: highlighted, in the outline, and a
  variable of one finds the other's fields.
- A library with a file named for each system, `use 'zlib1.dll' '/usr/lib/libz.1.dylib'
  'libz.so.1' as Z;`, is highlighted whole.
- The vendor folder: `use vendor.raylib;` goes to its module, its hover says what the library
  is, and `use` completes the libraries PHI comes with. The language server is told where the
  folder is, which it lost when run from a copy of `phi`, so such a program no longer says it
  can't find it.
- Pointers to pointers and to vectors (`ptr<ptr<u8>> rows;`, `ptr<vec<u8>> blocks;`) are
  highlighted as types, with no comparison in them.
- Fixed: a method's first parameter of a struct's type (`[Draw: Player p;]`) wasn't found; a
  heading with an array parameter (`[Sum: int items[];]`) was cut short at its `[]`; an
  array's second size (`int table[ROWS][COLS];`) read as a method; a file starting with
  `const` stopped the scanner. A file of methods with no class around them (a vendor library's
  `class.phi`) has an outline.
- Hovers follow 1.0's facts: a struct is laid out as C's is, a kernel is loaded at `0x100000`,
  a `str` is UTF-8 and grows, `throws` on an `[end: ...]` line says which answers fail.
- The built-in functions are up to date with the compiler.
- `build.sh` and `build.bat` build the `.vsix` in one step. The tests find the PHI repository
  in a folder beside this one too (`../PHI`).
- `vec<T>`, PHI's vectors (`vec<f32> v: 1.0 2.0 3.0 4.0;`), is highlighted as a type, as
  `ptr<T>` is.
- `dec` and `fin` aren't types any more (PHI has taken them out: its numbers are whole ones
  to `i64` and floating ones to `f64`), so they're no longer highlighted or described as ones.

## 0.3.1

Structs that take types, which PHI now has (`struct.Stack<Item>`, used as `Stack<int>`):

- Highlighting: the heading with the names of its types, and variables of one
  (`new Stack<int> undo;`, `Pair<u8 Player> both;`, `new Map<str Stack<int>> deep;`). A
  comparison such as `total < limit and limit > 3` is still a comparison.
- The outline and hovers show the whole heading, `struct.Map<Key Value> has Shown`.
- A variable of one is found as a variable, with its whole type (`Stack<int>`,
  `ptr<Stack<int>>`), and go to definition and completion on its fields and methods go to
  the struct, as they do for any struct's.

## 0.3.0

Catches up with the language since 0.1.1, which reserved words last matched:

- Highlighting, hovers and completion for everything added: `i64` `u64` `f16` `f32` `f64` `chr`
  `lock`; `enum.Name`, `interface.Name` and `struct.Name has A`; `x64.Name` blocks and their
  registers; `when`, `while each`, `locked`, `atomic`, `throw`, `throws`, `volatile`, `foreign`,
  `into`; `sys.Name` and `use 'x.dll' as Name`; `.max`; and the class bases `Linux`, `Linux32`,
  `Linux64`, `Windows` and `PhiOS`.
- The outline, symbols, hovers and go to definition know enums and their values, and interfaces
  and their methods. `x64` blocks are read as assembly, not code.
- Found as variables: `new Thing t;`, `ptr<ptr<u8>> rows`, `method<int: int> f`,
  `while each x in list`, `if call F throws err` and `is Player p`.
- Folding and indenting: `when` and its branches and `locked` blocks. An `if` on one line, with no
  `;;`, no longer upsets the folds around it or indents the next line.
- `x as int` at the end of a line no longer reads as a declaration of what starts the next line.
- Snippets for `when`, `each`, `enum`, `interface`, `locked` and catching an error.
- Tests compare the reserved words and class bases with the compiler's, so they can't drift apart.
- The built-in functions are up to date with the compiler.

## 0.2.0

- Uses `phi lsp`, the compiler's language server, for what only the compiler really knows:
  - Errors as you type, from the text as it is: no hidden copies, and a program sees what's
    unsaved in the modules you have open. `phi.validate` is `onType` by default.
  - Go to definition asks it first, so `a.b:i.c` goes to what it really is.
  - Completion: it says which names can go there (after `spots:1.`, only that struct's), and
    the extension adds what it knows about them.
- A module of the standard library no longer shows errors for not being a program.
- The server runs from a copy of `phi`, so `dotnet build` still works, and it starts again by
  itself when `phi` is rebuilt. New command: **PHI: Restart Language Server**.
- With a `phi` too old to have `phi lsp`, everything works as it did in 0.1.
- The built-in functions are up to date with the compiler.

## 0.1.1

- Reserved words match the compiler: `at`, `break`, `continue`, `return`, `sizeof`, `as`,
  `takes`, `empty` and `method` are keywords, with hovers and highlighting
- `\xNN` escapes in strings highlight as escapes
- Methods declared inside a struct are found (outline, symbols and folding)

## 0.1.0

First release.

- Syntax highlighting for PHI, including asm blocks and `phi` code blocks in Markdown
- `phi check` diagnostics on open and save, or while typing
- Hovers, go to definition, references, highlights and rename across `use`d files
- Completion for built-ins, colors, class members, struct fields and `use` paths; snippets
- Signature help for space-separated arguments
- Outline, workspace symbols and folding
- Build, run in QEMU (with gdb), test and show-assembly commands; a `phi` task type and `$phi` problem matcher
