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

// Texto-modelo determinístico (fallback) — preenche os números, escaneável p/ WhatsApp.
function buildTemplate(s: any): string {
  const lines: string[] = [];
  lines.push(`📊 Relatório de cotações — ${s.label || 'período'}`);
  const varStr = typeof s.variation === 'number' ? ` (${s.variation > 0 ? '+' : ''}${s.variation}% vs período anterior)` : '';
  lines.push(`• Cotações: ${s.total ?? 0}${varStr}`);
  if (s.totalValue) lines.push(`• Valor cotado: ${s.totalValue}`);
  if (s.avgTime && s.avgTime !== '—') lines.push(`• Tempo médio de montagem: ${s.avgTime}`);
  if (Array.isArray(s.topClients) && s.topClients.length) {
    lines.push(`• Clientes que mais cotaram: ${s.topClients.slice(0, 3).map((c: any) => `${c.name} (${c.count}${c.value ? ` · ${c.value}` : ''})`).join(', ')}`);
  }
  if (Array.isArray(s.topVehicles) && s.topVehicles.length) {
    lines.push(`• Veículos cotados: ${s.topVehicles.slice(0, 4).map((v: any) => `${v.name} (${v.count})`).join(', ')}`);
  }
  if (Array.isArray(s.topRoutes) && s.topRoutes.length) {
    lines.push(`• Rotas mais quentes: ${s.topRoutes.slice(0, 3).map((rt: any) => `${rt.name} (${rt.count})`).join('; ')}`);
  }
  if (Array.isArray(s.topOperators) && s.topOperators.length) {
    const o = s.topOperators[0];
    lines.push(`• Destaque do time: ${o.name} (${o.count} cotações)`);
  }
  if (s.hoje) lines.push(`• Hoje: ${s.hoje.cotadas} cotadas, ${s.hoje.fechadas} fechadas (${s.hoje.conversao}% conversão)`);
  if (s.melhorAderencia) lines.push(`• Melhor aderência: ${s.melhorAderencia.nome} (${s.melhorAderencia.conv}% · ${s.melhorAderencia.fechadas}/${s.melhorAderencia.cotadas})`);
  if (s.cotaMuitoFechaPouco) lines.push(`• Cota muito e fecha pouco: ${s.cotaMuitoFechaPouco.nome} (${s.cotaMuitoFechaPouco.conv}% · ${s.cotaMuitoFechaPouco.cotadas} cotadas)`);
  if (Array.isArray(s.naoCotaramHoje) && s.naoCotaramHoje.length) lines.push(`• Clientes a chamar (não cotaram hoje): ${s.naoCotaramHoje.slice(0, 5).join(', ')}`);
  if (Array.isArray(s.insights) && s.insights.length) {
    lines.push('');
    lines.push('⚠️ Atenção:');
    s.insights.slice(0, 4).forEach((i: string) => lines.push(`• ${i}`));
  }
  return lines.join('\n');
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

    const prompt = `Você escreve um resumo curto e escaneável para o grupo de WhatsApp do comercial de uma transportadora.
REGRAS: use EXATAMENTE os números fornecidos abaixo, não invente nem altere nenhum número. Não calcule nada.
Poucas linhas, tom direto e profissional, pode usar 1-2 emojis discretos. Não use markdown de título (#). Responda só o texto final.

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
