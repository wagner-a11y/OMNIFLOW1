// Registra o hook que troca services/supabase pelo stub. Uso:
//   npx tsx --import ./scripts/testing/registerStub.mjs <arquivo de teste>
import { register } from 'node:module';
register('./resolveStub.mjs', import.meta.url);
