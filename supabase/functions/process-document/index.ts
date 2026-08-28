import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { conferirPorta, HEADER_TOKEN } from "../_shared/porta.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, x-client-info, apikey, content-type, x-supabase-client-platform, ${HEADER_TOKEN}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Porta de entrada: usuário logado ou token do link de cadastro externo.
  // A anon key sozinha NÃO passa — ela é pública (vai no bundle) e nunca foi
  // credencial. Ver supabase/functions/_shared/porta.ts.
  //
  // Esta aqui não grava nada, mas cada chamada é uma leitura paga do Gemini:
  // aberta, um link vazado vira conta a pagar.
  const porta = conferirPorta(req);
  if (!porta.ok) {
    return new Response(JSON.stringify({ error: porta.erro }), {
      status: porta.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
        "nome": str, "sobrenome": str, "cpf": str,
        "numero_rg": str, "orgao_expedidor_rg": str, "uf_rg": str,
        "nome_mae": str, "nome_pai": str,
        "sexo": "M" ou "F" ou null, "data_nascimento": "YYYY-MM-DD",
        "registro_cnh": str, "codigo_seguranca": str, "protocolo": str,
        "categoria": str, "orgao_expedidor_cnh": str,
        "data_validade": "YYYY-MM-DD", "data_expedicao": "YYYY-MM-DD",
        "data_primeira_habilitacao": "YYYY-MM-DD", "data_validade_toxicologico": "YYYY-MM-DD",
        "naturalidade_municipio": str, "naturalidade_uf": str, "uf_emissao_cnh": str
      }

      Para CRLV:
      {
        "tipo_documento": "CRLV",
        "placa": str, "renavam": str, "chassi": str, "cor": str,
        "ano_fabricacao": str, "ano_modelo": str,
        "marca_texto": str, "modelo": str,
        "especie_texto": str,
        "tipo_veiculo_inferido": "cavalo"|"carreta"|"truck"|"toco"|"vuc"|"outro",
        "carroceria_texto": str,
        "local_texto": str,
        "proprietario_nome": str, "proprietario_documento": str,
        "tara": num, "capacidade_carga": num, "eixos": num
      }

      ONDE PROCURAR no CRLV:
      - "placa", "renavam", "chassi": ficam no alto do documento. O chassi tem
        17 caracteres. Confira dígito por dígito — são os campos que ninguém
        consegue corrigir depois sem refazer o cadastro.
      - "marca_texto": copie EXATAMENTE como está impresso, inclusive a barra
        e o modelo junto (ex.: "M.BENZ/ATEGO 2426", "VW/24.280 CRM 6X2").
        Não normalize, não expanda a abreviação: quem traduz é outra etapa.
      - "modelo": a parte do campo "MARCA / MODELO / VERSÃO" que vem DEPOIS da
        barra, sem a marca. Em "VW/CONSTELLATION 24.280" o modelo é
        "CONSTELLATION 24.280"; em "M.BENZ/ATEGO 2426" é "ATEGO 2426". É campo
        próprio no cadastro e não pode vir vazio nem repetir a marca.
      - "especie_texto": o campo ESPÉCIE/TIPO (ex.: "CAMINHAO TRATOR",
        "SEMI-REBOQUE", "CAMINHAO", "CAMIONETA").
      - "tipo_veiculo_inferido": deduza da espécie e do modelo, usando SÓ um
        destes valores. Guia: "CAMINHAO TRATOR" -> "cavalo"; "SEMI-REBOQUE" ou
        "REBOQUE" -> "carreta"; "CAMINHAO" com 3 ou mais eixos -> "truck";
        "CAMINHAO" de 2 eixos -> "toco"; utilitário/furgão urbano leve ->
        "vuc". Se não der para decidir com segurança, devolva "outro" — é
        melhor o operador escolher do que receber um palpite errado.
      - "carroceria_texto": o tipo de carroceria, quando impresso
        (ex.: "BAU", "GRANELEIRA", "SIDER", "ABERTA", "PORTA CONTAINER").
        Nem todo CRLV traz — devolva null se não houver.
      - "local_texto": o campo "LOCAL", que fica no bloco da DIREITA do CRLV,
        perto da DATA. É o município e a UF onde o veículo está registrado, e
        vem numa linha só, sem vírgula: "VITORIA ES", "SAO PAULO SP",
        "BELO HORIZONTE MG". Copie exatamente como está impresso, com o
        município e a sigla de 2 letras, sem reescrever nem acentuar.
      - "proprietario_nome": o nome de quem consta como PROPRIETÁRIO do veículo,
        rótulo "NOME" ou "PROPRIETÁRIO". Pode ser nome de pessoa ou razão social
        de empresa ("OMNICARGO TRANSPORTES LTDA"). Copie como está impresso.
      - "proprietario_documento": o "CPF/CNPJ" que aparece junto do nome do
        proprietário. Devolva SÓ OS DÍGITOS, sem ponto, barra ou traço — 11
        dígitos se for CPF, 14 se for CNPJ. Não complete nem corte zeros: a
        quantidade de dígitos é o que diz se é pessoa física ou jurídica, e
        errar isso manda o cadastro para o caminho errado. Se não conseguir ler
        com certeza, devolva null em vez de um número incompleto.
      - "tara", "capacidade_carga", "eixos": números, sem unidade nem ponto de
        milhar. Tara e capacidade em QUILOS (o CRLV às vezes traz CMT em
        toneladas — nesse caso não converta, devolva null e deixe o operador
        preencher, em vez de arriscar um fator 1000 errado).

      REGRAS DO CRLV:
      - Todo campo não encontrado é null. Nunca deduza placa, chassi ou renavam.
      - Não devolva markdown, só o JSON.

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
      - "nome_mae" e "nome_pai": a FILIAÇÃO, impressa na CNH sob o rótulo
        "FILIAÇÃO". Vêm um embaixo do outro, normalmente a mãe primeiro — mas
        NÃO confie na ordem: use o nome que fizer sentido (nomes femininos para
        mãe, masculinos para pai) e, na dúvida, devolva na ordem impressa.
        Se só houver um nome, preencha o que estiver identificado e devolva null
        no outro. Não invente o que não está escrito.
      - "numero_rg", "orgao_expedidor_rg" e "uf_rg": o documento de identidade
        aparece na CNH junto do CPF, rotulado "DOC. IDENTIDADE / ORG. EMISSOR /
        UF" ou "CARTEIRA DE IDENTIDADE". Costuma vir tudo numa linha só, por
        exemplo "12345678 SSP RS": separe em número, órgão e a sigla de 2 letras.
        A DATA de emissão do RG normalmente NÃO está na CNH — não a devolva e
        não tente deduzi-la.
      - "naturalidade_municipio" e "naturalidade_uf": o LOCAL DE NASCIMENTO do
        condutor, rótulos "LOCAL DE NASCIMENTO", "NATURALIDADE" ou "NASCIDO EM".
        Costuma aparecer como "CIDADE - UF" ou "CIDADE/UF": separe os dois, o
        município em "naturalidade_municipio" e a sigla de 2 letras em
        "naturalidade_uf". Nem todo modelo de CNH traz isso — se não houver,
        devolva null nos dois, sem chutar a partir do órgão emissor.
      - "uf_emissao_cnh": a sigla de 2 letras da UF do órgão que emitiu a CNH.
        Normalmente dá para tirar do próprio órgão expedidor ("DETRAN-RS" -> "RS")
        ou do local de emissão impresso no documento. SEMPRE preencha este campo
        quando a UF estiver identificável — ele é o que sobra quando a CNH não
        traz naturalidade.

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
