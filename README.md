# PHI for Visual Studio Code

Language support for [PHI](https://github.com/BrandonHilde/PHI), the language for boot sectors, 32-bit kernels, PHI OS, and programs for Linux, Windows and macOS. It's up to date with PHI 1.0.

## Features

- **Syntax highlighting** that follows the compiler's own rules: `#` comments, a lone `#` that opens
  a block comment, `'hasn't'`-style strings, `;;` block ends, `[Method: ...]` / `[end: value]`,
  and assembly highlighting inside `asm.Name { }`, `x64.Name { }` and `arm.Name { }` blocks, including `{variable}` and `{CONSTANT}`.
  `` ```phi `` code blocks in Markdown are highlighted too.
- **Errors as you type**, from `phi lsp`, the compiler's language server, in the Problems panel and
  as squiggles. Unsaved text counts, in the file and in the modules you have open. A module is
  checked inside a program around it, or one that uses it, and only its own errors are shown.
- **Hovers** for your methods, variables, structs and constants (with the comments above them),
  every built-in `OS.` / `Bootloader.` function, `Colors`, keywords and types.
- **Go to definition**, **find references**, **highlight** and **rename** across files, following
  `use` the way the compiler does. Ctrl+click a `use drivers.vga_text;` path to open the file;
  `use vendor.raylib;` opens the module in PHI's vendor folder.
- **Completion**: `OS.` and `Bootloader.` built-ins, `Colors.`, `Class.` members, struct fields,
  `use` paths from the standard library, the vendor folder and your folders, locals, keywords and snippets.
- **Signature help** for space-separated arguments: `call OS.DrawRectangle: x y |width| height color`.
- **Outline**, breadcrumbs, **workspace symbols** (Ctrl+T) and **folding** for classes, structs,
  methods, `if`/`while` blocks, asm blocks and comments.
- **Build and run**: ▶ in the editor title (or F5) follows the file. A kernel or a boot sector
  builds and boots in QEMU. A program by itself (`phi.Name:Program`) can't boot, so it builds
  and runs on your system: **Build and Run on Linux**, **on Windows** or **on macOS**, with a
  32-bit one in the ▶ menu, and **PHI: Build for…** builds it for any system. The PHI
  menu in the editor's context menu has Check, Build, Run and **Show Generated Assembly**, which
  opens the `.asm` beside your code at the line the cursor is on.
- A **`phi` task type** for `tasks.json`, with a `$phi` problem matcher.

## Requirements

The PHI compiler, one of two ways:

- **A release**: unzip `phi-1.0.0-linux-x64.zip`, `-windows-x64.zip` or `-macos-arm64.zip` from
  [PHI's releases](https://github.com/BrandonHilde/PHI/releases) anywhere, and put its folder on
  your `PATH` (or point `phi.compilerPath` at the `phi` in it). The standard library and the
  vendor folder beside it are found from there.
- **From source**: install the .NET 10 SDK, then run `dotnet build PHI.sln` in the PHI repository.
  The extension finds that compiler on its own when you open the PHI repository (or a folder
  inside it).

Otherwise run **PHI: Locate Compiler…**, or set `phi.compilerPath`.
Building and running need `nasm` and `qemu-system-i386`, on `PATH` or set with `phi.nasmPath` and
`phi.qemuPath`.

## Install

1. Install the PHI compiler (see [Requirements](#requirements)).
2. Build the extension package. The `.vsix` isn't in git, so build it from source (needs Node.js 18 or later):

   ```
   ./build.sh          # Linux and macOS
   build.bat           # Windows
   ```

   Either installs what it needs, compiles, runs the tests and writes `phi-language-<version>.vsix`
   here. `--skip-tests` leaves the tests out, and `--install` installs the package into VS Code too.

3. Install the package with `code --install-extension phi-language-<version>.vsix`, or open the Extensions view in VS Code, choose `…` → **Install from VSIX…**, and pick the file.

## Settings

| Setting | Default | |
|---|---|---|
| `phi.compilerPath` | | Path to `phi` / `phi.exe`. Empty: `PATH`, then `Compiler/Phi.Cli/bin/*/net10.0/` in the workspace or its parents. |
| `phi.libraryPath` | | Path to `lib/phi`, for `use` navigation. Empty: found next to the compiler. |
| `phi.validate` | `onType` | `onType`, or `off` for no compiler errors. (`onSave` differs only with a `phi` too old to have `phi lsp`, when it runs `phi check` on open and save.) |
| `phi.validateDelay` | `600` | Only with a `phi` too old to have `phi lsp`: milliseconds to wait after typing before running `phi check`. |
| `phi.nasmPath`, `phi.qemuPath` | | Passed to the compiler as `PHI_NASM` and `PHI_QEMU`. |

## Commands

| Command | |
|---|---|
| PHI: Check File | Say how many errors the file has, and open the Problems panel if there are any |
| PHI: Restart Language Server | Start `phi lsp` again (it does this by itself when `phi` is rebuilt) |
| PHI: Build | `phi build` the current file |
| PHI: Build and Run in QEMU (F5) | `phi run`: serial output appears in the terminal |
| PHI: Build and Run in QEMU (wait for gdb) | `phi run --debug`: QEMU waits for gdb on `localhost:1234` |
| PHI: Build and Run on Linux / Windows / macOS (F5 in a program) | `phi run --target linux64` (`windows64`, `macos`): the program runs in the terminal. The one for your system is offered; a Linux program runs on Windows too, under WSL |
| PHI: Build and Run on Linux (32-bit) / Windows (32-bit) | `phi run --target linux` (`windows`) |
| PHI: Build for… | Pick a system and `phi build --target` it: a Windows program can be built on Linux, and so on (a macOS one needs a Mac) |
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

A program for Linux, Windows or macOS is built with `--target` (`linux`, `linux64`, `windows`,
`windows64`, `macos`). The commands above give it; a task gives it in its `args`:

```json
{ "type": "phi", "command": "run", "file": "${file}", "args": ["--target", "linux64"], "problemMatcher": ["$phi"] }
```

## Developing the extension

The tests look for the PHI repository at `$PHI_ROOT`, then in either of these places:

```
<parent>/
├── Libraries/PHI          the PHI repository
└── Projects/PHI-VSCODE    this repository

<parent>/
├── PHI                    the PHI repository
└── PHI-VSCODE             this repository
```

```
npm install
npm test                    # grammar, scanner, resolver and compiler tests (reads the PHI repository)
npm run test:integration    # every feature, inside a real VS Code with a throwaway profile
npm run sync-builtins       # regenerate the built-in function table from the compiler's Builtins.cs
npm run package             # make phi-language-<version>.vsix
./build.sh                  # all of it: install, compile, test, package (build.bat on Windows)
```

Press F5 in this folder to start an Extension Development Host with the extension loaded. F5 compiles
the extension first, so run `npm install` beforehand (`out/` isn't in git). The host opens the PHI
repository as its folder, so the extension activates and finds the compiler there.
`PHI_ROOT` points the tests at a PHI repository somewhere else. The tests that compare the
extension with the compiler (its reserved words, its class bases, every `.phi` file it has) are how
a new PHI is caught up with: run them against it, and `npm run sync-builtins`.
