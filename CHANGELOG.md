# Changelog

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
