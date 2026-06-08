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

// Soma as parcelas de pedágio (Money repetido) retornadas pela Routes API, preferindo BRL.
function sumTollPrice(tollInfo: any): number {
  const prices = tollInfo?.estimatedPrice;
  if (!Array.isArray(prices) || prices.length === 0) return 0;
  const pick = prices.find((p: any) => p.currencyCode === 'BRL') || prices[0];
  const units = Number(pick.units || 0);
  const nanos = Number(pick.nanos || 0);
  return units + nanos / 1e9;
}

async function getRouteFromGoogle(origin: string, destination: string, axles: number): Promise<RouteResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
     console.error('GOOGLE_MAPS_API_KEY is missing');
     return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GOOGLE_MAPS_API_KEY_MISSING' };
  }

  try {
    // Routes API v2 (computeRoutes) com cálculo de pedágio (extraComputations: TOLLS).
    const body = {
      origin: { address: origin },
      destination: { address: destination },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      extraComputations: ['TOLLS'],
      routeModifiers: {
        // A Routes API não recebe nº de eixos; emissionType ajuda na estimativa de pedágio.
        vehicleInfo: { emissionType: 'DIESEL' },
      },
      languageCode: 'pt-BR',
      regionCode: 'BR',
      units: 'METRIC',
    };

    const res = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.travelAdvisory.tollInfo,routes.legs.travelAdvisory.tollInfo',
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.routes?.length) {
      const msg = data?.error?.message || data?.error?.status || `HTTP ${res.status}`;
      console.error('Google Routes API error:', msg);
      return {
        km: 0,
        originNormalized: origin,
        destinationNormalized: destination,
        estimatedTolls: 0,
        error: `GOOGLE_ROUTES_ERROR: ${msg}`,
      };
    }

    const route = data.routes[0];
    const km = Math.round((route.distanceMeters || 0) / 1000);

    // A Routes API estima o pedágio para um veículo padrão (2 eixos). No Brasil o pedágio
    // é cobrado por eixo, então escalamos pela razão (eixos / 2). Sem dado de pedágio do
    // Google, caímos numa heurística por km também proporcional aos eixos.
    const axleFactor = axles && axles > 0 ? axles / 2 : 1;
    const baseToll = sumTollPrice(route.travelAdvisory?.tollInfo);
    const estimatedTolls = baseToll > 0
      ? Math.round(baseToll * axleFactor)
      : Math.round(km * 0.06 * (axles || 2));

    return {
      km,
      originNormalized: simplifyAddress(origin),
      destinationNormalized: simplifyAddress(destination),
      estimatedTolls,
    };
  } catch (err) {
    console.error('Google Routes API fetch error:', err);
    return { km: 0, originNormalized: origin, destinationNormalized: destination, estimatedTolls: 0, error: 'GOOGLE_ROUTES_FETCH_FAILURE' };
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

    let result = await getRouteFromGoogle(origin, destination, axles);
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
