// Testa definirValorManualFast — o "A pagar" digitado à mão na prévia do Fast.
//
// COMO RODAR (o --define é obrigatório: este service importa o supabase, que lê
// import.meta.env, e sem isso o import estoura antes do primeiro teste):
//   npx esbuild services/fastDelivery.valorManual.test.mjs --bundle --platform=node \
//     --format=esm --outfile=/tmp/t.mjs \
//     --define:import.meta.env='{"VITE_SUPABASE_URL":"https://x.supabase.co","VITE_SUPABASE_ANON_KEY":"k"}'
//   node /tmp/t.mjs
import { definirValorManualFast } from './fastDelivery.ts';

let ok = 0, falhas = 0;
const eq = (nome, achado, esperado) => {
    const a = JSON.stringify(achado), e = JSON.stringify(esperado);
    if (a === e) ok++; else { falhas++; console.error(`FALHOU: ${nome}\n  esperado: ${e}\n  achado:   ${a}`); }
};

/** Linha como a leitura do Excel entrega quando o destino não está na tabela. */
const semPreco = (extras = {}) => ({
    linhaExcel: 7,
    valorRecebido: 1000,
    valorAPagar: null,
    fonteValor: null,
    margem: null,
    margemPercent: null,
    pendencias: [{ motivo: 'destino', texto: 'Destino Xis não está na tabela de preço — informe o valor a pagar à mão.' }],
    ...extras,
});

// ---------- digitar o valor ----------
{
    const l = definirValorManualFast(semPreco(), 800);
    eq('valor aplicado', l.valorAPagar, 800);
    eq('fonte vira manual', l.fonteValor, 'manual');
    eq('margem = recebido - pago', l.margem, 200);
    eq('margem %', l.margemPercent, 20);
    eq('pendência do valor sai', l.pendencias, []);
}

// ---------- apagar devolve a pendência (idempotência) ----------
{
    const comValor = definirValorManualFast(semPreco(), 800);
    const limpa = definirValorManualFast(comValor, null);
    eq('valor limpo', limpa.valorAPagar, null);
    eq('fonte volta a null', limpa.fonteValor, null);
    eq('margem some junto', limpa.margem, null);
    eq('margem % some junto', limpa.margemPercent, null);
    eq('pendência VOLTA', limpa.pendencias.length, 1);
    eq('e é a do valor', limpa.pendencias[0].motivo, 'destino');
}

// ---------- editar duas vezes não duplica pendência ----------
{
    let l = definirValorManualFast(semPreco(), 800);
    l = definirValorManualFast(l, null);
    l = definirValorManualFast(l, 700);
    l = definirValorManualFast(l, null);
    eq('sem pendência duplicada depois de 4 edições', l.pendencias.length, 1);
    l = definirValorManualFast(l, 700);
    eq('e volta a liberar', l.pendencias, []);
    eq('margem recalculada', l.margem, 300);
}

// ---------- pendência 'veiculo' também é encerrada ----------
{
    const l = definirValorManualFast(
        semPreco({ pendencias: [{ motivo: 'veiculo', texto: 'Xis não tem preço para Truck — informe o valor a pagar à mão.' }] }),
        800,
    );
    eq("'veiculo' sai igual a 'destino'", l.pendencias, []);
}

// ---------- o que NÃO pode ser encerrado por digitar valor ----------
{
    const l = definirValorManualFast(
        semPreco({ pendencias: [
            { motivo: 'destino', texto: 'sem preço' },
            { motivo: 'equipamento', texto: 'Equipamento 123 não reconhecido — classifique antes de cotar.' },
        ] }),
        800,
    );
    eq('equipamento CONTINUA pendente', l.pendencias.map(p => p.motivo), ['equipamento']);
}
{
    // 'valor' no Fast = sem Custo Frete na planilha (o RECEBIDO). Sem recebido
    // não há margem, e a linha não pode ser liberada por digitar o a pagar.
    const l = definirValorManualFast(
        semPreco({ valorRecebido: null, pendencias: [
            { motivo: 'destino', texto: 'sem preço' },
            { motivo: 'valor', texto: 'Sem "Custo Frete" na planilha — não dá para calcular margem.' },
        ] }),
        800,
    );
    eq('recebido ausente CONTINUA pendente', l.pendencias.map(p => p.motivo), ['valor']);
    eq('e a margem segue nula', l.margem, null);
}

// ---------- bordas numéricas ----------
{
    eq('zero é valor, não ausência', definirValorManualFast(semPreco(), 0).valorAPagar, 0);
    eq('zero libera a linha', definirValorManualFast(semPreco(), 0).pendencias, []);
    eq('margem com zero', definirValorManualFast(semPreco(), 0).margem, 1000);
    eq('pagar > receber dá margem negativa', definirValorManualFast(semPreco(), 1500).margem, -500);
    eq('recebido zero não divide por zero', definirValorManualFast(semPreco({ valorRecebido: 0 }), 100).margemPercent, null);
}

// ---------- não estraga o resto da linha ----------
{
    const antes = semPreco({ referencia: 'DT-123', tipoVeiculo: 'Truck' });
    const depois = definirValorManualFast(antes, 800);
    eq('referência preservada', depois.referencia, 'DT-123');
    eq('veículo preservado', depois.tipoVeiculo, 'Truck');
    eq('não muta a linha original', antes.valorAPagar, null);
}

console.log(`${ok} ok, ${falhas} falhas`);
process.exit(falhas === 0 ? 0 : 1);
