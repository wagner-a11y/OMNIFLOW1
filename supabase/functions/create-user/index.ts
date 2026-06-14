import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Gestão de usuários via Supabase Auth (service role, nunca exposta ao frontend). NÃO envia e-mail:
// o canal da senha temporária é o master, por fora. Ações (master): create, reset, setActive, delete.
// Ação livre p/ o próprio usuário: finishPasswordChange (limpa a flag de troca obrigatória do 1º acesso).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Senha temporária FORTE (12 chars: maiúscula, minúscula, dígito, símbolo + aleatórios). crypto seguro.
function genTempPassword(): string {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', S = '!@#$%&*?';
  const all = U + L + D + S;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(U), pick(L), pick(D), pick(S)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { // embaralha (Fisher–Yates seguro)
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY indisponíveis.');
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Identifica o chamador autenticado.
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!jwt) return json({ error: 'Não autenticado.' }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Sessão inválida.' }, 401);
    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'create';

    // --- Ação livre (próprio usuário): conclui a troca de senha do 1º acesso ---
    if (action === 'finishPasswordChange') {
      const { error } = await admin.from('profiles').update({ must_change_password: false }).eq('id', callerId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // --- Demais ações exigem MASTER ---
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', callerId).single();
    if (callerProfile?.role !== 'master') return json({ error: 'Apenas o master pode gerenciar usuários.' }, 403);

    if (action === 'reset') {
      const { userId } = body;
      if (!userId) return json({ error: 'userId é obrigatório.' }, 400);
      const password = genTempPassword();
      // Redefine a senha E confirma o e-mail (destrava legados criados por convite, nunca confirmados).
      const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (error) return json({ error: `Falha ao redefinir senha: ${error.message}` }, 400);
      await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
      return json({ ok: true, tempPassword: password });
    }

    if (action === 'setActive') {
      const { userId, active } = body;
      if (!userId || typeof active !== 'boolean') return json({ error: 'userId e active são obrigatórios.' }, 400);
      if (userId === callerId) return json({ error: 'Você não pode desativar a si mesmo.' }, 400);
      // Bane no Auth (bloqueia novas sessões/refresh) e reflete em profiles.active. Não apaga nada.
      const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876600h' });
      if (banErr) return json({ error: `Falha ao alterar status: ${banErr.message}` }, 400);
      const { error: profErr } = await admin.from('profiles').update({ active }).eq('id', userId);
      if (profErr) return json({ error: profErr.message }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const { userId } = body;
      if (!userId) return json({ error: 'userId é obrigatório.' }, 400);
      if (userId === callerId) return json({ error: 'Você não pode remover a si mesmo.' }, 400);
      await admin.from('profiles').delete().eq('id', userId);
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    // action 'create' — cria já confirmado, com senha temporária forte gerada pelo sistema (sem e-mail).
    const { email, name, role } = body;
    if (!email || !name) return json({ error: 'email e name são obrigatórios.' }, 400);
    const finalRole = role === 'master' ? 'master' : 'operador';
    const password = genTempPassword();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,              // login imediato; não há fluxo de confirmação por e-mail
      user_metadata: { name },
    });
    if (createErr || !created?.user) {
      const m = createErr?.message || 'desconhecido';
      const friendly = /already|registered|exists/i.test(m) ? 'E-mail já cadastrado.' : `Falha ao criar usuário: ${m}`;
      return json({ error: friendly }, 400);
    }

    const { error: profErr } = await admin.from('profiles').upsert({
      id: created.user.id,
      name, email, role: finalRole,
      active: true,
      must_change_password: true,        // obriga a trocar a senha temporária no 1º acesso
    });
    if (profErr) return json({ error: `Usuário criado, mas falhou ao salvar perfil: ${profErr.message}` }, 500);

    return json({ ok: true, id: created.user.id, email, name, role: finalRole, tempPassword: password });
  } catch (error) {
    console.error('CREATE-USER ERROR:', (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
