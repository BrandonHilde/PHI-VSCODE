# Changelog

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
