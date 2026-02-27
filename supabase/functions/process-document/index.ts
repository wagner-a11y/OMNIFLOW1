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

    const prompt = `
      Você é um especialista em OCR de documentos de transporte brasileiro.
      Analise o documento (CNH ou CRLV) e retorne APENAS um JSON:
      
      Para CNH: { "nome": str, "cpf": str, "rg": str, "registro_cnh": str, "codigo_seguranca": str, "protocolo": str }
      Para CRLV: { "placa": str, "renavam": str, "chassi": str, "cor": str, "ano_fab": str, "ano_mod": str, "marca": str, "modelo": str }
      
      Retorne null para campos não encontrados. Não inclua markdown no retorno.
    `;

    // Direct REST call to Gemini
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
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
