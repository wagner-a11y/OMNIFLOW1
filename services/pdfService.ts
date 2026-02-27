
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FreightCalculation } from '../types';

export const generateHiringPDF = (data: FreightCalculation) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(22);
    doc.setTextColor(44, 62, 80);
    doc.text('FICHA DE CONTRATAÇÃO / GR', pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(127, 140, 141);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, pageWidth / 2, 28, { align: 'center' });
    doc.text(`Proposta: ${data.proposalNumber}`, pageWidth / 2, 33, { align: 'center' });

    // 1. Dados do Motorista
    autoTable(doc, {
        startY: 45,
        head: [['DADOS DO MOTORISTA', '']],
        body: [
            ['Nome Completo', data.motoristaNome || 'N/A'],
            ['CPF', data.motoristaCPF || 'N/A'],
            ['RG', data.motoristaRG || 'N/A'],
            ['Registro CNH', data.motoristaCnhRegistro || 'N/A'],
            ['Protocolo CNH', data.motoristaCnhProtocolo || 'N/A'],
            ['Nº Segurança CNH', data.motoristaCnhSeguranca || 'N/A'],
            ['Telefone', data.motoristaTelefone || 'N/A'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [230, 126, 34], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }
    });

    // 2. Dados do Veículo (Cavalo)
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [['VEÍCULO: CAVALO (TRATOR)', '']],
        body: [
            ['Placa', data.placaCavalo || 'N/A'],
            ['Renavam', data.placaCavaloRenavam || 'N/A'],
            ['Chassi', data.placaCavaloChassi || 'N/A'],
            ['Marca / Modelo', data.placaCavaloMarca || 'N/A'],
            ['Cor / Ano', `${data.placaCavaloCor || 'N/A'} - ${data.placaCavaloAnoFab || ''}/${data.placaCavaloAnoMod || ''}`],
        ],
        theme: 'striped',
        headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }
    });

    // 3. Dados da Carreta 1
    if (data.placaCarreta1) {
        autoTable(doc, {
            startY: (doc as any).lastAutoTable.finalY + 10,
            head: [['IMPLEMENTO: CARRETA 1', '']],
            body: [
                ['Placa', data.placaCarreta1 || 'N/A'],
                ['Renavam', data.placaCarreta1Renavam || 'N/A'],
                ['Chassi', data.placaCarreta1Chassi || 'N/A'],
                ['Marca / Modelo', data.placaCarreta1Marca || 'N/A'],
                ['Cor / Ano', `${data.placaCarreta1Cor || 'N/A'} - ${data.placaCarreta1AnoFab || ''}/${data.placaCarreta1AnoMod || ''}`],
            ],
            theme: 'striped',
            headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }
        });
    }

    // 4. Dados da Carreta 2
    if (data.placaCarreta2) {
        autoTable(doc, {
            startY: (doc as any).lastAutoTable.finalY + 10,
            head: [['IMPLEMENTO: CARRETA 2', '']],
            body: [
                ['Placa', data.placaCarreta2 || 'N/A'],
                ['Renavam', data.placaCarreta2Renavam || 'N/A'],
                ['Chassi', data.placaCarreta2Chassi || 'N/A'],
                ['Marca / Modelo', data.placaCarreta2Marca || 'N/A'],
                ['Cor / Ano', `${data.placaCarreta2Cor || 'N/A'} - ${data.placaCarreta2AnoFab || ''}/${data.placaCarreta2AnoMod || ''}`],
            ],
            theme: 'striped',
            headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 } }
        });
    }

    // Logistic Info
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['INFORMAÇÕES DA VIAGEM', '']],
        body: [
            ['Origem', data.origin],
            ['Destino', data.destination],
            ['Material', data.materialTipo || 'N/A'],
            ['Valor da Carga', `R$ ${data.valorCarga?.toLocaleString('pt-BR') || '0,00'}`],
        ],
        theme: 'plain',
        headStyles: { fillColor: [241, 196, 15], textColor: 0, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 2 },
    });

    // Footer
    const finalY = (doc as any).lastAutoTable.finalY + 30;
    doc.line(20, finalY, pageWidth - 20, finalY);
    doc.setFontSize(8);
    doc.text('Assinatura do Motorista', 40, finalY + 5);
    doc.text('Assinatura do Responsável', pageWidth - 80, finalY + 5);

    doc.save(`Contratacao_${data.proposalNumber}_${data.motoristaNome?.replace(/\s+/g, '_')}.pdf`);
};
