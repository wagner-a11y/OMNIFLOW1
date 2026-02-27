import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY") || "");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

Deno.serve(async (req) => {
    try {
        const { fileBase64, fileType } = await req.json();

        const prompt = `
      Você é um especialista em OCR de documentos de transporte brasileiro (CNH e CRLV).
      Analise o documento fornecido e extraia o máximo de informações possíveis.
      Retorne APENAS um objeto JSON válido com as seguintes chaves (use null se não encontrar):
      
      Para CNH (Motorista):
      - nome: Nome completo
      - cpf: CPF (formatado com pontos e traço)
      - rg: Número do RG
      - registro_cnh: Número do registro da CNH
      - codigo_seguranca: Código de segurança da CNH
      - protocolo: Número do protocolo/formulário (geralmente impresso na vertical)
      
      Para CRLV (Veículo):
      - placa: Placa do veículo
      - renavam: Número do RENAVAM
      - chassi: Número do Chassi
      - cor: Cor predominante
      - ano_fab: Ano de fabricação
      - ano_mod: Ano do modelo
      - marca: Marca do fabricante
      - modelo: Modelo do veículo
      
      Importante: Remova espaços extras e retorne apenas o JSON puro.
    `;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: fileBase64,
                    mimeType: fileType,
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();

        // Limpeza básica caso a IA coloque blocos de código markdown
        const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const data = JSON.parse(jsonStr);

        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
