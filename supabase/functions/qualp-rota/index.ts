import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  CATEGORIA_PADRAO,
  extrairPisoAntt,
  extrairResolucaoAntt,
  freightLoadDaCarga,
} from "./antt.ts";
import { extrairKm, extrairPedagio } from "./extrair.ts";

// ============================================================================
// qualp-rota — FONTE ÚNICA de distância, pedágio e piso ANTT da cotação.
//
// Uma chamada ao Qualp /rotas/v4 devolve os três. Nada aqui vem do Google nem
// da tabela ANTT local: o que esta função retorna é o que a cotação usa.
//
// Falha é BLOQUEANTE: timeout + 1 retry e, se ainda assim falhar, devolve
// { ok: false, bloqueante: true } e a cotação não fecha. NÃO existe fallback
// para número velho — número velho numa cotação é pior que cotação travada.
//
// A chave vem só do secret QUALP_ACCESS_TOKEN (nunca hardcoded).
// ============================================================================

const QUALP_ACCESS_TOKEN = Deno.env.get("QUALP_ACCESS_TOKEN") || "";
const QUALP_BASE = "https://api.qualp.com.br";

// Injetados automaticamente pelo runtime das Edge Functions. Usados só para o
// log de saúde (qualp_health), que é best-effort e nunca derruba a consulta.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Timeout por tentativa e nº de tentativas (1 chamada + 1 retry).
const TIMEOUT_MS = 7000;
const MAX_TENTATIVAS = 2;

// Só a granel pressurizada carrega o aviso de conferência manual: é o único
// tipo em que o Qualp divergiu da Tabela A local (devolve o coeficiente de
// 4 eixos quando axis=5, ~8% abaixo). Decisão: aceitar o Qualp puro e sinalizar
// na UI, onde o operador já pode sobrescrever com aviso. Nenhum outro tipo tem
// cerca de sanidade.
const CARGA_CONFERIR_MANUAL = "granel_pressurizada";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Origem e destino são o mesmo município? Compara sem acento, caixa ou
 * pontuação: "São Paulo, SP", "sao paulo-sp" e "SAO PAULO / SP" são iguais.
 * A rota simples manda o texto canônico do IBGE dos dois lados, então a
 * comparação é exata na prática; a normalização cobre o resto.
 */
function mesmoMunicipio(a: string, b: string): boolean {
  const norm = (s: string) =>
    (s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const na = norm(a);
  return !!na && na === norm(b);
}

// Sempre HTTP 200: supabase.functions.invoke só expõe "non-2xx status code" e
// engole o corpo, e aqui o MOTIVO da falha precisa chegar na tela.
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

// ---------------------------------------------------------------------------
// Chamada ao Qualp, com timeout e 1 retry
// ---------------------------------------------------------------------------

interface Tentativa {
  data: Record<string, unknown> | null;
  status: number | null;
  erro: string | null;
  tentativas: number;
}

async function chamarQualp(body: unknown): Promise<Tentativa> {
  let ultimoErro = "ERRO_DESCONHECIDO";
  let ultimoStatus: number | null = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const abortar = new AbortController();
    const timer = setTimeout(() => abortar.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${QUALP_BASE}/rotas/v4`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Access-Token": QUALP_ACCESS_TOKEN,
        },
        body: JSON.stringify(body),
        signal: abortar.signal,
      });
      ultimoStatus = res.status;
      const texto = await res.text();

      if (!res.ok) {
        ultimoErro = `QUALP_HTTP_${res.status}`;
        // 4xx é erro nosso (payload/token/cota): repetir não muda o resultado.
        if (res.status >= 400 && res.status < 500) {
          return { data: null, status: res.status, erro: ultimoErro, tentativas: tentativa };
        }
        continue; // 5xx: vale o retry
      }

      try {
        return {
          data: JSON.parse(texto) as Record<string, unknown>,
          status: res.status,
          erro: null,
          tentativas: tentativa,
        };
      } catch {
        ultimoErro = "QUALP_RESPOSTA_NAO_JSON";
        continue;
      }
    } catch (err) {
      ultimoErro = (err as Error)?.name === "AbortError"
        ? `QUALP_TIMEOUT_${TIMEOUT_MS}MS`
        : `QUALP_REDE: ${(err as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  }

  return { data: null, status: ultimoStatus, erro: ultimoErro, tentativas: MAX_TENTATIVAS };
}

// ---------------------------------------------------------------------------
// Log de saúde (best-effort: nunca derruba a cotação)
// ---------------------------------------------------------------------------

async function registrarSaude(linha: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/qualp_health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(linha),
    });
  } catch (err) {
    // Inclui o caso da tabela ainda não existir. O log é observabilidade;
    // perder uma linha nunca pode custar uma cotação.
    console.error("qualp_health: falha ao registrar (ignorado)", err);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();

  if (!QUALP_ACCESS_TOKEN) {
    return json({
      ok: false,
      bloqueante: true,
      error: "QUALP_ACCESS_TOKEN_MISSING",
      mensagem: "Integração do Qualp sem credencial. Avise o suporte — a cotação não pode ser fechada sem pedágio e piso confiáveis.",
    });
  }

  let origem = "", destino = "", eixos = 0, freightLoad = "", categoria = CATEGORIA_PADRAO;

  try {
    const corpo = await req.json();
    origem = String(corpo?.origem ?? "").trim();
    destino = String(corpo?.destino ?? "").trim();
    eixos = Math.max(0, Math.min(15, Number(corpo?.eixos) || 0));
    // A cotação manda o tipo de carga pelo NOME da calculadora; o mapa dos 12
    // tokens fica no parser. Uma carga por consulta — nunca "all" em produção.
    freightLoad = freightLoadDaCarga(corpo?.tipoCarga);
    categoria = String(corpo?.categoria ?? CATEGORIA_PADRAO);

    if (!origem || !destino) {
      return json({ ok: false, bloqueante: true, error: "ORIGEM_DESTINO_OBRIGATORIOS", mensagem: "Informe origem e destino." });
    }
    if (!eixos) {
      return json({ ok: false, bloqueante: true, error: "EIXOS_OBRIGATORIOS", mensagem: "Informe o número de eixos do veículo." });
    }
  } catch {
    return json({ ok: false, bloqueante: true, error: "CORPO_INVALIDO", mensagem: "Requisição malformada." });
  }

  // Frete urbano: origem e destino no MESMO município. Detectado ANTES de chamar
  // o Qualp, por três razões: (1) não gasta consulta paga para uma resposta que
  // já conhecemos; (2) não gera linha de falha no qualp_health — isto é
  // comportamento esperado, não incidente; (3) não é bloqueante, porque a
  // distância zero é a resposta CORRETA aqui, e o operador vai preencher à mão.
  // Antes desta guarda o caso caía em QUALP_SEM_DISTANCIA e a tela dizia "Qualp
  // indisponível", o que era mentira: o Qualp respondia normalmente.
  if (mesmoMunicipio(origem, destino)) {
    return json({
      ok: false,
      bloqueante: false,          // <- não trava o fechamento da cotação
      urbano: true,
      error: "FRETE_URBANO",
      mensagem: "Frete dentro do mesmo município ainda não é cotado automaticamente. Preencha distância, pedágio e piso manualmente.",
      origemNormalizada: origem,
      destinoNormalizada: destino,
    });
  }

  // Corpo conforme OpenAPI v4: "show" é IRMÃO de "config", não filho.
  const body = {
    locations: [origem, destino],
    config: {
      // avoid_locations: false É OBRIGATÓRIO ir explícito, mesmo desligado e mesmo
      // a doc declarando `default: false`. Com o campo AUSENTE, o validador do
      // Qualp trata como se o recurso estivesse sendo pedido e recusa a rota
      // inteira com 422 PermissionDeniedException quando o plano não o inclui —
      // foi o que derrubou a operação em 04/08/2026, ao migrar para o Bronze 1000.
      // Comprovado: mesmo corpo sem o campo = 422; com o campo = 200. NÃO REMOVER.
      route: { type_route: "efficient", calculate_return: false, avoid_locations: false },
      vehicle: { type: "truck", axis: eixos },
      // axis é STRING no schema do freight_table (diferente do vehicle.axis).
      freight_table: { category: categoria, freight_load: freightLoad, axis: String(eixos) },
    },
    // Só o que o plano Bronze 1000 inclui. NÃO mandar chave de recurso fora do
    // plano, nem desligada: em 04/08/2026 o Qualp passou a recusar a rota inteira
    // com 422 PermissionDeniedException citando avoid_locations, e o que havia no
    // corpo eram private_places (Gold), maneuvers e static_image (Silver/Gold) —
    // os três enviados com o próprio default, ou seja, pedindo nada. Todos os
    // recursos fora do plano ficam de fora daqui; o default do Qualp já é desligado.
    show: {
      tolls: true,           // Pedágios — incluso no plano
      freight_table: true,   // Tabela de Frete ANTT — incluso no plano
      fuel_consumption: false,
      polyline: false,
      simplified_polyline: false,
    },
  };

  const { data, status, erro, tentativas } = await chamarQualp(body);
  const latenciaMs = Date.now() - t0;

  if (erro || !data) {
    await registrarSaude({
      ok: false, status_http: status, erro, latencia_ms: latenciaMs, tentativas,
      origem, destino, eixos, freight_load: freightLoad,
    });
    return json({
      ok: false,
      bloqueante: true,
      error: erro ?? "QUALP_SEM_RESPOSTA",
      tentativas,
      latenciaMs,
      mensagem: "Não foi possível obter pedágio, distância e piso ANTT do Qualp. A cotação não pode ser fechada com número estimado — tente de novo em instantes.",
    });
  }

  const tabelaFrete = data.tabela_frete;

  // Distância: vem do tabela_frete (437.345), não de data.distancia (437,
  // arredondado). É a MESMA base que o Qualp usa pra calcular o piso ANTT, então
  // piso e custo/km ficam sobre o mesmo número. data.distancia fica só como
  // reserva, caso o tabela_frete venha sem distância.
  const distanciaTabela = tabelaFrete && typeof tabelaFrete === "object"
    ? (tabelaFrete as Record<string, unknown>).distancia
    : null;
  const distanciaKm = extrairKm(distanciaTabela) ?? extrairKm(data.distancia);

  const { pracas, total: pedagioCheio, totalTag: pedagioComTag } = extrairPedagio(data.pedagios, eixos);
  const pisoAntt = extrairPisoAntt(tabelaFrete, eixos, freightLoad, categoria);
  const resolucaoAntt = extrairResolucaoAntt(tabelaFrete);

  // Rota com praças mas nenhuma tarifa para o eixo pedido: o Qualp respondeu,
  // só que o mapa tarifa[eixos] não tem essa chave. Somar isso daria pedágio
  // R$ 0,00 numa rota que TEM pedágio — número errado é pior que erro, então
  // bloqueia. Rota genuinamente sem praça (lista vazia) segue normal com zero.
  if (pracas.length > 0 && pracas.every((p) => p.tarifa == null)) {
    await registrarSaude({
      ok: false, status_http: status, erro: "QUALP_PEDAGIO_SEM_TARIFA", latencia_ms: latenciaMs, tentativas,
      origem, destino, eixos, freight_load: freightLoad,
      id_transacao: data.id_transacao != null ? String(data.id_transacao) : null,
    });
    return json({
      ok: false,
      bloqueante: true,
      error: "QUALP_PEDAGIO_SEM_TARIFA",
      latenciaMs,
      mensagem: `O Qualp devolveu ${pracas.length} praça(s) de pedágio sem tarifa para ${eixos} eixos. Confira o veículo e tente de novo.`,
    });
  }

  // Distância é insumo de tudo (frete, piso, custo por km). Sem ela a resposta
  // veio ok mas inútil — trata como falha bloqueante, não como zero.
  if (distanciaKm == null || distanciaKm <= 0) {
    await registrarSaude({
      ok: false, status_http: status, erro: "QUALP_SEM_DISTANCIA", latencia_ms: latenciaMs, tentativas,
      origem, destino, eixos, freight_load: freightLoad,
      id_transacao: data.id_transacao != null ? String(data.id_transacao) : null,
    });
    return json({
      ok: false,
      bloqueante: true,
      error: "QUALP_SEM_DISTANCIA",
      latenciaMs,
      mensagem: "O Qualp respondeu sem distância para esta rota. Confira origem e destino e tente de novo.",
    });
  }

  await registrarSaude({
    ok: true, status_http: status, erro: null, latencia_ms: latenciaMs, tentativas,
    origem, destino, eixos, freight_load: freightLoad,
    distancia_km: distanciaKm, pedagio_cheio: pedagioCheio, piso_antt: pisoAntt,
    id_transacao: data.id_transacao != null ? String(data.id_transacao) : null,
  });

  return json({
    ok: true,
    latenciaMs,
    tentativas,
    distanciaKm,
    // Endereços normalizados pelo Qualp — mesma origem da distância, evita a
    // tela mostrar cidade diferente da que foi roteada.
    origemNormalizada: data.endereco_inicio != null ? String(data.endereco_inicio) : origem,
    destinoNormalizada: data.endereco_fim != null ? String(data.endereco_fim) : destino,
    pedagio: {
      cheio: pedagioCheio,     // <- é este que entra no preço
      comTag: pedagioComTag,   // <- snapshot; NÃO entra no preço
      pracas,
    },
    pisoAntt,                  // null = "—" na tela; nunca zero
    freightLoad,
    categoria,
    resolucaoAntt,
    // Só granel pressurizada: pede conferência manual do piso na UI.
    confirmarPisoManualmente: freightLoad === CARGA_CONFERIR_MANUAL,
    idTransacao: data.id_transacao != null ? String(data.id_transacao) : null,
  });
});
