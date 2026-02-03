
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");

export const estimateDistance = async (origin: string, destination: string, vehicleType: string, axles?: number) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Como um especialista em logística, estime a distância rodoviária entre ${origin} e ${destination} para um veículo ${vehicleType} com ${axles || 2} eixos. 
  Retorne APENAS um JSON no formato: {"km": numero, "originNormalized": "Cidade, UF", "destinationNormalized": "Cidade, UF", "estimatedTolls": numero}`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const cleanText = text.replace(/```json|```/g, "").trim();
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("Gemini Error:", error);
        return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0 };
    }
};
