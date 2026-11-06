# Changelog

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
