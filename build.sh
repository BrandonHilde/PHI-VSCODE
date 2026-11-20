#!/usr/bin/env sh
# Builds the extension into a .vsix: phi-language-<version>.vsix, in this folder.
#
#   ./build.sh                  install what it needs, compile, run the tests, package
#   ./build.sh --skip-tests     package without running the tests
#   ./build.sh --install        and install the .vsix into VS Code (the `code` on PATH)
#
# It needs Node.js 18 or later (with npm). The tests read the PHI repository when it's at
# $PHI_ROOT, ../../Libraries/PHI or ../PHI, and leave those parts out when it isn't.
set -eu
cd "$(dirname "$0")"

tests=yes
install=no
for option in "$@"; do
    case "$option" in
        --skip-tests) tests=no ;;
        --install) install=yes ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "build.sh: unknown option $option (--skip-tests, --install)" >&2; exit 2 ;;
    esac
done

if ! command -v npm >/dev/null 2>&1; then
    echo "build.sh: npm isn't on PATH: install Node.js 18 or later (https://nodejs.org)" >&2
    exit 1
fi

# what package-lock.json says, exactly: only when it's changed since the last install
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci
fi

if [ "$tests" = yes ]; then
    npm test
fi

version=$(node -p "require('./package.json').version")
vsix="phi-language-$version.vsix"
rm -f "$vsix"
npm run package                 # compiles first (vscode:prepublish)

if [ ! -f "$vsix" ]; then
    echo "build.sh: $vsix wasn't made" >&2
    exit 1
fi
echo
echo "built $(pwd)/$vsix"

if [ "$install" = yes ]; then
    if ! command -v code >/dev/null 2>&1; then
        echo "build.sh: code isn't on PATH: install it by hand, code --install-extension $vsix" >&2
        exit 1
    fi
    code --install-extension "$vsix" --force
else
    echo "install it with: code --install-extension $vsix --force"
fi
