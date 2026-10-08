// Finds the code generated for a PHI source line in the compiler's .asm output, which marks
// each class (`; ---- class Name`), each method (`; method Class.Name`) and each source line
// (`; 12: log 'hi';`).

export interface AsmLocation {
    /** 0-based line in the .asm file */
    line: number;
    /** true when the exact source line was found, false for the nearest one before it */
    exact: boolean;
}

/**
 * @param asm the .asm text
 * @param className the class the source line is in
 * @param methodName the method it's in, if any
 * @param sourceLine 1-based line in the .phi file
 */
export function findAsmLine(asm: string, className: string | undefined, methodName: string | undefined, sourceLine: number): AsmLocation | undefined {
    const lines = asm.split(/\r?\n/);
    const sectionHeader = methodName && className
        ? `; method ${className}.${methodName}`
        : className ? `; ---- class ${className}` : undefined;

    // the section for this class or method: from its header to the next header
    let from = 0, to = lines.length;
    if (sectionHeader) {
        const start = lines.findIndex(l => l.trim() === sectionHeader);
        if (start >= 0) {
            from = start;
            const next = lines.findIndex((l, i) => i > start && /^\s*; (?:----|method )/.test(l));
            to = next >= 0 ? next : lines.length;
        }
    }

    let best: AsmLocation | undefined;
    let bestLine = -1;
    for (let i = from; i < to; i++) {
        const m = /^\s*; (\d+): /.exec(lines[i]);
        if (!m) continue;
        const n = +m[1];
        if (n === sourceLine) return { line: i, exact: true };
        if (n < sourceLine && n > bestLine) { bestLine = n; best = { line: i, exact: false }; }
    }
    return best ?? (sectionHeader && from > 0 ? { line: from, exact: false } : undefined);
}
