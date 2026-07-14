import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Integração OmniFlow → Ramper Pipeline (LSCRM). Apenas esta função conversa com o Ramper;
// o token fica somente no secret RAMPER_ACCESS_TOKEN, nunca no frontend.

const RAMPER_BASE = 'https://api.lscrm.com.br/v1';

// =====================================================================================
// TABELA DE RESPONSÁVEIS (MANUTENÇÃO) — e-mail do criador no OmniFlow -> user_id no Ramper
// =====================================================================================
// O responsável do card = quem CRIOU o frete no OmniFlow. Casamento EXATO por e-mail
// (chave sempre em minúsculas). Alguns e-mails diferem entre OmniFlow e Ramper (mesma
// pessoa) — por isso a tabela é explícita, não um match automático de string igual.
//
// >>> COMO ADICIONAR/ATUALIZAR alguém (entrou no time, ou trocou de e-mail):
//     1. Pegue o e-mail da pessoa no OMNIFLOW (o de login; é a CHAVE, à esquerda).
//     2. Pegue o id dela no RAMPER (user_id — visível no JSON de uma oportunidade dela,
//        ou na lista de usuários da API: GET https://api.lscrm.com.br/v1/users).
//     3. Adicione uma linha:  'email.no.omniflow@...': <user_id>,   // Nome (e-mail no Ramper)
//     4. Faça deploy: supabase functions deploy create-ramper-card
//
// E-mail que NÃO estiver aqui -> não envia user_id -> o card nasce com o responsável
// padrão do Ramper (nunca quebra a criação; o frontend avisa que não casou).
const RAMPER_USER_BY_EMAIL: Record<string, number> = {
  'wagner@omnicargo.com.br': 14252,            // Wagner Ribeiro (Ramper: wagner@omnicargo.com.br)
  'gustavo@omnicargo.com.br': 14382,           // Gustavo Holz  (Ramper: gustavo@omnicargo.com.br)
  'enzo.bastos@omnicargo.com.br': 14555,       // Enzo Bastos   (Ramper: expedicao@omnicargo.com.br)
  'caroline.figueira@omnicargo.com.br': 17680, // Caroline Figueira (Ramper: ana.figueira@omnicargo.com.br)
  // '<novo.email@omnicargo.com.br>': <user_id>,  // <Nome> (Ramper: <email no ramper>)
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function fetchStages(token: string) {
  // fields explícito para garantir que o nome venha (algumas rotas LSCRM limitam campos por padrão).
  const res = await fetch(`${RAMPER_BASE}/stages?limit=100&fields=id,name,name_short,order,pipe_id,active`, {
    headers: { 'access-token': token, 'Accept': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ramper /stages ${res.status}: ${JSON.stringify(data)}`);
  return data?.get_list?.itens || data?.itens || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = Deno.env.get('RAMPER_ACCESS_TOKEN');
    if (!token) throw new Error('RAMPER_ACCESS_TOKEN não configurado nos secrets do Supabase.');

    const body = await req.json().catch(() => ({}));

    // --- Modo somente leitura: listar etapas do funil (para descobrir/confirmar stage_id) ---
    if (body.action === 'list-stages') {
      const itens = await fetchStages(token);
      return json({
        stages: itens.map((s: any) => ({ id: s.id, name: s.name ?? s.name_short, pipe: s.pipes?.name, order: s.order })),
      });
    }

    // --- Modo criação de card (oportunidade) ---
    const {
      title, value, basePrice, organizationName, personName, stageId, stageName,
      // Campos adicionais da Oportunidade (chaves confirmadas no painel Ramper) + data do card.
      solicitante, tipoDeVeiculo, documento, valorCarga, closeIn,
      // Responsável do card: e-mail do criador do frete no OmniFlow (casa com user_id do Ramper).
      responsavelEmail,
    } = body;
    if (!title) throw new Error('title é obrigatório.');

    // Resolve o stage_id: usa o informado, senão busca pela etapa "Cotações" (por nome).
    let resolvedStageId = stageId;
    if (!resolvedStageId) {
      const target = String(stageName || 'Cotações').toLowerCase();
      const itens = await fetchStages(token);
      const nameOf = (s: any) => String(s.name || s.name_short || '').toLowerCase();
      const match = itens.find((s: any) => nameOf(s) === target)
        || itens.find((s: any) => nameOf(s).includes(target));
      if (!match) throw new Error(`Etapa "${stageName || 'Cotações'}" não encontrada no funil do Ramper.`);
      resolvedStageId = match.id;
    }

    // Corpo no formato form-urlencoded (padrão da API LSCRM, com chaves aninhadas em colchetes).
    const form = new URLSearchParams();
    form.set('title', title);
    form.set('stage_id', String(resolvedStageId));
    if (value != null && !isNaN(Number(value))) form.set('value', Number(value).toFixed(2));
    if (organizationName) form.set('organizations[name]', String(organizationName));
    if (personName) form.set('organizations_person[name]', String(personName));
    // Nota da oportunidade (campo "history" = Notas, conforme doc LSCRM): preço base interno.
    if (basePrice != null && !isNaN(Number(basePrice))) {
      const v = Number(basePrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      form.set('history', `Valor a pagar pro terceiro: R$ ${v}`);
    }

    // Campos personalizados da Oportunidade (additional_values[opportunities][<chave>]).
    // Chaves confirmadas no painel Ramper. Campo vazio NÃO é enviado -> fica em branco no card,
    // nunca quebra a criação da oportunidade.
    if (solicitante) form.set('additional_values[opportunities][solicitante]', String(solicitante));
    if (tipoDeVeiculo) form.set('additional_values[opportunities][tipo_de_veiculo]', String(tipoDeVeiculo));
    if (documento) form.set('additional_values[opportunities][documento_sote_ste_etc]', String(documento));
    if (valorCarga != null && !isNaN(Number(valorCarga))) {
      // Número decimal (ponto como separador), como o campo espera.
      form.set('additional_values[opportunities][valor_da_carga]', String(Number(valorCarga)));
    }
    // Data do card (Data de fechamento): sobrescreve o padrão de +7 dias do Ramper com a data de
    // criação da cotação no OmniFlow. Formato AAAA-MM-DD.
    if (closeIn) form.set('close_in', String(closeIn));

    // Responsável (user_id): casa o e-mail do criador com o usuário do Ramper. Sem casamento,
    // NÃO envia user_id -> card fica com o responsável padrão do Ramper (nunca quebra a criação).
    const emailKey = String(responsavelEmail ?? '').trim().toLowerCase();
    const responsavelUserId = emailKey ? RAMPER_USER_BY_EMAIL[emailKey] : undefined;
    const responsavelCasou = responsavelUserId != null;
    if (responsavelCasou) {
      form.set('user_id', String(responsavelUserId));
    } else if (emailKey) {
      console.warn(`CREATE-RAMPER-CARD: responsável NÃO casou para "${emailKey}" — card criado com responsável padrão do Ramper.`);
    }

    const res = await fetch(`${RAMPER_BASE}/opportunities`, {
      method: 'POST',
      headers: { 'access-token': token, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Ramper /opportunities ${res.status}: ${JSON.stringify(data)}`);

    // Devolve o resultado do casamento do responsável pro frontend poder avisar quando não casou.
    return json({ ok: true, stage_id: resolvedStageId, result: data, responsavel: { email: emailKey || null, casou: responsavelCasou, userId: responsavelUserId ?? null } });
  } catch (error) {
    console.error('CREATE-RAMPER-CARD ERROR:', (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
