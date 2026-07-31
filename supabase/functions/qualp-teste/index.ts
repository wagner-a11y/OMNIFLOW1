import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ============================================================================
// LABORATÓRIO DE TESTE — API Qualp (/rotas/v4). ISOLADO E SÓ LEITURA.
// Não grava nada, não toca na calculadora nem em calculate-route. Compara
// pedágio/distância/piso-ANTT do Qualp contra o que a calculadora dá hoje.
// A chave vem SÓ do secret QUALP_ACCESS_TOKEN (nunca hardcoded).
// ============================================================================

const QUALP_ACCESS_TOKEN = Deno.env.get('QUALP_ACCESS_TOKEN') || '';
const QUALP_BASE = 'https://api.qualp.com.br';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

// --- Extratores defensivos: a resposta do Qualp pode aninhar de formas diferentes,
//     então tentamos os nomes prováveis e SEMPRE devolvemos o raw pra conferência. ---

// Distância -> km numérico. Qualp devolve { texto: "437 km", valor: 437 } (PT).
// Aceita número, string, ou objeto com valor/texto (PT) ou value/text (EN).
function extrairKm(distancia: unknown): number | null {
  if (distancia == null) return null;
  if (typeof distancia === 'number') return distancia; // Qualp já manda em km
  if (typeof distancia === 'object') {
    const o = distancia as Record<string, unknown>;
    if (typeof o.valor === 'number') return o.valor;
    if (typeof o.value === 'number') return o.value;
    if (typeof o.texto === 'string') return extrairKm(o.texto);
    if (typeof o.text === 'string') return extrairKm(o.text);
  }
  if (typeof distancia === 'string') {
    const n = parseFloat(distancia.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Tarifa de UMA praça pro nº de eixos pedido. Qualp: tarifa: { "5": 22.5 } (chaveado por eixo).
function tarifaPorEixo(o: Record<string, unknown>, axis: number): number | null {
  const t = o.tarifa;
  if (t && typeof t === 'object') {
    const m = t as Record<string, unknown>;
    const v = m[String(axis)] ?? m[axis as unknown as string];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseFloat(v.replace(',', '.')); if (Number.isFinite(n)) return n; }
    const first = Object.values(m).find(x => typeof x === 'number'); // fallback: 1º valor numérico
    if (typeof first === 'number') return first;
  }
  return extrairValor(o); // fallback p/ formatos onde a tarifa é número direto
}

// Um valor monetário a partir de nomes prováveis (valor/tarifa/preco/price/total...).
function extrairValor(o: Record<string, unknown>): number | null {
  for (const k of ['valor', 'tarifa', 'preco', 'price', 'value', 'total', 'valor_total', 'custo']) {
    const v = o[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// Normaliza a lista de praças de pedágio pro nº de eixos pedido.
function normalizarPracas(pedagios: unknown, axis: number): {
  lista: Array<{ nome: string; uf: string | null; valor: number | null; rodovia: string | null; km: string | null; concessionaria: string | null; tarifaTag: number | null }>;
  total: number | null;
} {
  let arr: unknown = pedagios;
  if (pedagios && typeof pedagios === 'object' && !Array.isArray(pedagios)) {
    const o = pedagios as Record<string, unknown>;
    arr = o.pedagios ?? o.lista ?? o.pracas ?? o.items ?? o.data ?? [];
  }
  const lista: Array<{ nome: string; uf: string | null; valor: number | null; rodovia: string | null; km: string | null; concessionaria: string | null; tarifaTag: number | null }> = [];
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const nome = String(o.nome ?? o.name ?? o.praca ?? o.concessionaria ?? o.rodovia ?? o.local ?? '—');
      const uf = (o.uf ?? o.estado ?? o.state ?? null) as string | null;
      const tag = o.tarifa_tag;
      const tarifaTag = (tag && typeof tag === 'object') ? (Number((tag as Record<string, unknown>)[String(axis)]) || null) : null;
      lista.push({
        nome,
        uf: uf ? String(uf) : null,
        valor: tarifaPorEixo(o, axis),
        rodovia: o.rodovia ? String(o.rodovia) : null,
        km: o.km != null ? String(o.km) : null,
        concessionaria: o.concessionaria ? String(o.concessionaria) : null,
        tarifaTag,
      });
    }
  }
  const soma = lista.reduce((s, p) => s + (p.valor || 0), 0);
  const total = soma > 0 ? Math.round(soma * 100) / 100 : null;
  return { lista, total };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!QUALP_ACCESS_TOKEN) {
    return json({ ok: false, error: 'QUALP_ACCESS_TOKEN_MISSING', hint: 'Cadastre o secret QUALP_ACCESS_TOKEN no Supabase.' }, 200);
  }

  try {
    const { origem, destino, eixos = 6, fuel = false, categoria = 'A', freightLoad = 'geral', antt = false } = await req.json();
    if (!origem || !destino) {
      return json({ ok: false, error: 'origem e destino são obrigatórios' }, 400);
    }
    const axis = Math.max(0, Math.min(15, Number(eixos) || 0));
    // Categoria da tabela ANTT (Tabela A/B/C/D ou all). A é a que a calculadora usa.
    const cat = ['A', 'B', 'C', 'D', 'all'].includes(String(categoria)) ? String(categoria) : 'A';
    // Tipo de carga conforme enum oficial do Qualp (freight_load). 'geral' = carga geral.
    const LOADS = ['all', 'granel_solido', 'granel_liquido', 'frigorificada', 'conteineirizada', 'geral', 'neogranel', 'perigosa_granel_solido', 'perigosa_granel_liquido', 'perigosa_frigorificada', 'perigosa_conteineirizada', 'perigosa_geral', 'granel_pressurizada'];
    const load = LOADS.includes(String(freightLoad)) ? String(freightLoad) : 'geral';
    // ANTT fica ISOLADO por padrão (antt=false -> não pede a tabela). O pedágio/distância não dependem disso.
    const mostrarAntt = !!antt;

    // Corpo conforme OpenAPI v4: "show" é IRMÃO de "config" (nível de cima), NÃO dentro dele.
    const body = {
      locations: [String(origem), String(destino)],
      config: {
        route: { type_route: 'efficient', calculate_return: false },
        vehicle: { type: 'truck', axis },
        // Tabela ANTT: category + freight_load + axis (axis é STRING no schema do Qualp). Só afeta o ANTT.
        freight_table: { category: cat, freight_load: load, axis: String(axis) },
      },
      show: {
        tolls: true,
        freight_table: mostrarAntt,
        fuel_consumption: !!fuel,
        polyline: false,
        simplified_polyline: false,
        maneuvers: 'false',
        static_image: false,
        private_places: false,
      },
    };

    const t0 = Date.now();
    const res = await fetch(`${QUALP_BASE}/rotas/v4`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Access-Token': QUALP_ACCESS_TOKEN,
      },
      body: JSON.stringify(body),
    });
    const elapsedMs = Date.now() - t0;

    const texto = await res.text();
    let data: any = null;
    try { data = JSON.parse(texto); } catch { /* mantém texto cru abaixo */ }

    if (!res.ok) {
      return json({ ok: false, error: `QUALP_HTTP_${res.status}`, status: res.status, corpo: data ?? texto, elapsedMs }, 200);
    }

    // Resolução ANTT vigente (secundário; best-effort, não derruba a consulta principal).
    let resolucaoAntt: unknown = null;
    try {
      const rr = await fetch(`${QUALP_BASE}/tabela-frete/v1/antt-resolution`, {
        headers: { 'Accept': 'application/json', 'Access-Token': QUALP_ACCESS_TOKEN },
      });
      if (rr.ok) resolucaoAntt = await rr.json();
    } catch (_) { /* ignora: é só a etiqueta da resolução */ }

    // Extração defensiva (nomes prováveis) + raw sempre presente pra conferência.
    const distanciaKm = extrairKm(data?.distancia ?? data?.distance ?? data?.distancia_total);
    const { lista: pracas, total: pedagioTotal } = normalizarPracas(data?.pedagios ?? data?.tolls ?? data?.pedagio, axis);
    const pisoAntt = data?.tabela_frete ?? data?.freight_table ?? data?.tabelaFrete ?? null;
    const consumo = data?.consumo_combustivel ?? data?.fuel_consumption ?? null;

    return json({
      ok: true,
      elapsedMs,
      // Números normalizados (foco: distância e pedágio):
      distanciaKm,
      pedagioTotal,
      pracas,
      // Secundário (comparação ANTT):
      pisoAntt,
      resolucaoAntt,
      consumo,
      // Resposta crua completa do Qualp (confira aqui se algum campo veio com outro nome):
      raw: data ?? texto,
    }, 200);
  } catch (err) {
    console.error('qualp-teste error:', err);
    return json({ ok: false, error: (err as Error).message || 'ERRO_INESPERADO' }, 200);
  }
});
