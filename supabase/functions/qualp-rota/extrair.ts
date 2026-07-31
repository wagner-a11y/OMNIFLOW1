// ============================================================================
// Extratores da resposta do Qualp /rotas/v4 — distância e pedágio.
//
// Ficam fora do index.ts para poderem ser exercitados contra respostas reais
// sem subir a Edge Function. Formas confirmadas em dado real (SP->RJ, 5 eixos):
//   distancia: { texto: "437 km", valor: 437 }
//   pedagios:  [ { nome, uf, rodovia, km, concessionaria,
//                  tarifa: { "5": 22.5 }, tarifa_tag: { "5": 21.38 }, ... } ]
// ============================================================================

/** Distância em km. O Qualp devolve { texto: "437 km", valor: 437 }. */
export function extrairKm(distancia: unknown): number | null {
  if (typeof distancia === "number") return Number.isFinite(distancia) ? distancia : null;
  if (distancia && typeof distancia === "object") {
    const o = distancia as Record<string, unknown>;
    if (typeof o.valor === "number") return Number.isFinite(o.valor) ? o.valor : null;
    if (typeof o.texto === "string") return extrairKm(o.texto);
  }
  if (typeof distancia === "string") {
    const n = parseFloat(distancia.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valor de um mapa chaveado por nº de eixos: tarifa: { "5": 22.5 }. */
export function porEixo(mapa: unknown, eixos: number): number | null {
  if (!mapa || typeof mapa !== "object") return null;
  const v = (mapa as Record<string, unknown>)[String(eixos)];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface Praca {
  nome: string;
  uf: string | null;
  rodovia: string | null;
  km: string | null;
  concessionaria: string | null;
  tarifa: number | null;      // tarifa cheia para o nº de eixos da cotação
  tarifaTag: number | null;   // tarifa com desconto de tag (só snapshot)
}

/**
 * Praças de pedágio para o nº de eixos da cotação.
 *
 * `total` soma as tarifas CHEIAS — é esse o custo que entra no preço.
 * `totalTag` soma as tarifas com tag e vai só para o snapshot: a tag é um
 * benefício de quem paga, não uma redução do custo que cotamos.
 *
 * Praça sem tarifa para o eixo pedido entra na lista com null (fica visível
 * na conferência) e soma zero — nunca vira um valor inventado.
 */
export function extrairPedagio(pedagios: unknown, eixos: number): {
  pracas: Praca[];
  total: number;
  totalTag: number;
} {
  const arr = Array.isArray(pedagios) ? pedagios : [];
  const pracas: Praca[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    pracas.push({
      nome: String(o.nome ?? o.concessionaria ?? o.rodovia ?? "—"),
      uf: o.uf != null ? String(o.uf) : null,
      rodovia: o.rodovia != null ? String(o.rodovia) : null,
      km: o.km != null ? String(o.km) : null,
      concessionaria: o.concessionaria != null ? String(o.concessionaria) : null,
      tarifa: porEixo(o.tarifa, eixos),
      tarifaTag: porEixo(o.tarifa_tag, eixos),
    });
  }

  const cent = (n: number) => Math.round(n * 100) / 100;
  return {
    pracas,
    total: cent(pracas.reduce((s, p) => s + (p.tarifa ?? 0), 0)),
    totalTag: cent(pracas.reduce((s, p) => s + (p.tarifaTag ?? 0), 0)),
  };
}
