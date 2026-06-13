import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Cria um card no Pipefy (pipe "Acompanhamento de Fretes", fase "Cotações Fechadas") a partir
// dos dados da Carga Ganha do OmniFlow. Server-side: lê o secret PIPEFY_API_TOKEN (nunca no
// frontend). Mapeia campos de seleção/radio para a opção EXATA do Pipefy; sem correspondência,
// deixa em branco (omite o campo) em vez de quebrar o card. Campos obrigatórios (rota, receita,
// frete terceiro, valor da carga) precisam vir preenchidos. Suporta dryRun (valida sem criar).
// NÃO altera nada do Ramper nem da fórmula de cálculo.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PIPEFY_URL = 'https://api.pipefy.com/graphql';
const PIPE_ID = '304753830';
const PHASE_FECHADAS = '339926927'; // "Cotações Fechadas"

// ---- normalização e mapeamento de opções ----
const norm = (s: unknown) => (s == null ? '' : String(s)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Veículo OmniFlow -> opção do Pipefy [Carreta, Truck, Fiorino, HR, Van, 3/4, Toco, Bitruck, Prancha, Rodotrem]
function mapVeiculo(v: string): string {
  const n = norm(v);
  if (!n) return '';
  if (n.includes('fiorino')) return 'Fiorino';
  if (n.includes('bitruck')) return 'Bitruck';
  if (n.includes('rodotrem')) return 'Rodotrem';
  if (n.includes('prancha')) return 'Prancha';
  if (n.includes('vanderleia')) return 'Carreta';
  if (n.includes('carreta')) return 'Carreta';
  if (n.includes('3/4') || n.includes('3-4') || n === '34') return '3/4';
  if (n.includes('hr') || n.includes('vuc')) return 'HR';
  if (n.includes('toco')) return 'Toco';
  if (n.includes('truck')) return 'Truck';
  if (n.includes('van')) return 'Van';
  return '';
}

// Implemento/carroceria -> [Sider, Baú, Grade Baixa, Graneleiro, N/A, Prancha]
function mapImplemento(v: string): string {
  const n = norm(v);
  if (!n) return '';
  if (n.includes('sider')) return 'Sider';
  if (n.includes('bau')) return 'Baú';
  if (n.includes('grade')) return 'Grade Baixa';
  if (n.includes('granel')) return 'Graneleiro';
  if (n.includes('prancha')) return 'Prancha';
  if (n === 'n/a' || n === 'na') return 'N/A';
  return '';
}

const MERCADORIA_OPCOES = [
  'Amido', 'Andaimes', 'Autopeças', 'Artigos de Higiene e Limpeza', 'Bebidas em Geral', 'Cargas Diversas',
  'Defensivos Agrícolas e Fertilizantes', 'Ferramentas Manuais ou Elétricas', 'Máquinas e Equipamentos',
  'Papel em Bobinas', 'Papel e derivados diversos', 'Pallet Vazio', 'Pneus', 'Produtos Alimentícios',
  'Tintas, Vernizes, Solvente e derivados', 'Transformadores',
];
function mapMercadoria(v: string): string {
  const n = norm(v);
  if (!n) return '';
  const exact = MERCADORIA_OPCOES.find(o => norm(o) === n);
  return exact || ''; // só correspondência exata; senão, branco
}

// Outras Necessidades -> select [Compulog, Comprovei]. Só correspondência exata; senão branco.
const OUTRAS_NEC_OPCOES = ['Compulog', 'Comprovei'];
function mapOutrasNec(v: string): string {
  const n = norm(v);
  if (!n) return '';
  const exact = OUTRAS_NEC_OPCOES.find(o => norm(o) === n);
  return exact || '';
}

// datetime-local "2026-06-13T10:00" -> "2026-06-13 10:00" (formato aceito pelo Pipefy). Branco se inválido.
function fmtDateTime(v: unknown): string {
  const s = (v == null ? '' : String(v)).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return '';
  return `${m[1]} ${m[2]}`;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

async function gql(token: string, query: string, variables: unknown) {
  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`Pipefy GraphQL (HTTP ${res.status}): ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const raw = Deno.env.get('PIPEFY_API_TOKEN');
  if (!raw) return json({ error: 'PIPEFY_API_TOKEN não configurado no projeto.' }, 400);
  const token = raw.replace(/[\r\n\t ]+/g, '').replace(/[^\x21-\x7E]/g, '');

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }
  const dryRun = body.dryRun === true;

  // Campos obrigatórios
  const rota = (body.rota == null ? '' : String(body.rota)).trim();
  const receita = numOrNull(body.receita);
  const freteTerceiro = numOrNull(body.freteTerceiro);
  const valorCarga = numOrNull(body.valorCarga);

  const faltando: string[] = [];
  if (!rota) faltando.push('rota');
  if (receita == null) faltando.push('receita');
  if (freteTerceiro == null) faltando.push('frete terceiro');
  if (valorCarga == null) faltando.push('valor da carga');
  if (faltando.length) return json({ error: `Campos obrigatórios ausentes: ${faltando.join(', ')}.` }, 422);

  // Mapeamentos
  const veiculo = mapVeiculo(body.veiculo);
  const mercadoria = mapMercadoria(body.mercadoria);     // "Material" = Mercadoria a Transportar (select)
  const implemento = mapImplemento(body.implemento);
  const outrasNec = mapOutrasNec(body.outrasNecessidades); // Outras Necessidades (select Compulog/Comprovei)
  const peso = numOrNull(body.peso);
  const dataColeta = fmtDateTime(body.dataColeta);
  const dataEntrega = fmtDateTime(body.dataEntrega);
  const localColeta = (body.localColeta == null ? '' : String(body.localColeta)).trim();
  const localEntrega = (body.localEntrega == null ? '' : String(body.localEntrega)).trim();
  const observacoes = (body.observacoes == null ? '' : String(body.observacoes)).trim();
  const titulo = (body.titulo == null ? '' : String(body.titulo)).trim() || rota;

  // Origens dos campos que NÃO aceitam texto (só reportadas no dryRun, nunca enviadas):
  const clienteRaw = (body.cliente == null ? '' : String(body.cliente)).trim();          // -> conexão "Cliente"
  const solicitanteRaw = (body.solicitante == null ? '' : String(body.solicitante)).trim(); // -> conexão "Solicitante"
  const referenciaRaw = (body.referencia == null ? '' : String(body.referencia)).trim();   // -> "Documento" (anexo)
  const outrasNecRaw = (body.outrasNecessidades == null ? '' : String(body.outrasNecessidades)).trim();
  const mercadoriaRaw = (body.mercadoria == null ? '' : String(body.mercadoria)).trim();

  // Monta fields_attributes; só inclui campos com valor (branco => omitido).
  const fields: { field_id: string; field_value: any }[] = [];
  const push = (id: string, val: any) => { if (val !== '' && val != null) fields.push({ field_id: id, field_value: val }); };

  push('nome_da_rota_1', rota);                       // Rota (obrigatório)
  push('nosso_frete', receita);                       // Receita (obrigatório)
  push('frete_terceiro', freteTerceiro);              // Frete Terceiro (obrigatório)
  push('valor_da_carga', valorCarga);                 // Valor da Carga (obrigatório)
  push('peso', peso);                                 // Peso (Em KG)
  push('qual_o_ve_culo_para_o_transporte', veiculo);  // Veículo (select)
  push('tipo_de_mercadoria', mercadoria);             // Mercadoria (select)
  push('qual_o_tipo_de_carreta', implemento);         // Implemento (select)
  push('data_de_fechamento', fmtDateTime(new Date().toISOString()));
  push('data_e_hora_para_coletar', dataColeta);
  push('data_e_hora_de_entrega', dataEntrega);
  push('local_da_coleta', localColeta);
  push('local_da_entrega', localEntrega);
  push('observa_es_1', observacoes);
  push('outras_necessidades_', outrasNec);            // Outras Necessidades (select) — só se casar exato

  if (dryRun) {
    // Relatório dos 5 campos solicitados: status + motivo de cada um.
    const camposAlvo = [
      {
        campo: 'Cliente', field_id: 'conex_o_de_database', tipo: 'connector (conexão)',
        origemOmniflow: 'cliente da cotação', valorOrigem: clienteRaw || '(vazio)',
        status: 'NÃO PREENCHIDO',
        motivo: 'Campo de CONEXÃO: não aceita texto (quebraria o card). Precisa do id do registro no cadastro vinculado — definir junto.',
      },
      {
        campo: 'Solicitante', field_id: 'solicitante_da_carga', tipo: 'connector (conexão)',
        origemOmniflow: 'solicitante do formulário de carga ganha', valorOrigem: solicitanteRaw || '(vazio)',
        status: 'NÃO PREENCHIDO',
        motivo: 'Campo de CONEXÃO: não aceita texto. Precisa do id do registro no cadastro vinculado — definir junto.',
      },
      {
        campo: 'Documento', field_id: 'documento_do_frete', tipo: 'attachment (anexo/arquivo)',
        origemOmniflow: 'Referência do Cliente da cotação', valorOrigem: referenciaRaw || '(vazio)',
        status: 'NÃO PREENCHIDO',
        motivo: 'Campo de ANEXO (arquivo): não aceita texto. Para a Referência (texto) existe o campo short_text "Solicitação (STE, Coleta, etc)" (solicita_o_ste_coleta_etc) — confirmar se pode usar esse.',
      },
      {
        campo: 'Material', field_id: 'tipo_de_mercadoria', tipo: 'select',
        origemOmniflow: 'tipo de carga / mercadoria da cotação', valorOrigem: mercadoriaRaw || '(vazio)',
        valorPipefy: mercadoria || null,
        status: mercadoria ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: mercadoria ? 'Casou com opção exata do Pipefy.' : (mercadoriaRaw ? `"${mercadoriaRaw}" não casa com nenhuma opção do select.` : 'Origem vazia.'),
      },
      {
        campo: 'Outras Necessidades', field_id: 'outras_necessidades_', tipo: 'select [Compulog, Comprovei]',
        origemOmniflow: 'campo "Outras Necessidades" do formulário de carga ganha (texto livre)', valorOrigem: outrasNecRaw || '(vazio)',
        valorPipefy: outrasNec || null,
        status: outrasNec ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: outrasNec ? 'Casou com opção exata.' : (outrasNecRaw ? `"${outrasNecRaw}" não casa com Compulog/Comprovei (só essas 2 opções existem no Pipefy).` : 'Origem vazia.'),
      },
    ];
    const selectsSemMatch = camposAlvo
      .filter(c => c.tipo.startsWith('select') && c.status === 'NÃO PREENCHIDO' && c.valorOrigem !== '(vazio)')
      .map(c => ({ campo: c.campo, field_id: c.field_id, valorOmniflow: c.valorOrigem }));

    return json({
      ok: true, dryRun: true, pipe_id: PIPE_ID, phase_id: PHASE_FECHADAS, title: titulo,
      fields_attributes: fields,
      mapeamento: { veiculo, mercadoria, implemento, outrasNec },
      camposAlvo,
      selectsSemMatch,
    });
  }

  try {
    const mutation = `mutation CreateCard($input: CreateCardInput!) {
      createCard(input: $input) { card { id title url } }
    }`;
    const input = { pipe_id: PIPE_ID, phase_id: PHASE_FECHADAS, title: titulo, fields_attributes: fields };
    const data = await gql(token, mutation, { input });
    const card = data?.createCard?.card;
    if (!card?.id) return json({ error: 'Pipefy não retornou o card criado.' }, 502);
    return json({ ok: true, cardId: card.id, cardUrl: card.url, title: card.title });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
