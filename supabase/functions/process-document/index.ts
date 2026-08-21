import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('--- Edge Function: process-document (REST) started ---');
    
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY missing in Supabase secrets');
    }

    const { fileBase64, fileType } = await req.json();
    if (!fileBase64) throw new Error('No file data provided');

    console.log(`Payload received: ${fileType}, data length: ${fileBase64.length}`);

    // Prompt ampliado para cobrir TODOS os campos que o cadastro de pessoa física
    // do Bsoft exige. O CRLV segue como estava — não é usado na Fase 2, mas não
    // pode quebrar. `tipo_documento` é sempre devolvido para a tela saber o que leu.
    const prompt = `
      Você é um especialista em OCR de documentos de transporte brasileiro.
      Analise o documento (CNH ou CRLV) e retorne APENAS um JSON.

      Para CNH:
      {
        "tipo_documento": "CNH",
        "nome": str, "sobrenome": str, "cpf": str, "rg": str, "orgao_expedidor_rg": str,
        "sexo": "M" ou "F" ou null, "data_nascimento": "YYYY-MM-DD",
        "registro_cnh": str, "codigo_seguranca": str, "protocolo": str,
        "categoria": str, "orgao_expedidor_cnh": str,
        "data_validade": "YYYY-MM-DD", "data_expedicao": "YYYY-MM-DD",
        "data_primeira_habilitacao": "YYYY-MM-DD", "data_validade_toxicologico": "YYYY-MM-DD"
      }

      Para CRLV:
      {
        "tipo_documento": "CRLV",
        "placa": str, "renavam": str, "chassi": str, "cor": str,
        "ano_fab": str, "ano_mod": str, "marca": str, "modelo": str
      }

      REGRAS:
      - Sempre inclua "tipo_documento" com o valor "CNH" ou "CRLV".
      - Em CNH, "nome" é o primeiro nome e "sobrenome" o restante do nome completo.
      - Toda data no formato YYYY-MM-DD. Se a data estiver em DD/MM/AAAA, converta.
      - Use null para qualquer campo não encontrado. Não invente valores.
      - Retorne só o JSON, sem markdown e sem texto ao redor.
    `;

    // Direct REST call to Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: fileType,
              data: fileBase64
            }
          }
        ]
      }],
      generationConfig: {
        response_mime_type: "application/json"
      }
    };

    console.log('Sending request to Gemini API...');
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!geminiRes.ok) {
      const errorText = await geminiRes.text();
      console.error('Gemini API Error:', errorText);
      throw new Error(`Gemini API returned ${geminiRes.status}: ${errorText}`);
    }

    const result = await geminiRes.json();
    console.log('Gemini API Success');

    const textPayload = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textPayload) {
      throw new Error('Gemini returned empty response');
    }

    // Since we requested application/json in generationConfig, textPayload should be pure JSON
    const data = JSON.parse(textPayload);
    console.log('Final Data:', data);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('CRITICAL EDGE FUNCTION ERROR:', error.message);
    return new Response(JSON.stringify({ 
      error: error.message,
      stack: error.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
