import React, { useEffect, useRef, useState } from 'react';

// Carrega o script do Google Maps JS sob demanda (uma única vez). Chave só via env.
let mapsPromise: Promise<any> | null = null;
function loadGoogleMaps(apiKey: string): Promise<any> {
    if ((window as any).google?.maps) return Promise.resolve((window as any).google.maps);
    if (mapsPromise) return mapsPromise;
    mapsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&language=pt-BR&region=BR`;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve((window as any).google.maps);
        s.onerror = () => { mapsPromise = null; reject(new Error('Falha ao carregar o Google Maps (verifique a chave/domínio).')); };
        document.head.appendChild(s);
    });
    return mapsPromise;
}

// Desenha a rota: coleta (C) + destinos na ordem (1..N), com a linha do trajeto.
// O mapa SÓ desenha — distância/otimização vêm do backend (calculate-route).
export const RouteMap: React.FC<{ origin: string; destinos: string[] }> = ({ origin, destinos }) => {
    const ref = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const rendererRef = useRef<any>(null);
    const markersRef = useRef<any[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    const stops = destinos.map(d => (d || '').trim()).filter(Boolean);

    useEffect(() => {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
        if (!apiKey) { setError('Chave do Google Maps não configurada neste ambiente (só ativa em produção).'); setLoading(false); return; }
        if (!origin.trim() || stops.length === 0) { setError('Defina a coleta e ao menos um destino.'); setLoading(false); return; }

        let cancelled = false;
        setLoading(true);
        loadGoogleMaps(apiKey).then((maps) => {
            if (cancelled || !ref.current) return;
            if (!mapRef.current) {
                mapRef.current = new maps.Map(ref.current, {
                    center: { lat: -20.3, lng: -40.3 }, zoom: 6,
                    disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
                });
                rendererRef.current = new maps.DirectionsRenderer({
                    map: mapRef.current, suppressMarkers: true,
                    polylineOptions: { strokeColor: '#1d6fb8', strokeWeight: 5, strokeOpacity: 0.9 },
                });
            }
            const svc = new maps.DirectionsService();
            svc.route({
                origin,
                destination: stops[stops.length - 1],
                waypoints: stops.slice(0, -1).map((location) => ({ location, stopover: true })),
                travelMode: maps.TravelMode.DRIVING,
                region: 'br',
            }, (result: any, status: string) => {
                if (cancelled) return;
                setLoading(false);
                if (status !== 'OK' || !result?.routes?.length) { setError('Não foi possível traçar a rota com esses endereços.'); return; }
                setError('');
                rendererRef.current.setDirections(result);
                markersRef.current.forEach((m) => m.setMap(null));
                markersRef.current = [];
                const legs = result.routes[0].legs;
                const makeMarker = (position: any, label: string, color: string) => new maps.Marker({
                    position, map: mapRef.current,
                    label: { text: label, color: '#fff', fontSize: '11px', fontWeight: '700' },
                    icon: { path: maps.SymbolPath.CIRCLE, scale: 11, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
                });
                if (legs.length) {
                    markersRef.current.push(makeMarker(legs[0].start_location, 'C', '#059669')); // coleta
                    legs.forEach((leg: any, i: number) => markersRef.current.push(makeMarker(leg.end_location, String(i + 1), '#1d6fb8')));
                }
            });
        }).catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [origin, JSON.stringify(stops)]);

    return (
        <div className="mt-3">
            {error && <p className="text-[11px] font-normal text-red-600 mb-2">{error}</p>}
            <div ref={ref} className="w-full h-72 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] flex items-center justify-center">
                {loading && !error && <span className="text-sm font-normal text-[#6b7280]">Carregando mapa...</span>}
            </div>
        </div>
    );
};
