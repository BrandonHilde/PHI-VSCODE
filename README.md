# PHI for Visual Studio Code

Language support for [PHI](https://github.com/BrandonHilde/PHI), the language for boot sectors, 32-bit kernels and PHI OS.

## Features

- **Syntax highlighting** that follows the compiler's own rules: `#` comments, a lone `#` that opens
  a block comment, `'hasn't'`-style strings, `;;` block ends, `[Method: ...]` / `[end: value]`,
  and x86 highlighting inside `asm.Name { }` blocks, including `{variable}` and `{CONSTANT}`.
  `` ```phi `` code blocks in Markdown are highlighted too.
- **Errors as you work**: `phi check` runs when you open or save a file, and its errors appear in
  the Problems panel and as squiggles. Set `phi.validate` to `onType` to check while typing.
- **Hovers** for your methods, variables, structs and constants (with the comments above them),
  every built-in `OS.` / `Bootloader.` function, `Colors`, keywords and types.
- **Go to definition**, **find references**, **highlight** and **rename** across files, following
  `use` the way the compiler does. Ctrl+click a `use drivers.vga_text;` path to open the file.
- **Completion**: `OS.` and `Bootloader.` built-ins, `Colors.`, `Class.` members, struct fields,
  `use` paths from the standard library and your folders, locals, keywords and snippets.
- **Signature help** for space-separated arguments: `call OS.DrawRectangle: x y |width| height color`.
- **Outline**, breadcrumbs, **workspace symbols** (Ctrl+T) and **folding** for classes, structs,
  methods, `if`/`while` blocks, asm blocks and comments.
- **Build and run**: ▶ in the editor title (or F5) builds and boots the file in QEMU. The PHI
  menu in the editor's context menu has Check, Build, Run and **Show Generated Assembly**, which
  opens the `.asm` beside your code at the line the cursor is on.
- A **`phi` task type** for `tasks.json`, with a `$phi` problem matcher.

## Requirements

The PHI compiler, built from the PHI repository:

1. Install the .NET 8 SDK, NASM and QEMU.
2. Run `dotnet build PHI.sln` in the PHI repository.

The extension finds the compiler on its own when you open the PHI repository (or a folder inside
it). Otherwise put `phi` on your `PATH`, run **PHI: Locate Compiler…**, or set `phi.compilerPath`.
Building and running need `nasm` and `qemu-system-i386`, on `PATH` or set with `phi.nasmPath` and
`phi.qemuPath`.

## Settings

| Setting | Default | |
|---|---|---|
| `phi.compilerPath` | | Path to `phi` / `phi.exe`. Empty: `PATH`, then `Compiler/Phi.Cli/bin/*/net8.0/` in the workspace or its parents. |
| `phi.libraryPath` | | Path to `lib/phi`, for `use` navigation. Empty: found next to the compiler. |
| `phi.validate` | `onSave` | `onSave`, `onType` (checks a hidden copy, `.NAME.phicheck.phi`, next to the file so `use` paths resolve) or `off`. |
| `phi.validateDelay` | `600` | Milliseconds to wait after typing before checking (`onType`). |
| `phi.nasmPath`, `phi.qemuPath` | | Passed to the compiler as `PHI_NASM` and `PHI_QEMU`. |

## Commands

| Command | |
|---|---|
| PHI: Check File | Run `phi check` and show the result |
| PHI: Build | `phi build` the current file |
| PHI: Build and Run in QEMU (F5) | `phi run`: serial output appears in the terminal |
| PHI: Build and Run in QEMU (wait for gdb) | `phi run --debug`: QEMU waits for gdb on `localhost:1234` |
| PHI: Run Tests | `phi test` in the nearest `tests/` folder |
| PHI: Show Generated Assembly | Build if needed, then open the `.asm` at the cursor's line |
| PHI: Locate Compiler… | Pick `phi.exe` and save it in `phi.compilerPath` |

## Tasks

```json
{
  "version": "2.0.0",
  "tasks": [
    { "type": "phi", "command": "build", "file": "${file}", "problemMatcher": ["$phi"], "group": "build" },
    { "type": "phi", "command": "test", "problemMatcher": [] }
  ]
}
```

## Developing the extension

```
npm install
npm test                    # grammar, scanner, resolver and compiler tests (reads ../../Libraries/PHI)
npm run test:integration    # every feature, inside a real VS Code with a throwaway profile
npm run sync-builtins       # regenerate the built-in function table from the compiler's Builtins.cs
npm run package             # make phi-language-<version>.vsix
```

Press F5 in this folder to start an Extension Development Host with the extension loaded.
`PHI_ROOT` points the tests at a PHI repository somewhere else.
