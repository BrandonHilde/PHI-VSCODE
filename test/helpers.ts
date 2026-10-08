import * as fs from 'fs';
import * as path from 'path';

/** The PHI repository, for tests that read real PHI code. */
export const phiRoot = process.env.PHI_ROOT || path.resolve(__dirname, '../../../../Libraries/PHI');
export const haveRepo = fs.existsSync(path.join(phiRoot, 'lib', 'phi'));

export function phiFiles(dir = phiRoot): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const name of fs.readdirSync(d)) {
            if (['.git', 'build', 'bin', 'obj', 'node_modules'].includes(name)) continue;
            const p = path.join(d, name);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (name.endsWith('.phi')) out.push(p);
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
}

/** Source with a '|' marking the cursor: returns the text without it and the cursor's offset. */
export function cursor(source: string): { text: string; offset: number } {
    const offset = source.indexOf('|');
    if (offset < 0) throw new Error('no | in source');
    return { text: source.slice(0, offset) + source.slice(offset + 1), offset };
}
