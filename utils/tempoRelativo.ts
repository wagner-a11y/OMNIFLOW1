/**
 * "há quanto tempo", em português curto, para marcas de atualização na tela.
 *
 * Serve à pergunta "o robô está de pé?": o que importa é a ordem de grandeza
 * ("há 2 min" x "há 5 h"), não o timestamp exato — esse fica no title.
 *
 * `agora` é parâmetro para o teste não depender do relógio da máquina.
 */
export const haQuantoTempo = (iso?: string | null, agora: number = Date.now()): string => {
    if (!iso) return 'nunca';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return 'nunca';

    const seg = Math.floor((agora - t) / 1000);
    // Relógio do servidor adiantado em alguns segundos não vira "há -3 s".
    if (seg < 60) return 'agora há pouco';

    const min = Math.floor(seg / 60);
    if (min < 60) return `há ${min} min`;

    const horas = Math.floor(min / 60);
    if (horas < 24) return horas === 1 ? 'há 1 h' : `há ${horas} h`;

    const dias = Math.floor(horas / 24);
    return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
};
