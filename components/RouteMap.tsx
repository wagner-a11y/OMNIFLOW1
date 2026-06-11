import React, { useEffect, useRef, useState } from 'react';

// Carrega o script do Google Maps JS sob demanda (uma única vez). Só a Maps JavaScript API
// (lib geometry, que faz parte dela) — NÃO usa Directions/Geocoding (chave restrita).
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

// Error boundary local: qualquer falha do mapa mostra aviso só nesta área, nunca branqueia a tela.
export class MapErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: any) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(err: any) { console.error('RouteMap error:', err); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="mt-3 w-full h-40 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] flex items-center justify-center">
                    <p className="text-sm font-normal text-[#6b7280]">Não foi possível exibir o mapa. A cotação segue normalmente.</p>
                </div>
            );
        }
        return this.props.children as any;
    }
}

// Desenha a rota a partir dos dados do BACKEND: polyline (codificada) + coords das paradas.
// Cliente só renderiza (Map + Polyline + Marker). Sem DirectionsService (deprecado/bloqueado).
export const RouteMap: React.FC<{ polyline?: string; stops?: { lat: number; lng: number }[] }> = ({ polyline, stops }) => {
    const ref = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const overlaysRef = useRef<any[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
        if (!apiKey) { setError('Chave do Google Maps não configurada neste ambiente (só ativa em produção).'); setLoading(false); return; }
        if (!polyline && (!stops || stops.length === 0)) { setError('Clique em "Recalcular rota" para gerar o trajeto.'); setLoading(false); return; }

        let cancelled = false;
        setLoading(true);
        loadGoogleMaps(apiKey).then((maps) => {
            if (cancelled || !ref.current) return;
            setLoading(false);
            setError('');
            if (!mapRef.current) {
                mapRef.current = new maps.Map(ref.current, {
                    center: { lat: -20.3, lng: -40.3 }, zoom: 6,
                    disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative',
                });
            }
            // Limpa overlays anteriores (redesenho ao mudar a ordem).
            overlaysRef.current.forEach((o) => o.setMap(null));
            overlaysRef.current = [];

            const bounds = new maps.LatLngBounds();

            // Linha da rota (decodifica a polyline do backend com a lib geometry).
            if (polyline) {
                const path = maps.geometry.encoding.decodePath(polyline);
                const line = new maps.Polyline({ path, strokeColor: '#1d6fb8', strokeWeight: 5, strokeOpacity: 0.9, map: mapRef.current });
                overlaysRef.current.push(line);
                path.forEach((p: any) => bounds.extend(p));
            }

            // Marcadores: C (coleta) + 1..N (destinos), nas coords vindas do backend.
            (stops || []).forEach((s, i) => {
                const pos = { lat: s.lat, lng: s.lng };
                const marker = new maps.Marker({
                    position: pos, map: mapRef.current,
                    label: { text: i === 0 ? 'C' : String(i), color: '#fff', fontSize: '11px', fontWeight: '700' },
                    icon: { path: maps.SymbolPath.CIRCLE, scale: 11, fillColor: i === 0 ? '#059669' : '#1d6fb8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
                });
                overlaysRef.current.push(marker);
                bounds.extend(pos);
            });

            if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 48);
        }).catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });

        return () => { cancelled = true; };
    }, [polyline, JSON.stringify(stops)]);

    return (
        <div className="mt-3">
            {error && <p className="text-[11px] font-normal text-red-600 mb-2">{error}</p>}
            <div ref={ref} className="w-full h-72 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] flex items-center justify-center">
                {loading && !error && <span className="text-sm font-normal text-[#6b7280]">Carregando mapa...</span>}
            </div>
        </div>
    );
};
