import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

interface RouteResult {
  km: number;
  originNormalized: string;
  destinationNormalized: string;
  estimatedTolls: number;
  error?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getRouteFromGoogle(origin: string, destination: string): Promise<RouteResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
     console.error('GOOGLE_MAPS_API_KEY is missing');
     return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GOOGLE_MAPS_API_KEY_MISSING' };
  }

  try {
    const params = new URLSearchParams({
      origin,
      destination,
      key: GOOGLE_MAPS_API_KEY,
      language: 'pt-BR',
      region: 'br',
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`
    );
    const data = await res.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      console.error('Google Directions API error:', data.status, data.error_message);
      return { 
        km: 0, 
        originNormalized: origin, 
        destinationNormalized: destination, 
        estimatedTolls: 0, 
        error: `GOOGLE_MAPS_ERROR: ${data.status} - ${data.error_message || 'No details'}` 
      };
    }

    const route = data.routes[0];
    const leg = route.legs[0];
    const km = Math.round(leg.distance.value / 1000);
    const originNormalized = leg.start_address || origin;
    const destinationNormalized = leg.end_address || destination;
    const estimatedTolls = Math.round(km * 0.12);

    return {
      km,
      originNormalized: simplifyAddress(originNormalized),
      destinationNormalized: simplifyAddress(destinationNormalized),
      estimatedTolls,
    };
  } catch (err) {
    console.error('Google Directions API fetch error:', err);
    return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GOOGLE_MAPS_FETCH_FAILURE' };
  }
}

function simplifyAddress(addr: string): string {
  const noCountry = addr.replace(/,?\\s*Bra[sz]il$/i, '').trim();
  const noCep = noCountry.replace(/,?\\s*\\d{5}-?\\d{3}/g, '').trim();
  const match = noCep.match(/([^,]+)\\s*[-–]\\s*([A-Z]{2})/i);
  if (match) {
    return `${match[1].trim()}, ${match[2].trim().toUpperCase()}`
  }
  return noCep;
}

async function getRouteFromGemini(origin: string, destination: string, vehicleType: string, axles: number): Promise<RouteResult> {
  if (!GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY is missing, skipping fallback');
    return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GEMINI_API_KEY_MISSING' };
  }

  try {
    const prompt = `Como um especialista em logística, estime a distância rodoviária entre ${origin} e ${destination} para um veículo ${vehicleType} com ${axles || 2} eixos. Retorne APENAS um JSON no formato: {"km": numero, "originNormalized": "Cidade, UF", "destinationNormalized": "Cidade, UF", "estimatedTolls": numero}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanText = text.replace(/```json|```/g, '').trim();
    if (!cleanText) return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: `GEMINI_EMPTY_RESPONSE` };
    return JSON.parse(cleanText);
  } catch (err) {
    console.error('Gemini fallback error:', err);
    return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GEMINI_FETCH_FAILURE' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { origin, destination, vehicleType = 'Truck', axles = 6 } = await req.json();

    if (!origin || !destination) {
      return new Response(
        JSON.stringify({ error: 'Origin and destination are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    console.log(`Calculating route: ${origin} -> ${destination} (${vehicleType})`);

    let result = await getRouteFromGoogle(origin, destination);
    let source = 'google';

    if (!result || result.km === 0) {
      console.warn('Google Maps failed, attempting Gemini fallback...');
      const geminiResult = await getRouteFromGemini(origin, destination, vehicleType, axles);
      if (geminiResult.km > 0) {
        result = geminiResult;
        source = 'gemini';
      } else {
        // Both failed
        return new Response(
          JSON.stringify({ 
            error: result?.error || 'GEOLOCATION_SERVICE_FAILURE',
            details: { google: result?.error, gemini: geminiResult.error }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
    }

    return new Response(
      JSON.stringify({ ...result, source }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
});
