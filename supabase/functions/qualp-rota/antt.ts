// ============================================================================
// Piso mínimo ANTT a partir da resposta do Qualp (/rotas/v4 -> tabela_frete).
//
// Estrutura confirmada em dado real (SP -> RJ, 31/07/2026, resolução 6.084):
//   tabela_frete = {
//     distancia: 437.345,
//     dados: { "A": { "5": { "geral": 3573.14 } } },
//     antt_resolucao: { nome, data, data_final, url }
//   }
// ou seja: dados[categoria][eixos][tipo_carga] = piso.
//
// Uma categoria de carga POR CONSULTA — mandamos em freight_load o tipo que a
// cotação está usando (padrão "geral"), nunca "all": no plano pago "all" pode
// ser tarifado como múltiplas consultas, encarecendo toda cotação sem ganho
// real, já que carga geral é o caso dominante.
// ============================================================================

// Tabela da calculadora. A é a que a cotação usa (utils/antt.ts -> ANTT_TABLE_A).
export const CATEGORIA_PADRAO = 'A';

// Tipo de carga da calculadora (ANTT_CARGO_TYPES em utils/antt.ts) -> enum
// freight_load do Qualp. Mapa 1:1, mesma ordem da Tabela A oficial.
// A grafia "conteineirizada" é a do Qualp — mantida literal de propósito.
// Os 12 tokens foram validados em dado real (auditoria com freight_load=all,
// categoria A, 5 eixos, SP->RJ): todos os 12 voltaram com piso, nenhum vazio,
// e o retorno não trouxe nenhum token fora deste mapa.
export const FREIGHT_LOAD_POR_CARGA: Record<string, string> = {
  'Granel sólido': 'granel_solido',
  'Granel líquido': 'granel_liquido',
  'Frigorificada ou aquecida': 'frigorificada',
  'Conteinerizada': 'conteineirizada',
  'Carga geral': 'geral',
  'Neogranel': 'neogranel',
  'Perigosa (granel sólido)': 'perigosa_granel_solido',
  'Perigosa (granel líquido)': 'perigosa_granel_liquido',
  'Perigosa (frigorificada ou aquecida)': 'perigosa_frigorificada',
  'Perigosa (conteinerizada)': 'perigosa_conteineirizada',
  'Perigosa (carga geral)': 'perigosa_geral',
  'Carga granel pressurizada': 'granel_pressurizada',
};

export const FREIGHT_LOAD_PADRAO = 'geral';

/** Converte o tipo de carga da cotação no valor de freight_load a enviar. */
export const freightLoadDaCarga = (cargoType: string | null | undefined): string =>
  (cargoType && FREIGHT_LOAD_POR_CARGA[cargoType]) || FREIGHT_LOAD_PADRAO;

/**
 * Piso vindo do Qualp para UMA combinação categoria/eixos/carga.
 *
 * Retorna null — "combinação sem piso ANTT" — sempre que o piso não existir de
 * fato, caindo na mesma regra que a calculadora já usa para eixo inválido por
 * categoria (computeANTTFloor -> null, exibido como "—"). NUNCA devolve zero:
 * piso zero seria lido como "frete mínimo R$ 0,00" e liberaria cotação abaixo
 * do piso legal. Casos que caem em null:
 *   - tabela_frete/dados ausentes ou não-objeto;
 *   - `dados: []` (o Qualp devolve array vazio quando o freight_load não casa
 *     com o enum — visto em dado real com "carga_geral", que é inválido);
 *   - qualquer nível da chave faltando (ex.: Conteinerizada em 2 eixos, ou
 *     Granel pressurizada em eixos sem valor na tabela);
 *   - valor nulo, não numérico, não finito, ou <= 0.
 */
export function extrairPisoAntt(
  tabelaFrete: unknown,
  eixos: number | string | null | undefined,
  freightLoad: string,
  categoria: string = CATEGORIA_PADRAO,
): number | null {
  const dados = objeto(tabelaFrete)?.dados;
  const porCategoria = objeto(dados);
  if (!porCategoria) return null; // cobre null, [] e valores primitivos

  const porEixo = objeto(porCategoria[categoria]);
  if (!porEixo) return null;

  // O Qualp chaveia os eixos por string ("5"), como manda no axis da requisição.
  const chaveEixo = String(eixos ?? '').trim();
  if (!chaveEixo) return null;

  const porCarga = objeto(porEixo[chaveEixo]);
  if (!porCarga) return null;

  return numeroPositivo(porCarga[freightLoad]);
}

/** Objeto "de verdade" (exclui null, arrays e primitivos). */
function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Número finito > 0, ou null. Zero/negativo conta como ausência de piso. */
function numeroPositivo(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const limpo = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const p = parseFloat(limpo);
    if (Number.isFinite(p)) n = p;
  }
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

/** Etiqueta da resolução ANTT vigente (ex.: "RESOLUÇÃO ANTT Nº 6.084"). */
export function extrairResolucaoAntt(
  tabelaFrete: unknown,
): { nome: string; data: string | null; url: string | null } | null {
  const r = objeto(objeto(tabelaFrete)?.antt_resolucao);
  if (!r || typeof r.nome !== 'string') return null;
  return {
    nome: r.nome,
    data: typeof r.data === 'string' ? r.data : null,
    url: typeof r.url === 'string' ? r.url : null,
  };
}
