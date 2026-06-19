import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Compila o TEXTO do relatório pro WhatsApp. A IA SÓ escreve texto a partir dos números
// já calculados (recebidos prontos) — nunca calcula nada. Rede de segurança: se o Gemini
// falhar por qualquer motivo (inclusive cota), retorna um texto-modelo preenchido com os
// números. Sempre responde 200 — o relatório nunca quebra por causa da IA.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Junta itens em linguagem natural: "A", "A e B", "A, B e C".
function joinNat(arr: string[]): string {
  if (arr.length <= 1) return arr[0] || '';
  return arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
}

// Texto-modelo determinístico (fallback) — mesmos números, mas em frases que fluem
// em vez de bullets crus. Usado quando a IA não responde (ex.: cota estourada).
// Os números entram exatamente como vieram; aqui só muda a redação.
function buildTemplate(s: any): string {
  const paras: string[] = [];
  paras.push(`📊 Relatório de cotações — ${s.label || 'período'}`);

  // Volume, valor e tempo de montagem.
  const abertura: string[] = [];
  let l1 = `Fechamos o período com ${s.total ?? 0} cotação(ões)`;
  if (typeof s.variation === 'number' && s.variation !== 0) {
    l1 += `, ${Math.abs(s.variation)}% ${s.variation > 0 ? 'acima' : 'abaixo'} do período anterior`;
  } else if (s.variation === 0) {
    l1 += `, no mesmo ritmo do período anterior`;
  }
  abertura.push(l1 + '.');
  if (s.totalValue) abertura.push(`No total, ${s.totalValue} em frete cotado.`);
  if (s.avgTime && s.avgTime !== '—') abertura.push(`O tempo médio pra montar uma cotação ficou em ${s.avgTime}.`);
  paras.push(abertura.join(' '));

  // Clientes, veículos e rotas que puxaram o movimento.
  const mov: string[] = [];
  if (Array.isArray(s.topClients) && s.topClients.length) {
    const c = s.topClients.slice(0, 3).map((c: any) => `${c.name} (${c.count}${c.value ? `, ${c.value}` : ''})`);
    mov.push(`Quem mais movimentou foi ${joinNat(c)}.`);
  }
  if (Array.isArray(s.topVehicles) && s.topVehicles.length) {
    const v = s.topVehicles.slice(0, 4).map((v: any) => `${v.name} (${v.count})`);
    mov.push(`Nos veículos, a procura veio principalmente de ${joinNat(v)}.`);
  }
  if (Array.isArray(s.topRoutes) && s.topRoutes.length) {
    const r = s.topRoutes.slice(0, 3).map((rt: any) => `${rt.name} (${rt.count})`);
    mov.push(`As rotas mais quentes foram ${joinNat(r)}.`);
  }
  if (mov.length) paras.push(mov.join(' '));

  // O dia e o time — com tato para quem está abaixo da média.
  const dia: string[] = [];
  if (s.hoje) dia.push(`Hoje saíram ${s.hoje.cotadas} cotações e ${s.hoje.fechadas} fecharam, ${s.hoje.conversao}% de conversão.`);
  if (Array.isArray(s.topOperators) && s.topOperators.length) {
    const o = s.topOperators[0];
    dia.push(`No volume, ${o.name} foi quem mais cotou (${o.count})${o.avgTime && o.avgTime !== '—' ? `, com média de ${o.avgTime} por cotação` : ''}.`);
  }
  if (s.melhorAderencia) dia.push(`Na conversão, ${s.melhorAderencia.nome} se destacou com ${s.melhorAderencia.conv}% (${s.melhorAderencia.fechadas}/${s.melhorAderencia.cotadas}).`);
  if (s.cotaMuitoFechaPouco) dia.push(`Vale acompanhar de perto ${s.cotaMuitoFechaPouco.nome}, que cotou bastante (${s.cotaMuitoFechaPouco.cotadas}) e fechou ${s.cotaMuitoFechaPouco.conv}% — pode ter algo travando o fechamento.`);
  if (Array.isArray(s.naoCotaramHoje) && s.naoCotaramHoje.length) dia.push(`Ainda não cotaram hoje: ${s.naoCotaramHoje.slice(0, 5).join(', ')} — vale uma chamada.`);
  if (dia.length) paras.push(dia.join(' '));

  // Pontos de atenção.
  if (Array.isArray(s.insights) && s.insights.length) {
    paras.push(`⚠️ De olho: ${s.insights.slice(0, 4).join(' ')}`);
  }
  return paras.join('\n\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let summary: any = {};
  try { summary = (await req.json())?.summary || {}; } catch { summary = {}; }

  // 1) Texto-modelo SEMPRE pronto (rede de segurança).
  const fallback = buildTemplate(summary);

  // 2) Tenta a IA só para reescrever de forma mais fluida. Qualquer falha -> fallback.
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ text: fallback, source: 'fallback' });

    const prompt = `Você é o gestor comercial de uma transportadora passando o resultado do período para a equipe no grupo de WhatsApp. Escreva como um gestor experiente comunicando fatos: frases que fluem e se conectam, tom direto, sóbrio e profissional. É uma comunicação de trabalho, não um discurso de motivação nem um papo de bar. Vá direto ao conteúdo.

NÚMEROS SÃO SAGRADOS: use exatamente os valores do JSON, sem arredondar, alterar, somar ou criar nenhum número. Não calcule nada. Se um dado não está no JSON, não fale dele. Trate as cotações como "cotações" (não "operações" nem "pedidos"). Pode interpretar de leve o que um número indica (ex.: que o movimento foi forte ou fraco, que alguém puxou o time), mas nunca afirme nada além do que o dado mostra.

TATO COM A EQUIPE: ao mencionar quem está abaixo da média (conversão baixa, parado), enquadre de forma construtiva e sem expor ninguém — algo como "vale ver se tem algo travando", nunca como acusação ou cobrança pública. Não dirija a fala diretamente à pessoa ("Fulano, você..."); fale dela em terceira pessoa. Reconheça quem se destacou de forma sóbria, sem bajulação nem "mandou muito bem".

PROIBIDO (isto faz o texto soar falso):
- Saudação ou abertura: nada de "E aí", "Pessoal", "Galera", "Bom dia", "Passando pra", "Segue o resumo".
- Despedida ou frase motivacional de fechamento: nada de "bora", "vamos pra cima", "vamos forte", "bom descanso", "amanhã a gente volta", "é isso, pessoal", "rumo à meta".
- Clichês de IA: "em resumo", "vale ressaltar", "espero que ajude".
- Bullets, listas, títulos, markdown (#, *), hashtags, e exclamações de empolgação.
Comece pelo conteúdo (o volume do período) e termine no último fato relevante, sem arremate motivacional.

Use no máximo 1 emoji, e só se couber natural — pode não usar nenhum. Mantenha enxuto, alguns parágrafos curtos. Português brasileiro. Responda só o texto final, pronto pra colar no WhatsApp.

O que cada campo significa (NÃO altere os valores, só apresente com o sentido certo):
- total: nº de cotações no período. variation: variação percentual desse total vs o período anterior (positivo = acima, negativo = abaixo); sempre diga "%" e a direção.
- totalValue: soma do valor cotado. avgTime: tempo médio pra montar uma cotação.
- topClients/topVehicles/topRoutes: count = nº de cotações; value = valor cotado.
- hoje: cotadas hoje, fechadas hoje, conversao em %. melhorAderencia: melhor conversão (conv em %, fechadas/cotadas). cotaMuitoFechaPouco: cotou muito e converteu pouco (conv em %). naoCotaramHoje: clientes sem cotação hoje. insights: pontos de atenção já apurados.

Dados (JSON):
${JSON.stringify(summary)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      console.warn('Gemini falhou (status):', res.status);
      return json({ text: fallback, source: 'fallback' });
    }
    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!aiText) return json({ text: fallback, source: 'fallback' });
    return json({ text: aiText, source: 'ai' });
  } catch (e) {
    console.warn('Gemini exception:', (e as Error).message);
    return json({ text: fallback, source: 'fallback' });
  }
});
