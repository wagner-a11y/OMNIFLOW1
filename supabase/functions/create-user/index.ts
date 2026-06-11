import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Gestão de usuários (Etapa B). Só o MASTER pode chamar. Usa a service role (injetada
// automaticamente) — nunca exposta ao frontend.
// - action 'create': convida o usuário por e-mail (ele define a própria senha) + cria perfil.
// - action 'delete': remove o usuário do Auth + perfil.

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

    // 1) Autoriza: o chamador precisa ser um master autenticado.
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const callerId = userData.user.id;
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerId).single();
    if (callerProfile?.role !== 'master') return json({ error: 'Apenas o master pode gerenciar usuários.' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'create';

    if (action === 'delete') {
      const { userId } = body;
      if (!userId) return json({ error: 'userId é obrigatório.' }, 400);
      if (userId === callerId) return json({ error: 'Você não pode remover a si mesmo.' }, 400);
      await admin.from('profiles').delete().eq('id', userId);
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    // action 'create' — convite por e-mail (usuário define a própria senha) + perfil.
    const { email, name, role, redirectTo } = body;
    if (!email || !name) return json({ error: 'email e name são obrigatórios.' }, 400);
    const finalRole = role === 'master' ? 'master' : 'operador';

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name },
      redirectTo: redirectTo || undefined,
    });
    if (inviteErr || !invited?.user) {
      return json({ error: `Falha ao convidar: ${inviteErr?.message || 'desconhecido'}` }, 400);
    }

    const { error: profErr } = await admin.from('profiles').upsert({
      id: invited.user.id,
      name,
      email,
      role: finalRole,
    });
    if (profErr) {
      return json({ error: `Usuário criado, mas falhou ao salvar perfil: ${profErr.message}` }, 500);
    }

    return json({ ok: true, id: invited.user.id, email, name, role: finalRole });
  } catch (error) {
    console.error('CREATE-USER ERROR:', (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
