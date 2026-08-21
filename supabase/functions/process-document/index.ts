import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

      ONDE PROCURAR na CNH (os rótulos mudam conforme o modelo/estado):
      - "sexo": rótulo "SEXO", geralmente ao lado da data de nascimento ou da
        filiação. Costuma vir como uma única letra M ou F. Em alguns modelos
        aparece como "MASCULINO"/"FEMININO" — nesse caso devolva só "M" ou "F".
        Procure em toda a frente do documento antes de desistir.
      - "codigo_seguranca": rótulo "Nº SEGURANÇA", "N SEGURANCA", "CÓDIGO DE
        SEGURANÇA" ou "SEGURANÇA". É um número longo (geralmente 11 dígitos),
        normalmente no rodapé ou no canto direito. NÃO confunda com o "Nº
        REGISTRO" (que é o registro_cnh) nem com o "Nº ESPELHO".
      - "registro_cnh": rótulo "Nº REGISTRO" ou "REGISTRO". É diferente do código
        de segurança — se achar os dois, cada um vai no seu campo.
      - "protocolo": fica na LATERAL da CNH, ao lado da foto do condutor, e
        normalmente está impresso NA VERTICAL (texto girado 90 graus). Leia esse
        texto lateral mesmo estando rotacionado — é o campo mais esquecido do
        documento justamente por causa disso. Rótulos: "Nº PROTOCOLO",
        "PROTOCOLO" ou "RENACH". Pode vir com a UF na frente (ex.: "SP123456789").
        Se encontrar PROTOCOLO e RENACH, prefira o rotulado PROTOCOLO.
      - "orgao_expedidor_cnh": o órgão emissor da CNH (ex.: "DETRAN-SP"),
        normalmente junto do local de emissão.
      - "data_validade_toxicologico": este dado NÃO costuma estar na CNH — é de
        um exame separado. Só preencha se estiver escrito no documento; caso
        contrário devolva null, sem tentar deduzir.

      REGRAS:
      - Sempre inclua "tipo_documento" com o valor "CNH" ou "CRLV".
      - Em CNH, "nome" é o primeiro nome e "sobrenome" o restante do nome completo.
      - Toda data no formato YYYY-MM-DD. Se a data estiver em DD/MM/AAAA, converta.
      - Leia TODO o documento antes de devolver null para um campo: rodapé, verso,
        fonte pequena e — importante — os textos VERTICAIS nas bordas laterais,
        que ficam girados 90 graus e passam despercebidos.
      - Use null para qualquer campo não encontrado. Não invente valores nem
        deduza o que não está escrito.
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

    // O Gemini devolve 503 quando o modelo está sobrecarregado e 429 quando
    // estoura cota — os dois são TRANSITÓRIOS. Sem retry, o operador via um erro
    // seco e achava que o documento estava errado. Espera progressiva: 1s, 3s.
    const ESPERAS = [1000, 3000];
    let geminiRes: Response | null = null;
    let ultimoTexto = '';
    let ultimoStatus = 0;

    for (let tentativa = 0; tentativa <= ESPERAS.length; tentativa++) {
      console.log(`Sending request to Gemini API (tentativa ${tentativa + 1})...`);
      geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (geminiRes.ok) break;

      ultimoStatus = geminiRes.status;
      ultimoTexto = await geminiRes.text();
      const valeRetentar = ultimoStatus === 503 || ultimoStatus === 429 || ultimoStatus >= 500;
      console.error(`Gemini API Error ${ultimoStatus} (tentativa ${tentativa + 1})`);
      if (!valeRetentar || tentativa === ESPERAS.length) {
        // Mensagem em português, dizendo o que fazer — o operador não deve
        // decifrar payload do Google.
        const amigavel = ultimoStatus === 503
          ? 'O leitor de documentos (Google Gemini) está sobrecarregado no momento. Tente de novo em alguns segundos ou preencha os campos à mão.'
          : ultimoStatus === 429
            ? 'Cota do leitor de documentos esgotada no momento. Tente mais tarde ou preencha à mão.'
            : `O leitor de documentos falhou (HTTP ${ultimoStatus}). Tente de novo ou preencha à mão.`;
        return new Response(JSON.stringify({ error: amigavel, status: ultimoStatus }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await new Promise((r) => setTimeout(r, ESPERAS[tentativa]));
    }

    const result = await geminiRes!.json();
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
