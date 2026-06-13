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

// Tabelas de cadastro vinculadas às conexões (descobertas via inspect read-only).
const TABLE_CLIENTES = 'n4RglqvR';
const TABLE_SOLICITANTES = 'NRSsu5wv';

// Casa um nome com um registro da tabela do Pipefy SÓ por correspondência EXATA (título idêntico,
// ignorando caixa/acento/espaços nas pontas). Nada de busca aproximada. Nunca cria registro.
// Retorna { id } se achou um único exato; senão { id: null, motivo }.
async function findRecordIdExact(token: string, tableId: string, name: string): Promise<{ id: string | null; motivo: string }> {
  const alvo = (name || '').trim();
  if (!alvo) return { id: null, motivo: 'origem vazia' };
  const eq = (a: string, b: string) => norm(a) === norm(b);
  // Varre páginas (50/pág, até 600 registros) e compara título exato. Sem search aproximado.
  let after: string | null = null;
  const exatos: { id: string; title: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const q = `query($tid: ID!, $after: String) {
      table_records(table_id: $tid, first: 50, after: $after) {
        edges { node { id title } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const data: any = await gql(token, q, { tid: tableId, after });
    const conn = data?.table_records;
    for (const e of (conn?.edges || [])) {
      if (eq(e.node.title || '', alvo)) exatos.push({ id: e.node.id, title: e.node.title });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  if (exatos.length === 1) return { id: exatos[0].id, motivo: `match exato: "${exatos[0].title}"` };
  if (exatos.length > 1) return { id: null, motivo: `${exatos.length} registros com nome idêntico — ambíguo, deixado vazio` };
  return { id: null, motivo: `nenhum registro idêntico a "${alvo}" no cadastro` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const raw = Deno.env.get('PIPEFY_API_TOKEN');
  if (!raw) return json({ error: 'PIPEFY_API_TOKEN não configurado no projeto.' }, 400);
  const token = raw.replace(/[\r\n\t ]+/g, '').replace(/[^\x21-\x7E]/g, '');

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }
  const dryRun = body.dryRun === true;

  // Inspeção READ-ONLY das conexões (a que cadastro Cliente/Solicitante estão ligados). Não cria card.
  if (body.inspect === 'connectors') {
    try {
      // 1) descobre os tipos possíveis da union PublicRepoUnion
      const introspect = await gql(token, `{ __type(name: "PublicRepoUnion") { possibleTypes { name } } }`, {});
      const tipos: string[] = (introspect?.__type?.possibleTypes || []).map((t: any) => t.name);
      // 2) monta fragments dinâmicos só com os tipos que existem
      const frags = tipos.map(t => `... on ${t} { id name }`).join('\n');
      const q = `query {
        pipe(id: ${PIPE_ID}) {
          start_form_fields {
            id label type
            connectedRepo { __typename ${frags} }
          }
        }
      }`;
      const data = await gql(token, q, {});
      const fields = (data?.pipe?.start_form_fields || []).filter((f: any) => f.type === 'connector')
        .map((f: any) => ({
          id: f.id, label: f.label,
          cadastro: f.connectedRepo ? { tipo: f.connectedRepo.__typename, id: f.connectedRepo.id, nome: f.connectedRepo.name } : null,
        }));
      return json({ ok: true, unionTypes: tipos, connectors: fields });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

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
  const peso = numOrNull(body.peso);
  const dataColeta = fmtDateTime(body.dataColeta);
  const dataEntrega = fmtDateTime(body.dataEntrega);
  const localColeta = (body.localColeta == null ? '' : String(body.localColeta)).trim();
  const localEntrega = (body.localEntrega == null ? '' : String(body.localEntrega)).trim();
  const observacoes = (body.observacoes == null ? '' : String(body.observacoes)).trim();
  const titulo = (body.titulo == null ? '' : String(body.titulo)).trim() || rota;

  // Origens dos campos especiais:
  const clienteRaw = (body.cliente == null ? '' : String(body.cliente)).trim();          // -> conexão "Cliente" (tabela Clientes)
  const solicitanteRaw = (body.solicitante == null ? '' : String(body.solicitante)).trim(); // -> conexão "Solicitante" (tabela Solicitantes)
  const referenciaRaw = (body.referencia == null ? '' : String(body.referencia)).trim();   // -> "Solicitação (STE...)" (short_text)
  const outrasNecRaw = (body.outrasNecessidades == null ? '' : String(body.outrasNecessidades)).trim(); // -> vai nas Observações (rótulo), NÃO no select
  const mercadoriaRaw = (body.mercadoria == null ? '' : String(body.mercadoria)).trim();

  // Conexões: casa por nome SÓ exato (read-only). Nunca cria registro. Sem match -> vazio.
  const clienteMatch = await findRecordIdExact(token, TABLE_CLIENTES, clienteRaw);
  const solicitanteMatch = await findRecordIdExact(token, TABLE_SOLICITANTES, solicitanteRaw);

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
  push('observa_es_1', observacoes);                  // já vem com "Necessidades: ..." embutido (montado no app)
  push('solicita_o_ste_coleta_etc', referenciaRaw);   // "Solicitação (STE...)" recebe a Referência do Cliente (short_text)
  // Conexões: só envia se houve match EXATO de nome (id do registro). Sem match -> nada (vazio). Nunca cria.
  if (clienteMatch.id) push('conex_o_de_database', [clienteMatch.id]);
  if (solicitanteMatch.id) push('solicitante_da_carga', [solicitanteMatch.id]);

  if (dryRun) {
    // Relatório dos 5 campos solicitados: status + motivo de cada um.
    const camposAlvo = [
      {
        campo: 'Cliente', field_id: 'conex_o_de_database', tipo: 'connector → tabela "Clientes"',
        origemOmniflow: 'cliente da cotação', valorOrigem: clienteRaw || '(vazio)',
        valorPipefy: clienteMatch.id || null,
        status: clienteMatch.id ? 'PREENCHIDO (id do registro)' : 'NÃO PREENCHIDO',
        motivo: `Match SÓ exato por nome (sem aproximação, nunca cria registro). ${clienteMatch.motivo}.`,
      },
      {
        campo: 'Solicitante', field_id: 'solicitante_da_carga', tipo: 'connector → tabela "Solicitantes"',
        origemOmniflow: 'solicitante do formulário de carga ganha', valorOrigem: solicitanteRaw || '(vazio)',
        valorPipefy: solicitanteMatch.id || null,
        status: solicitanteMatch.id ? 'PREENCHIDO (id do registro)' : 'NÃO PREENCHIDO',
        motivo: `Match SÓ exato por nome (sem aproximação, nunca cria registro). ${solicitanteMatch.motivo}.`,
      },
      {
        campo: 'Documento → Referência', field_id: 'solicita_o_ste_coleta_etc', tipo: 'short_text (texto)',
        origemOmniflow: 'Referência do Cliente da cotação', valorOrigem: referenciaRaw || '(vazio)',
        valorPipefy: referenciaRaw || null,
        status: referenciaRaw ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: referenciaRaw
          ? 'Por decisão: a Referência vai no campo de texto "Solicitação (STE, Coleta, etc)". O anexo "Documento do Frete" (documento_do_frete) segue vazio (é arquivo).'
          : 'Origem (Referência) vazia. O anexo "Documento do Frete" não recebe texto.',
      },
      {
        campo: 'Material', field_id: 'tipo_de_mercadoria', tipo: 'select',
        origemOmniflow: 'tipo de carga / mercadoria da cotação', valorOrigem: mercadoriaRaw || '(vazio)',
        valorPipefy: mercadoria || null,
        status: mercadoria ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: mercadoria ? 'Casou com opção exata do Pipefy.' : (mercadoriaRaw ? `"${mercadoriaRaw}" não casa com nenhuma opção do select.` : 'Origem vazia.'),
      },
      {
        campo: 'Outras Necessidades', field_id: 'observa_es_1 (Observações)', tipo: 'texto (dentro das Observações)',
        origemOmniflow: 'campo "Outras Necessidades" do formulário de carga ganha (texto livre)', valorOrigem: outrasNecRaw || '(vazio)',
        valorPipefy: outrasNecRaw ? `incluído nas Observações com rótulo "Necessidades: ..."` : null,
        status: outrasNecRaw ? 'PREENCHIDO (via Observações)' : 'NÃO PREENCHIDO',
        motivo: 'Por decisão: o texto livre NÃO força o select Compulog/Comprovei (esse fica pra operação). O conteúdo vai dentro das Observações com rótulo "Necessidades: ..." pra não perder a informação.',
      },
    ];
    const selectsSemMatch = camposAlvo
      .filter(c => c.tipo === 'select' && c.status === 'NÃO PREENCHIDO' && c.valorOrigem !== '(vazio)')
      .map(c => ({ campo: c.campo, field_id: c.field_id, valorOmniflow: c.valorOrigem }));

    return json({
      ok: true, dryRun: true, pipe_id: PIPE_ID, phase_id: PHASE_FECHADAS, title: titulo,
      fields_attributes: fields,
      mapeamento: { veiculo, mercadoria, implemento, clienteRecordId: clienteMatch.id, solicitanteRecordId: solicitanteMatch.id },
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
