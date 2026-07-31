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

// Distância -> km numérico. Aceita número, string ("123 km"/"123,4"), ou { value, text }.
function extrairKm(distancia: unknown): number | null {
  if (distancia == null) return null;
  if (typeof distancia === 'number') return distancia > 10000 ? Math.round(distancia / 1000) : distancia; // heurística m->km
  if (typeof distancia === 'object') {
    const o = distancia as Record<string, unknown>;
    if (typeof o.value === 'number') return o.value > 10000 ? Math.round(o.value / 1000) : o.value;
    if (typeof o.text === 'string') return extrairKm(o.text);
  }
  if (typeof distancia === 'string') {
    const n = parseFloat(distancia.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

// Normaliza a lista de praças de pedágio a partir de várias formas possíveis.
function normalizarPracas(pedagios: unknown): { lista: Array<{ nome: string; uf: string | null; valor: number | null }>; total: number | null } {
  // Formas aceitas: array direto; { pedagios: [...] }; { lista: [...] }; { total, ... }.
  let arr: unknown = pedagios;
  let totalDeclarado: number | null = null;
  if (pedagios && typeof pedagios === 'object' && !Array.isArray(pedagios)) {
    const o = pedagios as Record<string, unknown>;
    totalDeclarado = extrairValor(o);
    arr = o.pedagios ?? o.lista ?? o.pracas ?? o.items ?? o.data ?? [];
  }
  const lista: Array<{ nome: string; uf: string | null; valor: number | null }> = [];
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const nome = String(o.nome ?? o.name ?? o.praca ?? o.concessionaria ?? o.rodovia ?? o.local ?? '—');
      const uf = (o.uf ?? o.estado ?? o.state ?? null) as string | null;
      lista.push({ nome, uf: uf ? String(uf) : null, valor: extrairValor(o) });
    }
  }
  const somaLista = lista.reduce((s, p) => s + (p.valor || 0), 0);
  const total = totalDeclarado ?? (somaLista > 0 ? Math.round(somaLista * 100) / 100 : null);
  return { lista, total };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!QUALP_ACCESS_TOKEN) {
    return json({ ok: false, error: 'QUALP_ACCESS_TOKEN_MISSING', hint: 'Cadastre o secret QUALP_ACCESS_TOKEN no Supabase.' }, 200);
  }

  try {
    const { origem, destino, eixos = 6, fuel = false } = await req.json();
    if (!origem || !destino) {
      return json({ ok: false, error: 'origem e destino são obrigatórios' }, 400);
    }
    const axis = Math.max(0, Math.min(15, Number(eixos) || 0));

    // Corpo exato confirmado pela doc oficial (OpenAPI v4).
    const body = {
      locations: [String(origem), String(destino)],
      config: {
        route: { type_route: 'efficient', calculate_return: false },
        vehicle: { type: 'truck', axis },
        show: {
          tolls: true,
          freight_table: true,
          fuel_consumption: !!fuel,
          polyline: false,
          simplified_polyline: false,
          maneuvers: 'false',
          static_image: false,
          private_places: false,
        },
        freight_table: { category: 'all', axis },
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
    const { lista: pracas, total: pedagioTotal } = normalizarPracas(data?.pedagios ?? data?.tolls ?? data?.pedagio);
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
