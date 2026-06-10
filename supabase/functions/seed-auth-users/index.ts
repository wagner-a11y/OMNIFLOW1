import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// FUNÇÃO TEMPORÁRIA DE BOOTSTRAP (Etapa A) — cria os primeiros usuários no Supabase Auth
// + perfis. Protegida: só executa enquanto NÃO existir nenhum perfil 'master'.
// Deve ser removida após o setup inicial.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY indisponíveis.');

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Guarda de bootstrap: se já existe um master, recusa (evita uso indevido).
    const { data: masters } = await admin.from('profiles').select('id').eq('role', 'master').limit(1);
    if (masters && masters.length > 0) {
      return json({ error: 'Bootstrap já realizado: já existe um usuário master.' }, 409);
    }

    const { users } = await req.json();
    if (!Array.isArray(users) || users.length === 0) throw new Error('Envie { users: [{email,password,name,role}] }.');

    const results: any[] = [];
    for (const u of users) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { name: u.name },
      });
      if (createErr || !created?.user) {
        results.push({ email: u.email, ok: false, error: createErr?.message });
        continue;
      }
      const { error: profErr } = await admin.from('profiles').upsert({
        id: created.user.id,
        name: u.name,
        email: u.email,
        role: u.role === 'master' ? 'master' : 'operador',
      });
      results.push({ email: u.email, ok: !profErr, id: created.user.id, role: u.role, error: profErr?.message });
    }
    return json({ results });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
