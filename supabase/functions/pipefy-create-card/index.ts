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

// Opções EXATAS (grafia do JSON da estrutura do pipe). Match normalizado -> devolve a grafia canônica do Pipefy.
const NOVA_USADA_OPCOES = ['Usada', 'Nova'];                                    // select mercadoria_nova_usada
const OUTRAS_NEC_OPCOES = ['Compulog', 'Comprovei'];                           // select outras_necessidades_ (1 opção)
const GR_OPCOES = ['Consulta/Cadastro Gerenciadora', 'Rastreamento e Monitoramento', 'Escolta', 'Isca', 'Imobilizador Inteligente', 'Pernoitar das 22h até as 5h']; // checklist_vertical necessidade_gr_1
const matchOpcao = (v: unknown, opts: string[]): string => { const n = norm(v as string); return n ? (opts.find(o => norm(o) === n) || '') : ''; };
const matchVarias = (arr: unknown, opts: string[]): string[] => {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const x of arr) { const m = matchOpcao(x, opts); if (m && !out.includes(m)) out.push(m); }
  return out; // só os que casaram exato, sem duplicar; nada casou -> []
};

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

  // Amostra READ-ONLY de registros das tabelas Clientes e Solicitantes (pra pegar nomes com grafia exata).
  if (body.inspect === 'samples') {
    try {
      const sample = async (tid: string) => {
        const q = `query($tid: ID!) { table_records(table_id: $tid, first: 15) { edges { node { id title } } } }`;
        const data: any = await gql(token, q, { tid });
        return (data?.table_records?.edges || []).map((e: any) => ({ id: e.node.id, title: e.node.title }));
      };
      return json({ ok: true, clientes: await sample(TABLE_CLIENTES), solicitantes: await sample(TABLE_SOLICITANTES) });
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // Busca READ-ONLY para o autocomplete (Cliente/Solicitante). Retorna { id, title } dos registros
  // cujo título contém o termo. Nunca cria/altera/apaga nada. Filtra por substring normalizada.
  if (body.action === 'search') {
    const q = (body.q == null ? '' : String(body.q)).trim();
    const tipo = body.tipo === 'solicitante' ? 'solicitante' : 'cliente';
    const tableId = tipo === 'solicitante' ? TABLE_SOLICITANTES : TABLE_CLIENTES;
    if (q.length < 2) return json({ ok: true, results: [] });
    try {
      const alvo = norm(q);
      const out: { id: string; title: string }[] = [];
      let after: string | null = null;
      // Varre até ~8 páginas (400 registros) e filtra por substring; para ao juntar 10 matches.
      for (let i = 0; i < 8 && out.length < 10; i++) {
        const query = `query($tid: ID!, $after: String) {
          table_records(table_id: $tid, first: 50, after: $after) {
            edges { node { id title } }
            pageInfo { hasNextPage endCursor }
          }
        }`;
        const data: any = await gql(token, query, { tid: tableId, after });
        const conn = data?.table_records;
        for (const e of (conn?.edges || [])) {
          if (norm(e.node.title || '').includes(alvo)) { out.push({ id: e.node.id, title: e.node.title }); if (out.length >= 10) break; }
        }
        if (!conn?.pageInfo?.hasNextPage) break;
        after = conn.pageInfo.endCursor;
      }
      return json({ ok: true, results: out });
    } catch (e) {
      // Fail-soft: erro na busca não trava nada; o front segue com texto livre.
      return json({ ok: true, results: [], warning: (e as Error).message });
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
  const clienteRaw = (body.cliente == null ? '' : String(body.cliente)).trim();          // nome (vai no título/resumo)
  const solicitanteRaw = (body.solicitante == null ? '' : String(body.solicitante)).trim();
  const referenciaRaw = (body.referencia == null ? '' : String(body.referencia)).trim();   // -> "Solicitação (STE...)" (short_text)
  const outrasNecRaw = (body.outrasNecessidades == null ? '' : String(body.outrasNecessidades)).trim(); // -> vai nas Observações (rótulo), NÃO no select
  const mercadoriaRaw = (body.mercadoria == null ? '' : String(body.mercadoria)).trim();

  // Conexões: usa o ID do registro JÁ ESCOLHIDO no autocomplete (vínculo por id, não por grafia).
  // Sem id (cliente/solicitante digitado livre, fora do cadastro) -> conexão fica vazia. Nunca cria registro.
  const clienteId = (body.clienteId == null ? '' : String(body.clienteId)).trim();
  const solicitanteId = (body.solicitanteId == null ? '' : String(body.solicitanteId)).trim();

  // Três campos espelhados (match exato; nada escolhido/marcado -> branco; nunca força nem cria):
  const novaUsada = matchOpcao(body.mercadoriaNovaUsada, NOVA_USADA_OPCOES);     // select (1)
  const outrasNecSel = matchOpcao(body.outrasNecessidadesSelect, OUTRAS_NEC_OPCOES); // select (1) — separado da obs livre
  const grMarcados = matchVarias(body.necessidadeGR, GR_OPCOES);                 // checklist (várias)

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
  push('data_de_fechamento', fmtDateTime(body.dataFechamento) || fmtDateTime(new Date().toISOString())); // vem do form (editável); fallback = agora
  push('data_e_hora_para_coletar', dataColeta);
  push('data_e_hora_de_entrega', dataEntrega);
  push('local_da_coleta', localColeta);
  push('local_da_entrega', localEntrega);
  push('observa_es_1', observacoes);                  // já vem com "Necessidades: ..." embutido (montado no app)
  push('solicita_o_ste_coleta_etc', referenciaRaw);   // "Solicitação (STE...)" recebe a Referência do Cliente (short_text)
  // Conexões: só envia se veio um id escolhido no autocomplete. Sem id -> vazio. Nunca cria registro.
  if (clienteId) push('conex_o_de_database', [clienteId]);
  if (solicitanteId) push('solicitante_da_carga', [solicitanteId]);
  // Três campos espelhados: só envia se casou (select) ou se há marcados (checklist). Branco -> omite.
  push('mercadoria_nova_usada', novaUsada);
  push('outras_necessidades_', outrasNecSel);
  if (grMarcados.length) push('necessidade_gr_1', grMarcados);

  if (dryRun) {
    // Relatório dos 5 campos solicitados: status + motivo de cada um.
    const camposAlvo = [
      {
        campo: 'Cliente', field_id: 'conex_o_de_database', tipo: 'connector → tabela "Clientes"',
        origemOmniflow: 'cliente escolhido no autocomplete', valorOrigem: clienteRaw || '(vazio)',
        valorPipefy: clienteId || null,
        status: clienteId ? 'PREENCHIDO (id do registro)' : 'NÃO PREENCHIDO',
        motivo: clienteId
          ? `Vínculo por id do registro escolhido (${clienteId}). Conexão casa sempre, sem depender de grafia.`
          : 'Sem id (cliente digitado livre, fora do cadastro do Pipefy). Conexão fica vazia; nome segue no título/resumo. Nunca cria registro.',
      },
      {
        campo: 'Solicitante', field_id: 'solicitante_da_carga', tipo: 'connector → tabela "Solicitantes"',
        origemOmniflow: 'solicitante escolhido no autocomplete', valorOrigem: solicitanteRaw || '(vazio)',
        valorPipefy: solicitanteId || null,
        status: solicitanteId ? 'PREENCHIDO (id do registro)' : 'NÃO PREENCHIDO',
        motivo: solicitanteId
          ? `Vínculo por id do registro escolhido (${solicitanteId}). Conexão casa sempre, sem depender de grafia.`
          : 'Sem id (solicitante digitado livre). Conexão fica vazia; nunca cria registro.',
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
      {
        campo: 'Mercadoria Nova/Usada?', field_id: 'mercadoria_nova_usada', tipo: 'select (1 opção: Usada/Nova)',
        origemOmniflow: 'campo de escolha do formulário de carga ganha', valorOrigem: (body.mercadoriaNovaUsada || '(vazio)'),
        valorPipefy: novaUsada || null,
        status: novaUsada ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: novaUsada ? 'Casou com opção exata.' : (body.mercadoriaNovaUsada ? `"${body.mercadoriaNovaUsada}" não casa com Usada/Nova.` : 'Nada escolhido -> branco.'),
      },
      {
        campo: 'Outras Necessidades (select)', field_id: 'outras_necessidades_', tipo: 'select (1 opção: Compulog/Comprovei)',
        origemOmniflow: 'campo de escolha (separado da obs livre de ajudante/transbordo)', valorOrigem: (body.outrasNecessidadesSelect || '(vazio)'),
        valorPipefy: outrasNecSel || null,
        status: outrasNecSel ? 'PREENCHIDO' : 'NÃO PREENCHIDO',
        motivo: outrasNecSel ? 'Casou com opção exata.' : (body.outrasNecessidadesSelect ? `"${body.outrasNecessidadesSelect}" não casa com Compulog/Comprovei.` : 'Nada escolhido -> branco.'),
      },
      {
        campo: 'Necessidade GR', field_id: 'necessidade_gr_1', tipo: 'checklist_vertical (várias)',
        origemOmniflow: 'caixas de marcar do formulário de carga ganha', valorOrigem: (Array.isArray(body.necessidadeGR) ? body.necessidadeGR.join(', ') : '(vazio)') || '(vazio)',
        valorPipefy: grMarcados.length ? grMarcados : null,
        status: grMarcados.length ? `PREENCHIDO (${grMarcados.length} marcado(s))` : 'NÃO PREENCHIDO',
        motivo: grMarcados.length ? 'Manda a lista dos marcados que casaram exato.' : 'Nada marcado -> branco.',
      },
    ];
    const selectsSemMatch = camposAlvo
      .filter(c => c.tipo === 'select' && c.status === 'NÃO PREENCHIDO' && c.valorOrigem !== '(vazio)')
      .map(c => ({ campo: c.campo, field_id: c.field_id, valorOmniflow: c.valorOrigem }));

    return json({
      ok: true, dryRun: true, pipe_id: PIPE_ID, phase_id: PHASE_FECHADAS, title: titulo,
      fields_attributes: fields,
      mapeamento: { veiculo, mercadoria, implemento, clienteRecordId: clienteId || null, solicitanteRecordId: solicitanteId || null, novaUsada: novaUsada || null, outrasNecSel: outrasNecSel || null, necessidadeGR: grMarcados },
      camposAlvo,
      selectsSemMatch,
    });
  }

  try {
    const mutation = `mutation CreateCard($input: CreateCardInput!) {
      createCard(input: $input) { card { id title url fields { name value } } }
    }`;
    const input = { pipe_id: PIPE_ID, phase_id: PHASE_FECHADAS, title: titulo, fields_attributes: fields };
    const data = await gql(token, mutation, { input });
    const card = data?.createCard?.card;
    if (!card?.id) return json({ error: 'Pipefy não retornou o card criado.' }, 502);
    return json({ ok: true, cardId: card.id, cardUrl: card.url, title: card.title, fields: card.fields || [] });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
