import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Leitura inteligente de solicitação de frete (texto colado ou arquivo) via Gemini.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error('GEMINI_API_KEY missing in Supabase secrets');

    const { content, fileBase64, fileType } = await req.json();
    if (!content && !fileBase64) {
      throw new Error('Forneça texto (content) ou arquivo (fileBase64).');
    }

    const promptHeader = `Você é um assistente de cotação de frete rodoviário brasileiro.
Analise o conteúdo abaixo e extraia as seguintes informações no formato JSON,
sem texto adicional, apenas o JSON:

{
  "origem": "cidade e UF se encontrado, senão null",
  "destino": "cidade e UF se encontrado, senão null",
  "tipoCarga": "granel sólido | granel líquido | frigorificada | carga geral | neogranel | perigosa | conteinerizada | null",
  "peso": "número em kg se encontrado, senão null",
  "valorMercadoria": "número em reais se encontrado, senão null",
  "disponibilidade": "imediato | agendado | null",
  "solicitante": "nome da pessoa ou empresa que pediu, senão null",
  "observacoes": "qualquer informação relevante que não se encaixe nos campos acima"
}

Conteúdo da solicitação:
`;

    const parts: any[] = [];
    if (fileBase64) {
      parts.push({ text: promptHeader + "(conteúdo no documento anexo)" });
      parts.push({ inline_data: { mime_type: fileType || 'application/octet-stream', data: fileBase64 } });
    } else {
      parts.push({ text: promptHeader + content });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const body = {
      contents: [{ parts }],
      generationConfig: { response_mime_type: "application/json" },
    };

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      console.error('Gemini API Error:', errorText);
      throw new Error(`Gemini API returned ${geminiRes.status}: ${errorText}`);
    }

    const result = await geminiRes.json();
    const textPayload = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) throw new Error('Gemini returned empty response');

    const data = JSON.parse(textPayload);
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('CRITICAL EDGE FUNCTION ERROR:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
