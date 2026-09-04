import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, getDoc, writeBatch,
} from 'firebase/firestore';

/* Conexão. As chaves ficam em firebase-config.js, fora daqui,
   para este arquivo poder ser trocado sem mexer na configuração. */
const fbApp = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(fbApp);
/* O cache local faz o app continuar funcionando se a internet cair no
   meio da live: as gravações ficam na fila e sobem quando voltar. */
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const colClientes = collection(db, 'clientes');
const colVendas = collection(db, 'vendas');
const colFotos = collection(db, 'fotos');
const docConfig = doc(db, 'config', 'geral');

const novoId = (col) => doc(col).id;
const semId = (o) => {
  const { id, ...resto } = o;
  return resto;
};

/* ── tokens ─────────────────────────────────────────────── */
const t = {
  bg: '#FAF5F3',
  surface: '#FFFFFF',
  ink: '#2B1C28',
  inkSoft: '#7A6874',
  inkFaint: '#A89AA3',
  line: '#EBDFDA',
  rose: '#BE1450',
  roseSoft: '#FBE8EF',
  green: '#12695A',
  greenSoft: '#E2F0EC',
  amber: '#9C5B08',
  amberSoft: '#FAEEDB',
};

const sans = '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const display = '"Fraunces", Georgia, serif';

/* ── helpers ────────────────────────────────────────────── */
const norm = (s) =>
  (s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const brl = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
};

const shiftKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
};

const dateLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const s = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const parseMoney = (s) => {
  const clean = String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* Encontra a cliente pelo id, ou pelo nome já cadastrado.
   Se não existir, devolve uma ficha nova para ser gravada. */
function resolverCliente(clientes, clienteId, nome) {
  if (clienteId) return { id: clienteId, nova: null };
  const existente = clientes.find((c) => norm(c.nome) === norm(nome));
  if (existente) return { id: existente.id, nova: null };
  const id = novoId(colClientes);
  return {
    id,
    nova: {
      id,
      nome: (nome || '').trim(),
      whatsapp: '',
      preExistente: false,
      criadaEm: todayKey(),
    },
  };
}

const ABERTURA_PADRAO = `Bom dia gata🌸
Tudo bem ?
Gratidão pela compra 🙏🏼
Que Deus em sua infinita bondade, te abençoe sempre .
A live foi incrível e você arrasou nas escolhas , gratidão por sua presença.
Arrase muito com suas peças ✨
Segue abaixo peças e valores referente a compra na live {data} ♻️`;

const FECHAMENTO_PADRAO = `PIX BRECHÓ
Tipo de Chave: Telefone
➡️ Chave: 47 99791-9934
➡️ Banco: Stone
➡️ Simone Dutra dos Reis

*Lembrete*
Você tem a opção de pagar em cartão de crédito à vista ou parcelado , em até *3*x sem acréscimo , compras acima de $120,00 .
Acima de 3 parcelas - acréscimo da operadora ( varia pela quantidade de parcela ) .

Beijo 🍀♥️😘`;

const CONFIG_PADRAO = { abertura: ABERTURA_PADRAO, fechamento: FECHAMENTO_PADRAO };

const preencher = (txt, vals) =>
  String(txt || '').replace(/\{(\w+)\}/g, (m, k) => (vals[k] !== undefined ? vals[k] : m));


/* Cada foto fica guardada na própria chave, separada do resto.
   Se ficassem juntas com as vendas, o registro do dia inteiro
   estouraria o limite de tamanho depois de umas poucas peças. */
function comprimirImagem(file, lado = 720, qualidade = 0.62) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não deu para ler a imagem'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo não é uma imagem'));
      img.onload = () => {
        try {
          const escala = Math.min(1, lado / Math.max(img.width, img.height));
          const l = Math.round(img.width * escala);
          const a = Math.round(img.height * escala);
          const tela = document.createElement('canvas');
          tela.width = l;
          tela.height = a;
          tela.getContext('2d').drawImage(img, 0, 0, l, a);
          resolve(tela.toDataURL('image/jpeg', qualidade));
        } catch (e) {
          reject(e);
        }
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(file);
  });
}

/* Resumo de um dia. Fica solto aqui porque a tela da Live e o
   calendário precisam exatamente da mesma conta. */
function calcResumo(vendas, clientes, dia) {
  const doDia = vendas.filter((v) => v.data === dia);
  const mapa = {};
  clientes.forEach((c) => (mapa[c.id] = c));
  const ids = [...new Set(doDia.map((v) => v.clienteId))];
  return {
    total: doDia.reduce((s, v) => s + v.valor, 0),
    pendente: doDia.filter((v) => !v.pago).reduce((s, v) => s + v.valor, 0),
    pecas: doDia.length,
    clientes: ids.length,
    novas: ids.filter((id) => {
      const c = mapa[id];
      return c && !c.preExistente && c.primeiraCompra === dia;
    }).length,
  };
}

const dataCurta = (k) => {
  const [y, m, d] = k.split('-');
  return `${d}/${m}/${y}`;
};

const arquivoNome = (s) =>
  norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exportacao';

const itemLinha = (v, comCodigo) =>
  `• ${v.peca}${comCodigo && v.codigo ? ` (${v.codigo})` : ''} — ${brl(v.valor)}`;

/* Planilha com ponto-e-vírgula e vírgula decimal, que é o que o
   Excel em português abre direto sem pedir configuração. */
function csvVendas(vendas, clientes) {
  const mapa = {};
  clientes.forEach((c) => (mapa[c.id] = c));
  const esc = (x) => `"${String(x === undefined || x === null ? '' : x).replace(/"/g, '""')}"`;
  const linhas = [['Data', 'Cliente', 'Codigo', 'Peca', 'Valor', 'Situacao'].join(';')];
  [...vendas]
    .sort((a, b) => a.data.localeCompare(b.data) || a.criadaEm - b.criadaEm)
    .forEach((v) => {
      const c = mapa[v.clienteId] || {};
      linhas.push(
        [
          esc(dataCurta(v.data)),
          esc(c.nome || ''),
          esc(v.codigo),
          esc(v.peca),
          esc(v.valor.toFixed(2).replace('.', ',')),
          esc(v.pago ? 'Pago' : 'Pendente'),
        ].join(';')
      );
    });
  return linhas.join('\r\n');
}

/* Gerador da planilha da live, escrito na mão.
   A biblioteca de planilhas disponível aqui não escreve borda,
   negrito nem centralização, então o arquivo é montado direto:
   o XML da planilha e o ZIP que o embrulha. O desenho segue a
   planilha já usada no brechó: oito clientes por faixa, cada uma
   numa caixa de duas colunas com o valor a pagar embaixo. */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const bytesDe = (txt) => new TextEncoder().encode(txt);

function zipar(arquivos) {
  const partes = [];
  const central = [];
  let deslocamento = 0;

  arquivos.forEach((a) => {
    const nome = bytesDe(a.nome);
    const crc = crc32(a.dados);
    const local = new Uint8Array(30 + nome.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, a.dados.length, true);
    dv.setUint32(22, a.dados.length, true);
    dv.setUint16(26, nome.length, true);
    local.set(nome, 30);
    partes.push(local, a.dados);

    const c = new Uint8Array(46 + nome.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, a.dados.length, true);
    cv.setUint32(24, a.dados.length, true);
    cv.setUint16(28, nome.length, true);
    cv.setUint32(42, deslocamento, true);
    c.set(nome, 46);
    central.push(c);

    deslocamento += local.length + a.dados.length;
  });

  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fim = new Uint8Array(22);
  const fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, arquivos.length, true);
  fv.setUint16(10, arquivos.length, true);
  fv.setUint32(12, tamCentral, true);
  fv.setUint32(16, deslocamento, true);

  const total = [...partes, ...central, fim];
  const tamanho = total.reduce((s, x) => s + x.length, 0);
  const saida = new Uint8Array(tamanho);
  let p = 0;
  total.forEach((x) => {
    saida.set(x, p);
    p += x.length;
  });
  return saida;
}

const escapar = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const letraColuna = (n) => {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/* Catálogo de estilos: bordas e formatos são criados sob demanda
   e reaproveitados, para o styles.xml não crescer à toa. */
function criarEstilos() {
  const bordas = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const chavesBorda = { '': 0 };
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const chavesXf = { '0|0|0|0' : 0 };

  const borda = (l, r, t, b) => {
    const chave = `${l ? 1 : 0}${r ? 1 : 0}${t ? 1 : 0}${b ? 1 : 0}`;
    if (chave === '0000') return 0;
    if (chavesBorda[chave] !== undefined) return chavesBorda[chave];
    const lado = (nome, tem) =>
      tem ? `<${nome} style="medium"><color rgb="FF000000"/></${nome}>` : `<${nome}/>`;
    bordas.push(
      `<border>${lado('left', l)}${lado('right', r)}${lado('top', t)}${lado('bottom', b)}<diagonal/></border>`
    );
    chavesBorda[chave] = bordas.length - 1;
    return bordas.length - 1;
  };

  // fontId: 0 normal, 1 negrito · numFmtId: 0 texto, 164 moeda · alinhamento: 0 nenhum, 1 centro
  const xf = (fonte, formato, idBorda, centro) => {
    const chave = `${fonte}|${formato}|${idBorda}|${centro}`;
    if (chavesXf[chave] !== undefined) return chavesXf[chave];
    const alinha = centro ? '<alignment horizontal="center" vertical="center"/>' : '';
    xfs.push(
      `<xf numFmtId="${formato}" fontId="${fonte}" fillId="0" borderId="${idBorda}" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"${centro ? ' applyAlignment="1"' : ''}>${alinha}</xf>`
    );
    chavesXf[chave] = xfs.length - 1;
    return xfs.length - 1;
  };

  const xml = () =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="_-&quot;R$&quot;\\ * #,##0.00_-;\\-&quot;R$&quot;\\ * #,##0.00_-;_-&quot;R$&quot;\\ * &quot;-&quot;??_-;_-@_-"/></numFmts>` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="${bordas.length}">${bordas.join('')}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  return { borda, xf, xml };
}

const COLUNAS_BLOCO = [0, 3, 6, 9, 12, 15, 18, 21];
const LINHAS_ENTRE_FAIXAS = 3;

function planilhaDoDia(grupos, nomeAba) {
  const est = criarEstilos();
  const celulas = {}; // "linha,coluna" -> xml da célula
  let ultimaLinha = 0;
  let ultimaColuna = 0;

  const por = (r, c, conteudo) => {
    celulas[`${r},${c}`] = conteudo;
    if (r > ultimaLinha) ultimaLinha = r;
    if (c > ultimaColuna) ultimaColuna = c;
  };

  const texto = (r, c, valor, estilo) =>
    por(r, c, `<c r="${letraColuna(c)}${r + 1}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`);
  const numero = (r, c, valor, estilo) =>
    por(r, c, `<c r="${letraColuna(c)}${r + 1}" s="${estilo}"><v>${valor}</v></c>`);
  const formula = (r, c, f, valor, estilo) =>
    por(r, c, `<c r="${letraColuna(c)}${r + 1}" s="${estilo}"><f>${escapar(f)}</f><v>${valor}</v></c>`);
  const vazia = (r, c, estilo) =>
    por(r, c, `<c r="${letraColuna(c)}${r + 1}" s="${estilo}"/>`);

  const emOrdem = [...grupos].reverse();
  let linhaBase = 0;

  for (let i = 0; i < emOrdem.length; i += COLUNAS_BLOCO.length) {
    const faixa = emOrdem.slice(i, i + COLUNAS_BLOCO.length);
    let altura = 0;

    faixa.forEach((g, j) => {
      const c = COLUNAS_BLOCO[j];
      const itens = [...g.vendas].reverse();
      const linhaNome = linhaBase;
      const temPago = itens.some((v) => v.pago);
      const tudoPago = itens.length > 0 && itens.every((v) => v.pago);

      // a caixa só ganha a terceira coluna quando existe PG para caber dentro
      const colFim = temPago ? c + 2 : c + 1;
      // com tudo pago não há linha de fecho: a caixa termina na última peça
      const linhaFim = tudoPago ? linhaNome + itens.length : linhaNome + itens.length + 1;

      // nome da cliente: negrito, centralizado, topo da caixa
      texto(linhaNome, c, (g.cliente.nome || '').toUpperCase(), est.xf(1, 0, est.borda(1, colFim === c, 1, 0), 1));
      for (let col = c + 1; col <= colFim; col++) {
        vazia(linhaNome, col, est.xf(1, 0, est.borda(0, col === colFim, 1, 0), 0));
      }

      itens.forEach((v, k) => {
        const r = linhaNome + 1 + k;
        const base = tudoPago && k === itens.length - 1 ? 1 : 0;
        texto(r, c, (v.peca || '').toUpperCase(), est.xf(0, 0, est.borda(1, 0, 0, base), 1));
        numero(r, c + 1, v.valor, est.xf(0, 164, est.borda(0, colFim === c + 1, 0, base), 0));
        if (colFim === c + 2) {
          const estilo = est.xf(1, 0, est.borda(0, 1, 0, base), 1);
          if (v.pago) texto(r, c + 2, 'PG', estilo);
          else vazia(r, c + 2, estilo);
        }
      });

      if (!tudoPago) {
        const colValor = letraColuna(c + 1);
        const colPago = letraColuna(c + 2);
        const primeira = linhaNome + 2;
        const ultima = linhaFim;
        const soma = itens.reduce((s, v) => s + v.valor, 0);
        const aPagar = itens.filter((v) => !v.pago).reduce((s, v) => s + v.valor, 0);

        // sem nada pago o fecho é só o número, sem rótulo, como na planilha usada hoje
        let rotulo = '';
        let f = `SUM(${colValor}${primeira}:${colValor}${ultima})`;
        let valor = soma;
        if (temPago) {
          rotulo = 'A PAGAR';
          f = `SUMIF(${colPago}${primeira}:${colPago}${ultima},"",${colValor}${primeira}:${colValor}${ultima})`;
          valor = aPagar;
        }
        texto(linhaFim, c, rotulo, est.xf(1, 0, est.borda(1, colFim === c, 0, 1), 1));
        formula(linhaFim, c + 1, f, Math.round(valor * 100) / 100, est.xf(1, 164, est.borda(0, colFim === c + 1, 0, 1), 0));
        if (colFim === c + 2) vazia(linhaFim, c + 2, est.xf(1, 0, est.borda(0, 1, 0, 1), 0));
      }

      altura = Math.max(altura, linhaFim - linhaBase + 1);
    });

    linhaBase += altura + LINHAS_ENTRE_FAIXAS;
  }

  // monta as linhas do XML
  const porLinha = {};
  Object.keys(celulas).forEach((k) => {
    const [r, c] = k.split(',').map(Number);
    if (!porLinha[r]) porLinha[r] = [];
    porLinha[r].push([c, celulas[k]]);
  });
  const linhasXml = Object.keys(porLinha)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r) => {
      const cs = porLinha[r].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('');
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join('');

  const colunasXml = Array.from({ length: 24 }, (_, n) => {
    const dentro = n % 3;
    const largura = dentro === 0 ? 32 : dentro === 1 ? 13 : 4;
    return `<col min="${n + 1}" max="${n + 1}" width="${largura}" customWidth="1"/>`;
  }).join('');

  const ref = `A1:${letraColuna(Math.max(ultimaColuna, 23))}${Math.max(ultimaLinha, 0) + 1}`;
  const folha =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${ref}"/>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${colunasXml}</cols>` +
    `<sheetData>${linhasXml}</sheetData>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;

  const arquivos = [
    {
      nome: '[Content_Types].xml',
      dados: bytesDe(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          `</Types>`
      ),
    },
    {
      nome: '_rels/.rels',
      dados: bytesDe(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`
      ),
    },
    {
      nome: 'xl/workbook.xml',
      dados: bytesDe(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${escapar(nomeAba)}" sheetId="1" r:id="rId1"/></sheets>` +
          `<calcPr fullCalcOnLoad="1"/>` +
          `</workbook>`
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: bytesDe(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`
      ),
    },
    { nome: 'xl/styles.xml', dados: bytesDe(est.xml()) },
    { nome: 'xl/worksheets/sheet1.xml', dados: bytesDe(folha) },
  ];

  return zipar(arquivos);
}


/* ── app ────────────────────────────────────────────────── */
export default function Root() {
  return (
    <Barreira>
      <App />
    </Barreira>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [usuario, setUsuario] = useState(null);
  const [clientesRaw, setClientesRaw] = useState([]);
  const [vendas, setVendas] = useState([]);
  const [config, setConfig] = useState(CONFIG_PADRAO);
  const [tab, setTab] = useState('hoje');
  const [dia, setDia] = useState(todayKey());
  const [sheet, setSheet] = useState(null); // null | {mode:'new'} | {mode:'edit', venda}
  const [backup, setBackup] = useState(null);
  const [exportar, setExportar] = useState(null);
  const [msg, setMsg] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (texto) => {
    setToast(texto);
    setTimeout(() => setToast(''), 2200);
  };

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUsuario(u);
    setReady(true);
  }), []);

  /* Enquanto alguém estiver logada, o app fica ouvindo o banco.
     Qualquer mudança feita por outra pessoa da equipe aparece
     na tela sozinha, sem ninguém precisar atualizar nada. */
  useEffect(() => {
    if (!usuario) return undefined;
    const erro = (e) => flash('Sem conexão com o banco agora');
    const a = onSnapshot(
      colClientes,
      (s) => setClientesRaw(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      erro
    );
    const b = onSnapshot(
      colVendas,
      (s) => setVendas(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      erro
    );
    const c = onSnapshot(
      docConfig,
      (s) => setConfig({ ...CONFIG_PADRAO, ...(s.data() || {}) }),
      erro
    );
    return () => {
      a();
      b();
      c();
    };
  }, [usuario]);

  /* A primeira compra de cada cliente é sempre calculada a partir das
     vendas, nunca guardada solta. Assim editar, excluir ou passar peça
     para a fila corrige a marcação nova/antiga sozinho. */
  const data = useMemo(() => {
    const primeira = {};
    vendas.forEach((v) => {
      if (!primeira[v.clienteId] || v.data < primeira[v.clienteId]) primeira[v.clienteId] = v.data;
    });
    return {
      clientes: clientesRaw.map((c) => ({ ...c, primeiraCompra: primeira[c.id] || null })),
      vendas,
      config,
    };
  }, [clientesRaw, vendas, config]);

  const avisarErro = (e) => {
    console.error(e);
    flash('Não deu para salvar. Confira a internet.');
  };

  /* derivados do dia */
  const vendasDoDia = useMemo(
    () => data.vendas.filter((v) => v.data === dia),
    [data.vendas, dia]
  );

  const clientePorId = useMemo(() => {
    const m = {};
    data.clientes.forEach((c) => (m[c.id] = c));
    return m;
  }, [data.clientes]);

  const resumo = useMemo(
    () => calcResumo(data.vendas, data.clientes, dia),
    [data.vendas, data.clientes, dia]
  );

  const grupos = useMemo(() => {
    const map = new Map();
    vendasDoDia.forEach((v) => {
      if (!map.has(v.clienteId)) map.set(v.clienteId, []);
      map.get(v.clienteId).push(v);
    });
    return [...map.entries()]
      .map(([id, vs]) => ({
        cliente: clientePorId[id],
        vendas: [...vs].sort((a, b) => b.criadaEm - a.criadaEm),
        total: vs.reduce((s, v) => s + v.valor, 0),
        ultima: Math.max(...vs.map((v) => v.criadaEm)),
      }))
      .sort((a, b) => b.ultima - a.ultima);
  }, [vendasDoDia, clientePorId]);

  /* ações */
  const salvarVenda = async (form, vendaEditada) => {
    const novas = [];
    const lista = [...data.clientes];

    const r = resolverCliente(lista, form.clienteId, form.clienteNome);
    if (r.nova) {
      novas.push(r.nova);
      lista.push(r.nova);
    }

    // Cada pessoa da fila também vira uma cliente de verdade aqui.
    // Sem isso a fila guardaria só um nome solto, e transferir a peça
    // depois poderia criar uma segunda ficha para a mesma pessoa.
    const fila = (form.fila || []).map((f) => {
      const rf = resolverCliente(lista, f.clienteId, f.nome);
      if (rf.nova) {
        novas.push(rf.nova);
        lista.push(rf.nova);
      }
      const c = lista.find((x) => x.id === rf.id);
      return { nome: c ? c.nome : f.nome, clienteId: rf.id };
    });

    const id = vendaEditada ? vendaEditada.id : novoId(colVendas);
    let temFoto = vendaEditada ? !!vendaEditada.temFoto : false;
    if (form.fotoMudou) {
      try {
        if (form.foto) {
          await setDoc(doc(colFotos, id), { imagem: form.foto });
          temFoto = true;
        } else {
          await deleteDoc(doc(colFotos, id));
          temFoto = false;
        }
      } catch (e) {
        flash('A venda foi salva, mas a foto não');
      }
    }

    try {
      const lote = writeBatch(db);
      novas.forEach((c) => lote.set(doc(colClientes, c.id), semId(c)));
      lote.set(doc(colVendas, id), {
        data: vendaEditada ? vendaEditada.data : dia,
        criadaEm: vendaEditada ? vendaEditada.criadaEm : Date.now(),
        clienteId: r.id,
        codigo: form.codigo.trim(),
        peca: form.peca.trim(),
        valor: parseMoney(form.valor),
        pago: form.pago,
        fila,
        temFoto,
      });
      await lote.commit();
    } catch (e) {
      avisarErro(e);
    }
    return r.id;
  };

  const passarFila = async (venda) => {
    const fila = venda.fila || [];
    if (fila.length === 0) return;
    const [proxima, ...resto] = fila;
    const r = resolverCliente(data.clientes, proxima.clienteId, proxima.nome);
    try {
      const lote = writeBatch(db);
      if (r.nova) lote.set(doc(colClientes, r.nova.id), semId(r.nova));
      lote.update(doc(colVendas, venda.id), { clienteId: r.id, fila: resto, pago: false });
      await lote.commit();
      flash(`Peça passou para ${proxima.nome}`);
    } catch (e) {
      avisarErro(e);
    }
  };

  const excluirVenda = async (id) => {
    try {
      const lote = writeBatch(db);
      lote.delete(doc(colVendas, id));
      lote.delete(doc(colFotos, id));
      await lote.commit();
      flash('Peça excluída');
    } catch (e) {
      avisarErro(e);
    }
  };

  const mesclarClientes = async (deId, paraId) => {
    const de = data.clientes.find((c) => c.id === deId);
    const para = data.clientes.find((c) => c.id === paraId);
    if (!de || !para) return;

    try {
      const lote = writeBatch(db);
      data.vendas.forEach((v) => {
        const naFila = (v.fila || []).some((f) => f.clienteId === deId);
        if (v.clienteId !== deId && !naFila) return;

        const fila = [];
        (v.fila || []).forEach((f) => {
          const id = f.clienteId === deId ? paraId : f.clienteId;
          if (fila.some((x) => x.clienteId === id)) return; // a mesma pessoa não fica duas vezes na fila
          fila.push({ nome: id === paraId ? para.nome : f.nome, clienteId: id });
        });
        lote.update(doc(colVendas, v.id), {
          clienteId: v.clienteId === deId ? paraId : v.clienteId,
          fila,
        });
      });

      lote.update(doc(colClientes, paraId), {
        whatsapp: para.whatsapp || de.whatsapp || '',
        preExistente: !!(para.preExistente || de.preExistente),
      });
      lote.delete(doc(colClientes, deId));
      await lote.commit();
      flash(`${de.nome} foi juntada em ${para.nome}`);
    } catch (e) {
      avisarErro(e);
    }
  };

  const togglePago = async (id, pago) => {
    try {
      await updateDoc(doc(colVendas, id), { pago: !pago });
    } catch (e) {
      avisarErro(e);
    }
  };

  const carregarFoto = async (idVenda) => {
    const d = await getDoc(doc(colFotos, idVenda));
    return d.exists() ? d.data().imagem : null;
  };

  /* exportações */
  const exportarCliente = (g) => {
    const c = g.cliente;
    const cfg = data.config || CONFIG_PADRAO;

    // desta live
    const ordem = [...g.vendas].reverse();
    const pagoDia = ordem.filter((v) => v.pago).reduce((s, v) => s + v.valor, 0);
    const vals = {
      nome: c.nome,
      data: dataCurta(dia),
      total: brl(g.total),
      apagar: brl(g.total - pagoDia),
    };
    const corpo =
      ordem.map((v) => itemLinha(v, false)).join('\n') +
      `\n\n*Valor total: ${brl(g.total)}*` +
      `\n*Valor a pagar: ${brl(g.total - pagoDia)}*`;

    const abertura = preencher(cfg.abertura, vals).trim();
    const fechamento = preencher(cfg.fechamento, vals).trim();
    const txtDia = [abertura, corpo, fechamento].filter(Boolean).join('\n\n');

    // histórico dela, live por live
    const todas = data.vendas
      .filter((v) => v.clienteId === c.id)
      .sort((a, b) => a.data.localeCompare(b.data) || a.criadaEm - b.criadaEm);
    const totalGeral = todas.reduce((s, v) => s + v.valor, 0);
    const pagoGeral = todas.filter((v) => v.pago).reduce((s, v) => s + v.valor, 0);
    const porData = [];
    todas.forEach((v) => {
      const bloco = porData.find((b) => b.data === v.data);
      if (bloco) bloco.itens.push(v);
      else porData.push({ data: v.data, itens: [v] });
    });
    let txtTudo = `*Delas pra Elas*\n*${c.nome}* — histórico\n\n`;
    txtTudo += porData
      .map((b) => `${dataCurta(b.data)}\n${b.itens.map((v) => itemLinha(v, false)).join('\n')}`)
      .join('\n\n');
    txtTudo += `\n\n*Valor total: ${brl(totalGeral)}*`;
    txtTudo += `\n*Valor a pagar: ${brl(totalGeral - pagoGeral)}*`;

    setExportar({
      titulo: c.nome,
      whatsapp: c.whatsapp,
      opcoes: [
        {
          rotulo: 'Desta live',
          texto: txtDia,
          csv: csvVendas(g.vendas, data.clientes),
          arquivo: `${arquivoNome(c.nome)}-${dia}.csv`,
        },
        {
          rotulo: 'Histórico dela',
          texto: txtTudo,
          csv: csvVendas(todas, data.clientes),
          arquivo: `${arquivoNome(c.nome)}-historico.csv`,
        },
      ],
    });
  };

  const exportarDia = () => {
    const blocos = [...grupos].reverse().map((g) => {
      const itens = [...g.vendas].reverse().map((v) => `   ${itemLinha(v, true)}`).join('\n');
      const qtd = `${g.vendas.length} ${g.vendas.length === 1 ? 'peça' : 'peças'}`;
      const pago = g.vendas.filter((v) => v.pago).reduce((s, v) => s + v.valor, 0);
      let bloco = `*${g.cliente.nome}* — ${brl(g.total)} (${qtd})\n${itens}`;
      if (g.total - pago > 0) bloco += `\n   A pagar: ${brl(g.total - pago)}`;
      return bloco;
    });
    let txt = `*Delas pra Elas*\nLive de ${dataCurta(dia)}\n\n${blocos.join('\n\n')}`;
    txt += `\n\n──────────\n*Valor total: ${brl(resumo.total)}*`;
    txt += `\n*Valor a pagar: ${brl(resumo.pendente)}*`;
    txt += `\nPeças: ${resumo.pecas}`;
    txt += `\nClientes: ${resumo.clientes}`;
    if (resumo.novas > 0)
      txt += ` (${resumo.novas} ${resumo.novas === 1 ? 'nova' : 'novas'})`;
    setExportar({
      titulo: `Live de ${dataCurta(dia)}`,
      opcoes: [
        {
          rotulo: 'Live do dia',
          texto: txt,
          arquivo: `live-${dia}.xlsx`,
          rotuloArquivo: 'Baixar planilha da live (.xlsx)',
          gerarArquivo: () =>
            new Blob([planilhaDoDia(grupos, dataCurta(dia).replace(/\//g, '-'))], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
        },
      ],
    });
  };

  const exportarTudo = () => {
    const dias = [...new Set(data.vendas.map((v) => v.data))].sort();
    const linhas = dias.map((d) => {
      const r = calcResumo(data.vendas, data.clientes, d);
      let l = `${dataCurta(d)} — ${brl(r.total)} · ${r.pecas} ${r.pecas === 1 ? 'peça' : 'peças'} · ${r.clientes} ${r.clientes === 1 ? 'cliente' : 'clientes'}`;
      if (r.novas > 0) l += ` (${r.novas} ${r.novas === 1 ? 'nova' : 'novas'})`;
      return l;
    });
    const total = data.vendas.reduce((s, v) => s + v.valor, 0);
    const pago = data.vendas.filter((v) => v.pago).reduce((s, v) => s + v.valor, 0);
    let txt = `*Delas pra Elas* — histórico completo\n\n${linhas.join('\n')}`;
    txt += `\n\n──────────\n*Valor total: ${brl(total)}*`;
    txt += `\n*Valor a pagar: ${brl(total - pago)}*`;
    txt += `\nLives: ${dias.length}\nPeças: ${data.vendas.length}`;
    setExportar({
      titulo: 'Histórico completo',
      opcoes: [
        {
          rotulo: 'Tudo',
          texto: txt,
          csv: csvVendas(data.vendas, data.clientes),
          arquivo: 'historico-delas-pra-elas.csv',
        },
      ],
    });
  };

  const salvarCliente = async (c) => {
    try {
      const id = c.id || novoId(colClientes);
      await setDoc(
        doc(colClientes, id),
        {
          nome: c.nome,
          whatsapp: c.whatsapp || '',
          preExistente: !!c.preExistente,
          criadaEm: c.criadaEm || todayKey(),
        },
        { merge: true }
      );
    } catch (e) {
      avisarErro(e);
    }
  };

  const salvarConfig = async (cfg) => {
    try {
      await setDoc(docConfig, cfg, { merge: true });
    } catch (e) {
      avisarErro(e);
    }
  };

  if (!ready)
    return (
      <div style={{ ...S.screen, alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
        <Fonts />
        <span style={{ color: t.inkSoft, fontFamily: sans }}>Abrindo…</span>
      </div>
    );

  if (!usuario) return <Login />;

  return (
    <div style={S.screen}>
      <Fonts />
      <div style={S.frame}>
        <header style={S.header}>
          <div style={S.brandRow}>
            <span style={S.brand}>Delas pra Elas</span>
            <button style={S.linkBtn} onClick={() => signOut(auth)}>
              Sair
            </button>
          </div>
          <div style={S.tabs}>
            <button
              style={{ ...S.tab, ...(tab === 'hoje' ? S.tabOn : {}) }}
              onClick={() => setTab('hoje')}
            >
              Live
            </button>
            <button
              style={{ ...S.tab, ...(tab === 'calendario' ? S.tabOn : {}) }}
              onClick={() => setTab('calendario')}
            >
              Calendário
            </button>
            <button
              style={{ ...S.tab, ...(tab === 'clientes' ? S.tabOn : {}) }}
              onClick={() => setTab('clientes')}
            >
              Clientes
            </button>
          </div>
        </header>

        {tab === 'hoje' ? (
          <>
            <div style={S.dateRow}>
              <button style={S.arrow} onClick={() => setDia(shiftKey(dia, -1))} aria-label="Dia anterior">
                ‹
              </button>
              <div style={{ textAlign: 'center' }}>
                <button style={S.dateTxt} onClick={() => setTab('calendario')}>
                  {dateLabel(dia)}
                </button>
                {dia !== todayKey() && (
                  <button style={S.todayBtn} onClick={() => setDia(todayKey())}>
                    voltar para hoje
                  </button>
                )}
              </div>
              <button
                style={{ ...S.arrow, opacity: dia >= todayKey() ? 0.25 : 1 }}
                disabled={dia >= todayKey()}
                onClick={() => setDia(shiftKey(dia, 1))}
                aria-label="Próximo dia"
              >
                ›
              </button>
            </div>

            <Resumo r={resumo} />

            <main style={S.list}>
              {grupos.length === 0 ? (
                <div style={S.empty}>
                  <p style={S.emptyTitle}>Nenhuma peça lançada neste dia.</p>
                  <p style={S.emptyTxt}>
                    Toque em <strong>Lançar peça</strong> assim que a primeira venda sair.
                  </p>
                </div>
              ) : (
                grupos.map((g) => (
                  <GrupoCliente
                    key={g.cliente?.id || 'x'}
                    g={g}
                    dia={dia}
                    onToggle={togglePago}
                    onEdit={(v) => setSheet({ mode: 'edit', venda: v })}
                    onExportar={() => exportarCliente(g)}
                  />
                ))
              )}
              {grupos.length > 0 && (
                <button style={{ ...S.ctaGhost, marginTop: 8 }} onClick={exportarDia}>
                  Exportar relatório do dia
                </button>
              )}
              <div style={{ height: 96 }} />
            </main>

            <div style={S.dock}>
              <button style={S.cta} onClick={() => setSheet({ mode: 'new' })}>
                Lançar peça
              </button>
            </div>
          </>
        ) : tab === 'calendario' ? (
          <Calendario
            data={data}
            dia={dia}
            onEscolher={(d) => {
              setDia(d);
              setTab('hoje');
            }}
          />
        ) : (
          <Clientes
            data={data}
            dia={dia}
            onSave={salvarCliente}
            onFlash={flash}
            onExport={() => setBackup(JSON.stringify(data, null, 2))}
            onExportTudo={exportarTudo}
            onMesclar={mesclarClientes}
            onEditarMensagem={() => setMsg(true)}
          />
        )}
      </div>

      {sheet && (
        <SheetVenda
          mode={sheet.mode}
          venda={sheet.venda}
          clientes={data.clientes}
          vendasDoDia={vendasDoDia}
          dia={dia}
          onClose={() => setSheet(null)}
          onSave={salvarVenda}
          onDelete={excluirVenda}
          onPassar={passarFila}
          onFlash={flash}
          carregarFoto={carregarFoto}
        />
      )}

      {exportar && (
        <SheetExport dados={exportar} onClose={() => setExportar(null)} onFlash={flash} />
      )}

      {msg && (
        <SheetMensagem
          config={data.config || CONFIG_PADRAO}
          onClose={() => setMsg(false)}
          onFlash={flash}
          onSave={salvarConfig}
        />
      )}

      {backup && <SheetBackup texto={backup} onClose={() => setBackup(null)} onFlash={flash} />}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

/* ── fontes ─────────────────────────────────────────────── */
function Fonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Fraunces:opsz,wght@9..144,400;9..144,600&display=swap');
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      button { cursor: pointer; font-family: inherit; }
      input { font-family: inherit; }
      button:focus-visible, input:focus-visible { outline: 2px solid ${t.rose}; outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
    `}</style>
  );
}

/* ── login ──────────────────────────────────────────────── */
const RECADOS = {
  'auth/invalid-credential': 'E-mail ou senha não confere.',
  'auth/invalid-email': 'Esse e-mail não parece válido.',
  'auth/user-not-found': 'Não existe conta com esse e-mail.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/too-many-requests': 'Muitas tentativas. Espere um pouco e tente de novo.',
  'auth/network-request-failed': 'Sem internet. Confira a conexão.',
};

function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    if (!email.trim() || !senha) return setErro('Preencha o e-mail e a senha.');
    setEntrando(true);
    setErro('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch (e) {
      setErro(RECADOS[e.code] || 'Não deu para entrar. Tente de novo.');
      setEntrando(false);
    }
  };

  return (
    <div style={{ ...S.screen, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Fonts />
      <div style={{ width: '100%', maxWidth: 340 }}>
        <div style={{ fontFamily: display, fontSize: 34, lineHeight: 1.1, color: t.ink, marginBottom: 6 }}>
          Delas pra Elas
        </div>
        <p style={{ fontFamily: sans, fontSize: 15, color: t.inkSoft, margin: '0 0 28px' }}>
          Controle de vendas da live.
        </p>
        <label style={S.label}>E-mail</label>
        <input
          style={S.input}
          type="email"
          value={email}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="email"
          onChange={(e) => {
            setEmail(e.target.value);
            setErro('');
          }}
        />
        <label style={{ ...S.label, marginTop: 14 }}>Senha</label>
        <input
          style={S.input}
          type="password"
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setErro('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && entrar()}
        />
        {erro && <p style={{ fontFamily: sans, fontSize: 14, color: t.rose, marginTop: 12 }}>{erro}</p>}
        <button style={{ ...S.cta, marginTop: 22, opacity: entrando ? 0.6 : 1 }} disabled={entrando} onClick={entrar}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </div>
    </div>
  );
}

/* ── resumo do dia ──────────────────────────────────────── */
function Resumo({ r }) {
  return (
    <section style={S.resumo}>
      <div style={S.totalNum}>{brl(r.total)}</div>
      <div style={S.metaRow}>
        <Meta n={r.pecas} l={r.pecas === 1 ? 'peça' : 'peças'} />
        <Meta n={r.clientes} l={r.clientes === 1 ? 'cliente' : 'clientes'} />
        <Meta n={r.novas} l={r.novas === 1 ? 'nova' : 'novas'} destaque />
      </div>
      {r.pendente > 0 && (
        <div style={S.pendBar}>
          <span style={{ fontWeight: 500 }}>{brl(r.pendente)}</span> ainda a receber
        </div>
      )}
    </section>
  );
}

function Meta({ n, l, destaque }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
      <span
        style={{
          fontFamily: display,
          fontSize: 22,
          color: destaque && n > 0 ? t.rose : t.ink,
        }}
      >
        {n}
      </span>
      <span style={{ fontFamily: sans, fontSize: 14, color: t.inkSoft }}>{l}</span>
    </div>
  );
}

/* ── grupo por cliente ──────────────────────────────────── */
function GrupoCliente({ g, dia, onToggle, onEdit, onExportar }) {
  const c = g.cliente;
  if (!c) return null;
  const nova = !c.preExistente && c.primeiraCompra === dia;

  return (
    <article style={S.card}>
      <div style={S.cardHead}>
        <div style={{ minWidth: 0 }}>
          <div style={S.cliNome}>{c.nome}</div>
          <div style={S.cliSub}>
            {g.vendas.length} {g.vendas.length === 1 ? 'peça' : 'peças'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={S.cliTotal}>{brl(g.total)}</div>
          <span style={nova ? S.badgeNova : S.badgeAntiga}>{nova ? 'nova' : 'antiga'}</span>
        </div>
      </div>
      <div>
        {g.vendas.map((v) => (
          <div key={v.id} style={S.row}>
            <button style={S.rowMain} onClick={() => onEdit(v)}>
              <span style={S.codigo}>{v.codigo || '—'}</span>
              <span style={S.peca}>{v.peca}</span>
              {v.temFoto && <span style={S.fotoTag}>foto</span>}
              {(v.fila || []).length > 0 && (
                <span style={S.filaTag}>
                  fila {v.fila.length}
                </span>
              )}
            </button>
            <span style={S.rowValor}>{brl(v.valor)}</span>
            <button
              style={v.pago ? S.chipPago : S.chipPend}
              onClick={() => onToggle(v.id, v.pago)}
              aria-label={v.pago ? 'Marcar como pendente' : 'Marcar como pago'}
            >
              {v.pago ? 'pago' : 'pendente'}
            </button>
          </div>
        ))}
      </div>
      <button style={S.cardExport} onClick={onExportar}>
        Exportar lista dela
      </button>
    </article>
  );
}

/* ── folha de lançamento ────────────────────────────────── */
function SheetVenda({ mode, venda, clientes, vendasDoDia, dia, onClose, onSave, onDelete, onPassar, onFlash, carregarFoto }) {
  const editando = mode === 'edit';
  const [clienteNome, setClienteNome] = useState('');
  const [clienteId, setClienteId] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [peca, setPeca] = useState('');
  const [valor, setValor] = useState('');
  const [pago, setPago] = useState(false);
  const [fila, setFila] = useState([]);
  const [foto, setFoto] = useState(null);
  const [fotoMudou, setFotoMudou] = useState(false);
  const [fotoStatus, setFotoStatus] = useState('');
  const [filaNome, setFilaNome] = useState('');
  const [filaId, setFilaId] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(false);
  const nomeRef = useRef(null);

  useEffect(() => {
    if (editando && venda) {
      const c = clientes.find((x) => x.id === venda.clienteId);
      setClienteNome(c ? c.nome : '');
      setClienteId(venda.clienteId);
      setCodigo(venda.codigo);
      setPeca(venda.peca);
      setValor(String(venda.valor).replace('.', ','));
      setPago(venda.pago);
      setFila(venda.fila || []);
      if (venda.temFoto && carregarFoto) {
        setFotoStatus('carregando');
        carregarFoto(venda.id)
          .then((img) => {
            setFoto(img || null);
            setFotoStatus('');
          })
          .catch(() => setFotoStatus(''));
      }
    } else {
      setTimeout(() => nomeRef.current && nomeRef.current.focus(), 120);
    }
  }, []);

  const filaSugestoes = useMemo(() => {
    const q = norm(filaNome);
    if (!q || filaId) return [];
    return clientes.filter((c) => norm(c.nome).includes(q) && c.id !== clienteId).slice(0, 4);
  }, [filaNome, filaId, clientes, clienteId]);

  const addFila = () => {
    const nome = filaNome.trim();
    if (!nome) return;
    if (norm(nome) === norm(clienteNome)) {
      setErro('Essa já é a cliente principal da peça.');
      return;
    }
    if (fila.some((f) => norm(f.nome) === norm(nome))) {
      setErro(`${nome} já está na fila.`);
      return;
    }
    setFila([...fila, { nome, clienteId: filaId }]);
    setFilaNome('');
    setFilaId(null);
    setErro('');
  };

  const sugestoes = useMemo(() => {
    const q = norm(clienteNome);
    if (!q || clienteId) return [];
    return clientes
      .filter((c) => norm(c.nome).includes(q))
      .slice(0, 5)
      .map((c) => ({
        ...c,
        compras: 0,
      }));
  }, [clienteNome, clienteId, clientes]);

  const exataExiste = clientes.some((c) => norm(c.nome) === norm(clienteNome));

  const salvar = async () => {
    if (!clienteNome.trim()) return setErro('Falta o nome da cliente.');
    if (!peca.trim()) return setErro('Falta o nome da peça.');
    if (parseMoney(valor) <= 0) return setErro('Falta o valor da peça.');

    const cod = codigo.trim();
    if (cod) {
      const conflito = vendasDoDia.find(
        (v) => norm(v.codigo) === norm(cod) && (!editando || v.id !== venda.id)
      );
      if (conflito) {
        return setErro(`O código ${cod} já foi usado hoje em "${conflito.peca}".`);
      }
    }

    await onSave(
      { clienteId, clienteNome, codigo, peca, valor, pago, fila, foto, fotoMudou },
      editando ? venda : null
    );
    onFlash(editando ? 'Peça atualizada' : 'Peça lançada');
    onClose();
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>{editando ? 'Editar peça' : 'Lançar peça'}</span>
          <button style={S.linkBtn} onClick={onClose}>
            Fechar
          </button>
        </div>

        <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
          {editando && (venda.fila || []).length > 0 && (
            <div style={S.passaBox}>
              <div style={S.passaTxt}>
                {venda.fila.length === 1
                  ? `${venda.fila[0].nome} está esperando essa peça.`
                  : `${venda.fila.length} clientes esperando. A primeira é ${venda.fila[0].nome}.`}
              </div>
              <button
                style={S.passaBtn}
                onClick={() => {
                  onPassar(venda);
                  onClose();
                }}
              >
                Passar para {venda.fila[0].nome}
              </button>
            </div>
          )}

          <label style={S.label}>Cliente</label>
          <div style={{ position: 'relative' }}>
            <input
              ref={nomeRef}
              style={S.input}
              value={clienteNome}
              placeholder="Comece a digitar o nome"
              onChange={(e) => {
                setClienteNome(e.target.value);
                setClienteId(null);
                setErro('');
                setAberto(true);
              }}
              onFocus={() => setAberto(true)}
            />
            {clienteId && <span style={S.okMark}>✓</span>}
          </div>

          {aberto && sugestoes.length > 0 && (
            <div style={S.sugBox}>
              {sugestoes.map((c) => (
                <button
                  key={c.id}
                  style={S.sugItem}
                  onClick={() => {
                    setClienteNome(c.nome);
                    setClienteId(c.id);
                    setAberto(false);
                  }}
                >
                  <span>{c.nome}</span>
                  <span style={{ color: t.inkFaint, fontSize: 13 }}>já cadastrada</span>
                </button>
              ))}
            </div>
          )}

          {clienteNome.trim() && !clienteId && !exataExiste && (
            <p style={S.hintNova}>
              Ninguém com esse nome no cadastro. Vai entrar como cliente nova.
            </p>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <div style={{ width: 96, flexShrink: 0 }}>
              <label style={S.label}>Código</label>
              <input
                style={S.input}
                value={codigo}
                inputMode="numeric"
                placeholder="12"
                onChange={(e) => { setCodigo(e.target.value); setErro(''); }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={S.label}>Peça</label>
              <input
                style={S.input}
                value={peca}
                placeholder="Blusa jeans"
                onChange={(e) => { setPeca(e.target.value); setErro(''); }}
              />
            </div>
          </div>

          <label style={{ ...S.label, marginTop: 16 }}>Valor</label>
          <input
            style={{ ...S.input, fontFamily: display, fontSize: 20 }}
            value={valor}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => { setValor(e.target.value); setErro(''); }}
          />

          <label style={{ ...S.label, marginTop: 16 }}>Pagamento</label>
          <div style={S.segmento}>
            <button
              style={{ ...S.segBtn, ...(!pago ? S.segOnPend : {}) }}
              onClick={() => setPago(false)}
            >
              Pendente
            </button>
            <button
              style={{ ...S.segBtn, ...(pago ? S.segOnPago : {}) }}
              onClick={() => setPago(true)}
            >
              Pago
            </button>
          </div>

          <label style={{ ...S.label, marginTop: 18 }}>
            Foto da peça <span style={{ color: t.inkFaint }}>· opcional</span>
          </label>

          {fotoStatus === 'carregando' ? (
            <div style={S.fotoVazia}>Abrindo a foto…</div>
          ) : foto ? (
            <div>
              <img src={foto} alt={peca || 'Peça'} style={S.fotoImg} />
              <button
                style={{ ...S.ctaGhost, marginTop: 8 }}
                onClick={() => {
                  setFoto(null);
                  setFotoMudou(true);
                }}
              >
                Remover foto
              </button>
            </div>
          ) : (
            <label style={S.fotoAdd}>
              {fotoStatus === 'comprimindo' ? 'Preparando a foto…' : 'Tirar ou escolher foto'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const arq = e.target.files && e.target.files[0];
                  if (!arq) return;
                  setFotoStatus('comprimindo');
                  try {
                    const menor = await comprimirImagem(arq);
                    setFoto(menor);
                    setFotoMudou(true);
                    setFotoStatus('');
                  } catch (err) {
                    setFotoStatus('');
                    setErro('Não deu para usar essa imagem. Tente outra.');
                  }
                  e.target.value = '';
                }}
              />
            </label>
          )}

          <label style={{ ...S.label, marginTop: 18 }}>
            Fila de espera <span style={{ color: t.inkFaint }}>· opcional</span>
          </label>

          {fila.length > 0 && (
            <div style={S.filaBox}>
              {fila.map((f, i) => (
                <div key={i} style={S.filaItem}>
                  <span style={S.filaPos}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.nome}
                  </span>
                  <button
                    style={S.linkBtn}
                    onClick={() => setFila(fila.filter((_, j) => j !== i))}
                  >
                    Tirar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: fila.length ? 8 : 0 }}>
            <input
              style={{ ...S.input, flex: 1, minWidth: 0 }}
              value={filaNome}
              placeholder="Quem fica esperando"
              onChange={(e) => {
                setFilaNome(e.target.value);
                setFilaId(null);
                setErro('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFila();
                }
              }}
            />
            <button
              style={{ ...S.addFila, opacity: filaNome.trim() ? 1 : 0.4 }}
              disabled={!filaNome.trim()}
              onClick={addFila}
            >
              Entrar na fila
            </button>
          </div>

          {filaSugestoes.length > 0 && (
            <div style={S.sugBox}>
              {filaSugestoes.map((c) => (
                <button
                  key={c.id}
                  style={S.sugItem}
                  onClick={() => {
                    setFilaNome(c.nome);
                    setFilaId(c.id);
                  }}
                >
                  <span>{c.nome}</span>
                  <span style={{ color: t.inkFaint, fontSize: 13 }}>já cadastrada</span>
                </button>
              ))}
            </div>
          )}

          {erro && <p style={S.erro}>{erro}</p>}

          <button style={{ ...S.cta, marginTop: 20 }} onClick={salvar}>
            {editando ? 'Salvar alterações' : 'Salvar'}
          </button>
          {editando && (
            <button
              style={{ ...S.ctaGhost, color: t.rose, borderColor: t.roseSoft }}
              onClick={() => {
                onDelete(venda.id);
                onClose();
              }}
            >
              Excluir peça
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── clientes ───────────────────────────────────────────── */
function Clientes({ data, dia, onSave, onFlash, onExport, onExportTudo, onMesclar, onEditarMensagem }) {
  const [busca, setBusca] = useState('');
  const [escopo, setEscopo] = useState('dia');
  const [form, setForm] = useState(null);

  const vazio = { total: 0, pecas: 0, totalDia: 0, pecasDia: 0, pendenteDia: 0, ultima: '', fila: 0 };

  const enriquecidas = useMemo(() => {
    const st = {};
    const pega = (id) => {
      if (!st[id]) st[id] = { ...vazio };
      return st[id];
    };
    data.vendas.forEach((v) => {
      const s = pega(v.clienteId);
      s.total += v.valor;
      s.pecas += 1;
      if (v.data > s.ultima) s.ultima = v.data;
      if (v.data === dia) {
        s.totalDia += v.valor;
        s.pecasDia += 1;
        if (!v.pago) s.pendenteDia += v.valor;
      }
      (v.fila || []).forEach((f) => {
        if (f.clienteId) pega(f.clienteId).fila += 1;
      });
    });
    const q = norm(busca);
    return data.clientes
      .map((c) => ({ ...c, ...(st[c.id] || vazio) }))
      .filter((c) => !q || norm(c.nome).includes(q))
      .filter((c) => (escopo === 'dia' ? c.pecasDia > 0 : true))
      .sort((a, b) =>
        escopo === 'dia' ? b.totalDia - a.totalDia : b.total - a.total || b.fila - a.fila
      );
  }, [data, busca, escopo, dia]);

  const ehNova = (c) => !c.preExistente && c.primeiraCompra === dia;

  const legenda = (c) => {
    if (escopo === 'dia') return `${c.pecasDia} ${c.pecasDia === 1 ? 'peça' : 'peças'} nesse dia`;
    if (c.pecas > 0) return `${c.pecas} ${c.pecas === 1 ? 'peça' : 'peças'} no total`;
    if (c.fila > 0) return `esperando ${c.fila} ${c.fila === 1 ? 'peça' : 'peças'} na fila`;
    if (c.preExistente) return 'cliente antiga, sem compras no app';
    return 'sem compras ainda';
  };

  const somaDia = enriquecidas.reduce((s, c) => s + c.totalDia, 0);

  return (
    <>
      <div style={{ padding: '14px 20px 0' }}>
        <div style={S.segmento}>
          <button
            style={{ ...S.segBtn, ...(escopo === 'dia' ? S.segOnEscopo : {}) }}
            onClick={() => setEscopo('dia')}
          >
            Do dia
          </button>
          <button
            style={{ ...S.segBtn, ...(escopo === 'sempre' ? S.segOnEscopo : {}) }}
            onClick={() => setEscopo('sempre')}
          >
            Todas
          </button>
        </div>

        <div style={S.escopoInfo}>
          {escopo === 'dia'
            ? `${dateLabel(dia)} · ${brl(somaDia)}`
            : `${data.clientes.length} ${data.clientes.length === 1 ? 'cliente cadastrada' : 'clientes cadastradas'}`}
        </div>

        <input
          style={S.input}
          value={busca}
          placeholder="Buscar cliente"
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <main style={{ ...S.list, paddingTop: 14 }}>
        {enriquecidas.length === 0 ? (
          <div style={S.empty}>
            <p style={S.emptyTitle}>
              {busca
                ? 'Nenhuma cliente com esse nome.'
                : escopo === 'dia'
                ? 'Ninguém comprou nesse dia.'
                : 'Nenhuma cliente cadastrada ainda.'}
            </p>
            <p style={S.emptyTxt}>
              {escopo === 'dia'
                ? 'Troque o dia pelo calendário ou veja todas as clientes.'
                : 'Cadastre aqui quem já comprava com você antes do app, para ela não entrar como nova.'}
            </p>
          </div>
        ) : (
          enriquecidas.map((c) => (
            <button key={c.id} style={S.cliRow} onClick={() => setForm(c)}>
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={S.cliNome}>{c.nome}</span>
                  {escopo === 'dia' && (
                    <span style={{ ...(ehNova(c) ? S.badgeNova : S.badgeAntiga), marginTop: 0 }}>
                      {ehNova(c) ? 'nova' : 'antiga'}
                    </span>
                  )}
                </div>
                <div style={S.cliSub}>{legenda(c)}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={S.cliTotal}>{brl(escopo === 'dia' ? c.totalDia : c.total)}</div>
                {escopo === 'dia' ? (
                  <div style={S.cliSub}>{brl(c.total)} no total</div>
                ) : c.whatsapp ? (
                  <div style={S.cliSub}>{c.whatsapp}</div>
                ) : null}
              </div>
            </button>
          ))
        )}

        {escopo === 'sempre' && (
          <button style={{ ...S.ctaGhost, marginTop: 18 }} onClick={onExportTudo}>
            Exportar histórico completo
          </button>
        )}
        <button
          style={{ ...S.ctaGhost, marginTop: escopo === 'sempre' ? 10 : 18 }}
          onClick={onEditarMensagem}
        >
          Mensagem do WhatsApp
        </button>
        <button style={{ ...S.ctaGhost, marginTop: 10 }} onClick={onExport}>
          Baixar backup dos dados
        </button>
        <div style={{ height: 96 }} />
      </main>

      <div style={S.dock}>
        <button
          style={S.cta}
          onClick={() => setForm({ nome: '', whatsapp: '', preExistente: true })}
        >
          Cadastrar cliente
        </button>
      </div>

      {form && (
        <FormCliente
          c={form}
          clientes={data.clientes}
          onMesclar={onMesclar}
          onClose={() => setForm(null)}
          onSave={async (x) => {
            await onSave(x);
            onFlash(x.id ? 'Cliente atualizada' : 'Cliente cadastrada');
            setForm(null);
          }}
        />
      )}
    </>
  );
}

function FormCliente({ c, clientes, onClose, onSave, onMesclar }) {
  const [nome, setNome] = useState(c.nome || '');
  const [wpp, setWpp] = useState(c.whatsapp || '');
  const [pre, setPre] = useState(c.preExistente !== false);
  const [mesclando, setMesclando] = useState(false);
  const [buscaM, setBuscaM] = useState('');
  const [alvo, setAlvo] = useState(null);
  const editando = !!c.id;

  const candidatas = useMemo(() => {
    if (!clientes) return [];
    const q = norm(buscaM);
    return clientes
      .filter((x) => x.id !== c.id && (!q || norm(x.nome).includes(q)))
      .slice(0, 6);
  }, [clientes, buscaM, c.id]);

  if (mesclando) {
    return (
      <div style={S.overlay} onClick={onClose}>
        <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
          <div style={S.sheetHead}>
            <span style={S.sheetTitle}>Juntar cadastros</span>
            <button style={S.linkBtn} onClick={() => setMesclando(false)}>
              Voltar
            </button>
          </div>
          <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
            {alvo ? (
              <>
                <p style={{ fontSize: 15, color: t.ink, lineHeight: 1.55, margin: '4px 0 0' }}>
                  Tudo que está em <strong>{c.nome}</strong> passa para{' '}
                  <strong>{alvo.nome}</strong>: as compras, o histórico e as filas.
                </p>
                <p style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.5, marginTop: 12 }}>
                  O cadastro <strong>{c.nome}</strong> deixa de existir. O nome que fica é{' '}
                  <strong>{alvo.nome}</strong>. Nenhuma venda é perdida, e isso não tem como
                  desfazer.
                </p>
                <button
                  style={{ ...S.cta, marginTop: 20 }}
                  onClick={() => {
                    onMesclar(c.id, alvo.id);
                    onClose();
                  }}
                >
                  Juntar em {alvo.nome}
                </button>
                <button style={S.ctaGhost} onClick={() => setAlvo(null)}>
                  Escolher outra
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.5, margin: '4px 0 12px' }}>
                  Qual cadastro é a mesma pessoa que {c.nome}?
                </p>
                <input
                  style={S.input}
                  value={buscaM}
                  placeholder="Buscar cliente"
                  onChange={(e) => setBuscaM(e.target.value)}
                />
                <div style={{ marginTop: 10 }}>
                  {candidatas.map((x) => (
                    <button key={x.id} style={S.cliRow} onClick={() => setAlvo(x)}>
                      <span style={S.cliNome}>{x.nome}</span>
                      <span style={S.cliSub}>{x.whatsapp || ''}</span>
                    </button>
                  ))}
                  {candidatas.length === 0 && (
                    <p style={{ fontSize: 14, color: t.inkSoft, padding: '10px 2px' }}>
                      Nenhuma outra cliente com esse nome.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>{editando ? 'Editar cliente' : 'Cadastrar cliente'}</span>
          <button style={S.linkBtn} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
          {editando && (c.pecas > 0 || c.fila > 0) && (
            <div style={S.histBox}>
              <div style={{ fontFamily: display, fontSize: 26, color: t.ink }}>{brl(c.total)}</div>
              <div style={{ fontSize: 13, color: t.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                {c.pecas} {c.pecas === 1 ? 'peça' : 'peças'} desde sempre
                {c.ultima ? ` · última em ${dataCurta(c.ultima)}` : ''}
                {c.fila > 0 ? ` · ${c.fila} na fila` : ''}
              </div>
            </div>
          )}

          <label style={S.label}>Nome</label>
          <input style={S.input} value={nome} onChange={(e) => setNome(e.target.value)} />

          <label style={{ ...S.label, marginTop: 16 }}>WhatsApp</label>
          <input
            style={S.input}
            value={wpp}
            inputMode="tel"
            placeholder="(55) 99999-9999"
            onChange={(e) => setWpp(e.target.value)}
          />
          <p style={{ fontSize: 13, color: t.inkSoft, margin: '7px 2px 0', lineHeight: 1.45 }}>
            Com o número salvo, a lista dela vai direto pra conversa dela.
          </p>

          <button style={S.checkRow} onClick={() => setPre(!pre)}>
            <span style={{ ...S.checkBox, ...(pre ? S.checkOn : {}) }}>{pre ? '✓' : ''}</span>
            <span style={{ textAlign: 'left' }}>
              Já era minha cliente antes do app
              <span style={S.checkHelp}>Marcada assim, ela nunca entra na contagem de novas.</span>
            </span>
          </button>

          <button
            style={{ ...S.cta, marginTop: 20 }}
            onClick={() =>
              nome.trim() &&
              onSave({ ...c, nome: nome.trim(), whatsapp: wpp.trim(), preExistente: pre })
            }
          >
            {editando ? 'Salvar alterações' : 'Cadastrar'}
          </button>

          {editando && onMesclar && (
            <button style={S.ctaGhost} onClick={() => setMesclando(true)}>
              Essa cliente está duplicada
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── calendário ─────────────────────────────────────────── */
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function Calendario({ data, dia, onEscolher }) {
  const [ano, setAno] = useState(() => Number(dia.split('-')[0]));
  const [mes, setMes] = useState(() => Number(dia.split('-')[1]) - 1);
  const [sel, setSel] = useState(dia);
  const hoje = todayKey();

  const porDia = useMemo(() => {
    const m = {};
    data.vendas.forEach((v) => {
      if (!m[v.data]) m[v.data] = { total: 0, pecas: 0 };
      m[v.data].total += v.valor;
      m[v.data].pecas += 1;
    });
    return m;
  }, [data.vendas]);

  const chave = (d) =>
    `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const celulas = useMemo(() => {
    const inicio = new Date(ano, mes, 1).getDay();
    const qtd = new Date(ano, mes + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < inicio; i++) arr.push(null);
    for (let d = 1; d <= qtd; d++) arr.push(d);
    return arr;
  }, [ano, mes]);

  const doMes = useMemo(() => {
    let total = 0;
    let lives = 0;
    Object.keys(porDia).forEach((k) => {
      const [y, m] = k.split('-').map(Number);
      if (y === ano && m === mes + 1) {
        total += porDia[k].total;
        lives += 1;
      }
    });
    return { total, lives };
  }, [porDia, ano, mes]);

  const resumoSel = useMemo(
    () => calcResumo(data.vendas, data.clientes, sel),
    [data.vendas, data.clientes, sel]
  );

  const andar = (n) => {
    const d = new Date(ano, mes + n, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
  };

  const nomeMes = new Date(ano, mes, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <div style={S.mesRow}>
        <button style={S.arrow} onClick={() => andar(-1)} aria-label="Mês anterior">
          ‹
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={S.mesNome}>{nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}</div>
          <div style={S.mesSub}>
            {doMes.lives === 0
              ? 'nenhuma live'
              : `${doMes.lives} ${doMes.lives === 1 ? 'live' : 'lives'} · ${brl(doMes.total)}`}
          </div>
        </div>
        <button style={S.arrow} onClick={() => andar(1)} aria-label="Próximo mês">
          ›
        </button>
      </div>

      <div style={S.calGrid}>
        {SEMANA.map((s) => (
          <div key={s} style={S.calSemana}>
            {s}
          </div>
        ))}
        {celulas.map((d, i) => {
          if (!d) return <div key={`v${i}`} />;
          const k = chave(d);
          const teve = !!porDia[k];
          const futuro = k > hoje;
          const escolhido = k === sel;
          return (
            <button
              key={k}
              disabled={futuro}
              onClick={() => setSel(k)}
              style={{
                ...S.calDia,
                ...(teve ? S.calDiaLive : {}),
                ...(escolhido ? S.calDiaSel : {}),
                ...(futuro ? S.calDiaFuturo : {}),
                ...(k === hoje && !escolhido ? S.calDiaHoje : {}),
              }}
            >
              {d}
              {teve && <span style={{ ...S.calPonto, background: escolhido ? '#fff' : t.rose }} />}
            </button>
          );
        })}
      </div>

      <div style={S.calDetalhe}>
        <div style={S.calDataSel}>{dateLabel(sel)}</div>
        {resumoSel.pecas > 0 ? (
          <>
            <div style={{ ...S.totalNum, fontSize: 34, marginTop: 4 }}>{brl(resumoSel.total)}</div>
            <div style={S.metaRow}>
              <Meta n={resumoSel.pecas} l={resumoSel.pecas === 1 ? 'peça' : 'peças'} />
              <Meta n={resumoSel.clientes} l={resumoSel.clientes === 1 ? 'cliente' : 'clientes'} />
              <Meta n={resumoSel.novas} l={resumoSel.novas === 1 ? 'nova' : 'novas'} destaque />
            </div>
            {resumoSel.pendente > 0 && (
              <div style={S.pendBar}>
                <span style={{ fontWeight: 500 }}>{brl(resumoSel.pendente)}</span> ainda a receber
              </div>
            )}
            <button style={{ ...S.cta, marginTop: 16 }} onClick={() => onEscolher(sel)}>
              Abrir esse dia
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 15, color: t.inkSoft, margin: '8px 0 0', lineHeight: 1.5 }}>
              Nenhuma peça registrada nesse dia.
            </p>
            <button style={{ ...S.ctaGhost, marginTop: 14 }} onClick={() => onEscolher(sel)}>
              Lançar peça nesse dia
            </button>
          </>
        )}
        <div style={{ height: 40 }} />
      </div>
    </>
  );
}

/* ── mensagem do whatsapp ───────────────────────────────── */
function SheetMensagem({ config, onClose, onSave, onFlash }) {
  const [abertura, setAbertura] = useState(config.abertura || '');
  const [fechamento, setFechamento] = useState(config.fechamento || '');

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>Mensagem do WhatsApp</span>
          <button style={S.linkBtn} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
          <p style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.55, margin: '0 0 16px' }}>
            É o texto que acompanha a lista de peças de cada cliente. Escreva{' '}
            <strong>{'{nome}'}</strong> para o nome dela, <strong>{'{data}'}</strong> para a data da
            live, <strong>{'{total}'}</strong> e <strong>{'{apagar}'}</strong> para os valores.
          </p>

          <label style={S.label}>Antes da lista</label>
          <textarea
            value={abertura}
            onChange={(e) => setAbertura(e.target.value)}
            style={{ ...S.exportTxt, height: 170 }}
          />

          <label style={{ ...S.label, marginTop: 16 }}>Depois da lista</label>
          <textarea
            value={fechamento}
            onChange={(e) => setFechamento(e.target.value)}
            style={{ ...S.exportTxt, height: 170 }}
          />

          <button
            style={{ ...S.cta, marginTop: 18 }}
            onClick={() => {
              onSave({ abertura, fechamento });
              onFlash('Mensagem salva');
              onClose();
            }}
          >
            Salvar mensagem
          </button>
          <button
            style={S.ctaGhost}
            onClick={() => {
              setAbertura(ABERTURA_PADRAO);
              setFechamento(FECHAMENTO_PADRAO);
            }}
          >
            Voltar ao texto original
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── exportação ─────────────────────────────────────────── */
function SheetExport({ dados, onClose, onFlash }) {
  const [i, setI] = useState(0);
  const [baixou, setBaixou] = useState('');
  const op = dados.opcoes[i];

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(op.texto);
      onFlash('Copiado, é só colar no WhatsApp');
    } catch (e) {
      onFlash('Selecione o texto e copie na mão');
    }
  };

  const baixar = () => {
    try {
      const blob = op.gerarArquivo
        ? op.gerarArquivo()
        : new Blob(['\ufeff' + op.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = op.arquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBaixou('ok');
    } catch (e) {
      setBaixou('erro');
    }
  };

  const numeroLimpo = String(dados.whatsapp || '').replace(/\D/g, '');
  const temNumero = numeroLimpo.length >= 10;

  const enviar = () => {
    // wa.me espera só dígitos com o código do país junto
    const completo = numeroLimpo.length <= 11 ? `55${numeroLimpo}` : numeroLimpo;
    const url = `https://wa.me/${completo}?text=${encodeURIComponent(op.texto)}`;
    try {
      const aba = window.open(url, '_blank');
      if (!aba) setBaixou('bloqueado');
    } catch (e) {
      setBaixou('bloqueado');
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>{dados.titulo}</span>
          <button style={S.linkBtn} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div style={{ padding: '4px 20px 20px', overflowY: 'auto' }}>
          {dados.opcoes.length > 1 && (
            <div style={{ ...S.segmento, marginBottom: 12 }}>
              {dados.opcoes.map((o, n) => (
                <button
                  key={o.rotulo}
                  style={{ ...S.segBtn, ...(n === i ? S.segOnEscopo : {}) }}
                  onClick={() => {
                    setI(n);
                    setBaixou('');
                  }}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
          )}

          <textarea
            readOnly
            value={op.texto}
            onFocus={(e) => e.target.select()}
            style={S.exportTxt}
          />

          {temNumero ? (
            <>
              <button style={{ ...S.cta, marginTop: 14 }} onClick={enviar}>
                Enviar para {dados.titulo.split(' ')[0]} no WhatsApp
              </button>
              <button style={S.ctaGhost} onClick={copiar}>
                Só copiar o texto
              </button>
            </>
          ) : (
            <button style={{ ...S.cta, marginTop: 14 }} onClick={copiar}>
              Copiar para o WhatsApp
            </button>
          )}

          <button style={S.ctaGhost} onClick={baixar}>
            {op.rotuloArquivo || 'Baixar planilha (.csv)'}
          </button>

          {dados.whatsapp !== undefined && !temNumero && (
            <p style={{ fontSize: 13, color: t.inkSoft, marginTop: 12, lineHeight: 1.5 }}>
              Salve o WhatsApp dela no cadastro e o envio passa a ser direto, sem copiar e colar.
            </p>
          )}

          {baixou === 'bloqueado' && (
            <p style={S.erro}>
              O navegador bloqueou a abertura do WhatsApp aqui dentro. Use "Só copiar o texto" —
              o envio direto funciona quando a ferramenta estiver publicada num link próprio.
            </p>
          )}

          {baixou === 'erro' && (
            <p style={S.erro}>
              O download foi bloqueado aqui. Use o botão de copiar — a planilha vai funcionar
              quando a ferramenta estiver publicada num link próprio.
            </p>
          )}
          {baixou === 'ok' && (
            <p style={{ fontSize: 13, color: t.inkSoft, marginTop: 12, lineHeight: 1.5 }}>
              Se o arquivo não aparecer nos downloads, use o botão de copiar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── backup ─────────────────────────────────────────────── */
function SheetBackup({ texto, onClose, onFlash }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      onFlash('Backup copiado');
    } catch (e) {
      onFlash('Selecione o texto e copie na mão');
    }
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>Backup dos dados</span>
          <button style={S.linkBtn} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div style={{ padding: '4px 20px 20px' }}>
          <p style={{ fontSize: 14, color: t.inkSoft, lineHeight: 1.5, margin: '0 0 14px' }}>
            Copie este texto e cole num bloco de notas ou mande pra você mesma no WhatsApp. É a
            cópia de segurança de tudo que está registrado.
          </p>
          <textarea
            readOnly
            value={texto}
            onFocus={(e) => e.target.select()}
            style={{
              width: '100%', height: 180, background: t.surface, color: t.inkSoft,
              border: `1px solid ${t.line}`, borderRadius: 9, padding: 12,
              fontSize: 12, fontFamily: 'monospace', resize: 'none',
            }}
          />
          <button style={{ ...S.cta, marginTop: 14 }} onClick={copiar}>
            Copiar backup
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── barreira de erro ───────────────────────────────────── */
class Barreira extends React.Component {
  constructor(p) {
    super(p);
    this.state = { erro: null };
  }
  static getDerivedStateFromError(e) {
    return { erro: e };
  }
  render() {
    if (this.state.erro) {
      return (
        <div style={{ ...S.screen, padding: 28 }}>
          <Fonts />
          <div style={{ maxWidth: 380, margin: '60px auto' }}>
            <div style={{ fontFamily: display, fontSize: 24, color: t.ink, marginBottom: 10 }}>
              Algo travou nesta tela
            </div>
            <p style={{ fontSize: 15, color: t.inkSoft, lineHeight: 1.5 }}>
              Nada do que você registrou foi perdido. Toque abaixo para voltar.
            </p>
            <button style={{ ...S.cta, marginTop: 20 }} onClick={() => this.setState({ erro: null })}>
              Voltar
            </button>
            <p style={{ fontSize: 12, color: t.inkFaint, marginTop: 20, wordBreak: 'break-word' }}>
              {String(this.state.erro && this.state.erro.message)}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── estilos ────────────────────────────────────────────── */
const S = {
  screen: { minHeight: '100vh', background: t.bg, fontFamily: sans, color: t.ink },
  frame: { maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: t.bg, position: 'relative' },
  header: { padding: '16px 20px 0' },
  brandRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: display, fontSize: 21, color: t.ink },
  linkBtn: { background: 'none', border: 'none', color: t.inkSoft, fontSize: 14, padding: 6 },
  tabs: { display: 'flex', gap: 22, marginTop: 14, borderBottom: `1px solid ${t.line}` },
  tab: {
    background: 'none', border: 'none', padding: '8px 0 10px', fontSize: 15,
    color: t.inkSoft, borderBottom: '2px solid transparent', marginBottom: -1,
  },
  tabOn: { color: t.ink, borderBottomColor: t.rose, fontWeight: 500 },

  dateRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 12px 0' },
  arrow: { background: 'none', border: 'none', fontSize: 26, color: t.inkSoft, width: 44, height: 44, lineHeight: 1 },
  dateTxt: { fontSize: 14, color: t.inkSoft, background: 'none', border: 'none', padding: 4, textDecoration: 'underline', textDecorationColor: t.line, textUnderlineOffset: 4 },
  todayBtn: { background: 'none', border: 'none', color: t.rose, fontSize: 13, padding: '2px 0' },

  mesRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 12px 4px' },
  mesNome: { fontFamily: display, fontSize: 20, color: t.ink },
  mesSub: { fontSize: 13, color: t.inkSoft, marginTop: 2 },
  calGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4, padding: '10px 14px 4px',
  },
  calSemana: { fontSize: 11, color: t.inkFaint, textAlign: 'center', paddingBottom: 4 },
  calDia: {
    position: 'relative', aspectRatio: '1 / 1', width: '100%',
    background: 'none', border: '1px solid transparent', borderRadius: 10,
    fontSize: 15, color: t.inkSoft, display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
  },
  calDiaLive: { background: t.surface, borderColor: t.line, color: t.ink, fontWeight: 500 },
  calDiaHoje: { borderColor: t.inkFaint },
  calDiaSel: { background: t.rose, borderColor: t.rose, color: '#fff', fontWeight: 500 },
  calDiaFuturo: { color: '#D9CDD4' },
  calPonto: {
    position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
    width: 4, height: 4, borderRadius: 4,
  },
  calDetalhe: { padding: '18px 20px 0', borderTop: `1px solid ${t.line}`, marginTop: 14 },
  calDataSel: { fontSize: 14, color: t.inkSoft },

  resumo: { padding: '10px 20px 20px', borderBottom: `1px solid ${t.line}` },
  totalNum: { fontFamily: display, fontSize: 42, lineHeight: 1.05, letterSpacing: '-0.5px', color: t.ink },
  metaRow: { display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' },
  pendBar: {
    marginTop: 14, background: t.amberSoft, color: t.amber,
    padding: '9px 12px', borderRadius: 8, fontSize: 14,
  },

  list: { padding: '16px 20px 0' },
  empty: { padding: '48px 8px', textAlign: 'center' },
  emptyTitle: { fontFamily: display, fontSize: 19, color: t.ink, margin: '0 0 8px' },
  emptyTxt: { fontSize: 15, color: t.inkSoft, margin: 0, lineHeight: 1.5 },

  card: { background: t.surface, borderRadius: 12, border: `1px solid ${t.line}`, marginBottom: 12, overflow: 'hidden' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 14px 10px' },
  cliNome: { fontSize: 16, fontWeight: 500, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cliSub: { fontSize: 13, color: t.inkSoft, marginTop: 2 },
  cliTotal: { fontFamily: display, fontSize: 19, color: t.ink },
  badgeNova: {
    display: 'inline-block', marginTop: 4, background: t.roseSoft, color: t.rose,
    fontSize: 12, padding: '2px 8px', borderRadius: 20,
  },
  badgeAntiga: {
    display: 'inline-block', marginTop: 4, background: '#F2EDEF', color: t.inkSoft,
    fontSize: 12, padding: '2px 8px', borderRadius: 20,
  },

  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: `1px solid ${t.line}` },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, background: 'none', border: 'none', padding: 0, textAlign: 'left' },
  codigo: { fontSize: 13, color: t.inkFaint, minWidth: 22 },
  peca: { fontSize: 15, color: t.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowValor: { fontSize: 15, color: t.ink, flexShrink: 0 },
  chipPago: { background: t.greenSoft, color: t.green, border: 'none', fontSize: 12, padding: '4px 9px', borderRadius: 20, flexShrink: 0 },
  chipPend: { background: t.amberSoft, color: t.amber, border: 'none', fontSize: 12, padding: '4px 9px', borderRadius: 20, flexShrink: 0 },

  dock: {
    position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
    width: '100%', maxWidth: 480, padding: '12px 20px 20px',
    background: `linear-gradient(to top, ${t.bg} 62%, rgba(250,245,243,0))`,
  },
  cta: {
    width: '100%', background: t.rose, color: '#fff', border: 'none',
    borderRadius: 10, padding: '15px 16px', fontSize: 16, fontWeight: 500,
  },
  ctaGhost: {
    width: '100%', background: 'none', color: t.inkSoft,
    border: `1px solid ${t.line}`, borderRadius: 10, padding: '13px 16px',
    fontSize: 15, marginTop: 10,
  },

  label: { display: 'block', fontSize: 13, color: t.inkSoft, marginBottom: 6 },
  input: {
    width: '100%', background: t.surface, border: `1px solid ${t.line}`,
    borderRadius: 9, padding: '13px 13px', fontSize: 16, color: t.ink,
  },
  okMark: { position: 'absolute', right: 13, top: 14, color: t.green, fontSize: 16 },
  sugBox: { background: t.surface, border: `1px solid ${t.line}`, borderRadius: 9, marginTop: 6, overflow: 'hidden' },
  sugItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
    background: 'none', border: 'none', borderBottom: `1px solid ${t.line}`,
    padding: '12px 13px', fontSize: 15, color: t.ink, textAlign: 'left',
  },
  hintNova: { fontSize: 13, color: t.rose, margin: '8px 2px 0' },
  erro: { fontSize: 14, color: t.rose, margin: '14px 0 0', lineHeight: 1.4 },

  filaBox: { background: t.surface, border: `1px solid ${t.line}`, borderRadius: 9, overflow: 'hidden' },
  filaItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    fontSize: 15, color: t.ink, borderBottom: `1px solid ${t.line}`,
  },
  filaPos: {
    width: 20, height: 20, borderRadius: 20, background: t.roseSoft, color: t.rose,
    fontSize: 12, lineHeight: '20px', textAlign: 'center', flexShrink: 0,
  },
  addFila: {
    background: t.surface, border: `1px solid ${t.line}`, borderRadius: 9,
    padding: '0 14px', fontSize: 14, color: t.ink, flexShrink: 0,
  },
  filaTag: {
    background: t.roseSoft, color: t.rose, fontSize: 11,
    padding: '2px 6px', borderRadius: 4, flexShrink: 0,
  },
  passaBox: {
    background: t.roseSoft, borderRadius: 10, padding: 14, marginBottom: 18,
  },
  passaTxt: { fontSize: 14, color: t.ink, lineHeight: 1.45, marginBottom: 11 },
  passaBtn: {
    width: '100%', background: t.rose, color: '#fff', border: 'none',
    borderRadius: 8, padding: '12px', fontSize: 15, fontWeight: 500,
  },

  segOnEscopo: { background: t.roseSoft, borderColor: t.roseSoft, color: t.rose, fontWeight: 500 },
  escopoInfo: { fontSize: 13, color: t.inkSoft, margin: '12px 2px 10px' },

  cardExport: {
    width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${t.line}`,
    padding: '11px', fontSize: 14, color: t.rose,
  },
  exportTxt: {
    width: '100%', height: 200, background: t.surface, color: t.ink,
    border: `1px solid ${t.line}`, borderRadius: 9, padding: 12,
    fontSize: 13, lineHeight: 1.6, resize: 'none', fontFamily: sans,
  },

  fotoImg: {
    width: '100%', maxHeight: 260, objectFit: 'cover',
    borderRadius: 9, border: `1px solid ${t.line}`, display: 'block',
  },
  fotoAdd: {
    display: 'block', width: '100%', textAlign: 'center',
    background: t.surface, border: `1px dashed ${t.line}`, borderRadius: 9,
    padding: '20px 12px', fontSize: 15, color: t.inkSoft, cursor: 'pointer',
  },
  fotoVazia: {
    background: t.surface, border: `1px solid ${t.line}`, borderRadius: 9,
    padding: '20px 12px', fontSize: 15, color: t.inkSoft, textAlign: 'center',
  },
  fotoTag: {
    background: '#F2EDEF', color: t.inkSoft, fontSize: 11,
    padding: '2px 6px', borderRadius: 4, flexShrink: 0,
  },
  histBox: {
    background: t.roseSoft, borderRadius: 10, padding: 14, marginBottom: 18,
  },

  segmento: { display: 'flex', gap: 8 },
  segBtn: { flex: 1, background: t.surface, border: `1px solid ${t.line}`, borderRadius: 9, padding: '12px', fontSize: 15, color: t.inkSoft },
  segOnPend: { background: t.amberSoft, borderColor: t.amberSoft, color: t.amber, fontWeight: 500 },
  segOnPago: { background: t.greenSoft, borderColor: t.greenSoft, color: t.green, fontWeight: 500 },

  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(43,28,40,0.42)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
  },
  sheet: {
    width: '100%', maxWidth: 480, background: t.bg,
    borderRadius: '16px 16px 0 0', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
  },
  sheetHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 10px' },
  sheetTitle: { fontFamily: display, fontSize: 20, color: t.ink },

  cliRow: {
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    background: t.surface, border: `1px solid ${t.line}`, borderRadius: 12,
    padding: '14px', marginBottom: 10,
  },

  checkRow: {
    display: 'flex', gap: 11, alignItems: 'flex-start', width: '100%',
    background: 'none', border: 'none', padding: '16px 0 0', fontSize: 15, color: t.ink,
  },
  checkBox: {
    width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${t.line}`,
    background: t.surface, color: '#fff', fontSize: 13, lineHeight: '20px',
    textAlign: 'center', flexShrink: 0,
  },
  checkOn: { background: t.rose, borderColor: t.rose },
  checkHelp: { display: 'block', fontSize: 13, color: t.inkSoft, marginTop: 3, lineHeight: 1.4 },

  toast: {
    position: 'fixed', bottom: 92, left: '50%', transform: 'translateX(-50%)',
    background: t.ink, color: '#fff', fontSize: 14, padding: '10px 16px',
    borderRadius: 8, zIndex: 60,
  },
};

/* ── ponto de entrada ───────────────────────────────────── */
createRoot(document.getElementById('app')).render(<Root />);
