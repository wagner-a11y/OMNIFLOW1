// Resolve hook: troca services/supabase e services/pipefy pelos stubs.
// Só casa o especificador EXATO desses dois módulos — 'pipefy-create-card' e
// afins seguem resolvendo normalmente.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const url = (f) => pathToFileURL(resolvePath(aqui, f)).href;

const MAPA = [
    [/(^|[./])supabase(\.ts)?$/, url('supabaseStub.ts')],
    [/(^|[./])pipefy(\.ts)?$/, url('pipefyStub.ts')],
];

export async function resolve(specifier, context, next) {
    for (const [re, destino] of MAPA) {
        if (re.test(specifier)) return { url: destino, shortCircuit: true, format: 'module' };
    }
    return next(specifier, context);
}
