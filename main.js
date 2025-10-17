/***********************
 *  CONFIG
 ***********************/
const CFG = (() => {
  const props = PropertiesService.getScriptProperties();
  return {
    TOKEN: props.getProperty('PIPEDRIVE_API_TOKEN') || '592fa4db75e415cbb9e8bebbee497e3c24527f16',
    BASE: props.getProperty('PIPEDRIVE_BASE_URL') || 'https://api.pipedrive.com/v1',
    TZ: props.getProperty('TIMEZONE') || 'America/Sao_Paulo',
  };
})();

if (!CFG.TOKEN) {
  throw new Error('Defina PIPEDRIVE_API_TOKEN nas Propriedades do Script.');
}

const ACTIVITY_TYPE_KEY = (PropertiesService.getScriptProperties().getProperty('ACTIVITY_TYPE_KEY') || 'escritura');

const FIELD_KEYS = {
  dataTerminoTriagem: 'fb1aa427746a8e05d6dadc6eccfc51dd1cdc992d',
  dataInicioContrato: '0ad38672199385b56ed783becd831673c6b7c991',
  dataTerminoContrato:'f7eba1ca53326f57f7e2d5da4d4fe9d155e99651',
  status: { 
    ESCRITURA:     'a9e82a01323493f409ea4da3704ee51f5fd57e3a',
    CCV:           '2e3ee620918878fe343f0c14aad2d3787107404f',
    FGTS_AVISTA:   'ac1d1098a90d1e57d6f7e779e727d01e24ddac82',
    FINANCIAMENTO: '6560bf3b1f6c32a0ad5e6a73fd798bcd5301b0c3',
  },
};

const STATUS_IDS = {
  INICIAR: {
    FINANCIAMENTO: '1075',
    ESCRITURA: '1074',
    CCV: '344',
    FGTS_AVISTA: '1076'
  },
  NA: {
    FINANCIAMENTO: '247',
    ESCRITURA: '246',
    CCV: '308',
    FGTS_AVISTA: '372'
  },
  FINALIZADO: {
    FINANCIAMENTO: '120',
    ESCRITURA: '87',
    CCV: '313',
    FGTS_AVISTA: '161'
  }
};

/***********************
 *  CACHE DE PRIORIDADES
 ***********************/
if (typeof PRIORITY_IDS_CACHE === 'undefined') {
  var PRIORITY_IDS_CACHE = null;
}

function getPriorityIds_() {
  if (PRIORITY_IDS_CACHE) return PRIORITY_IDS_CACHE;
  
  try {
    const resp = pd_('/activityFields');
    if (resp && resp.data) {
      const priorityField = resp.data.find(f => f.key === 'priority');
      
      if (priorityField && priorityField.options && Array.isArray(priorityField.options)) {
        // Mapeia os IDs reais do Pipedrive
        const options = {};
        priorityField.options.forEach(opt => {
          const label = String(opt.label || '').toLowerCase();
          if (label.includes('high') || label.includes('alta') || label.includes('alto')) {
            options.HIGH = opt.id;
          } else if (label.includes('medium') || label.includes('média') || label.includes('medio')) {
            options.MEDIUM = opt.id;
          } else if (label.includes('low') || label.includes('baixa') || label.includes('bajo')) {
            options.LOW = opt.id;
          }
        });
        
        PRIORITY_IDS_CACHE = options;
        Logger.log('🎯 IDs de prioridade carregados: ' + JSON.stringify(options));
        return options;
      }
    }
  } catch (err) {
    Logger.log('⚠️ Erro ao buscar prioridades, usando fallback: ' + err.message);
  }
  
  // Fallback: tenta valores padrão comuns
  PRIORITY_IDS_CACHE = { HIGH: 2, MEDIUM: 1, LOW: 0 };
  return PRIORITY_IDS_CACHE;
}

function getPriorityValue_(priority) {
  const ids = getPriorityIds_();
  
  switch(priority) {
    case 'high':
      return ids.HIGH || 2;
    case 'medium':
      return ids.MEDIUM || 1;
    case 'low':
      return ids.LOW || 0;
    default:
      return ids.MEDIUM || 1;
  }
}

/***********************
 *  DATAS (TZ-LOCAL)
 ***********************/
function tzToday_() {
  const now = new Date();
  const str = Utilities.formatDate(now, CFG.TZ, 'yyyy-MM-dd');
  return new Date(str + 'T00:00:00');
}
function parseLocalDate_(yyyy_mm_dd) { return new Date(yyyy_mm_dd + 'T00:00:00'); }
function addDays_(date, days) { const d = new Date(date.getTime()); d.setDate(d.getDate() + days); return d; }
function diffDays_(startDate, endDate) { return Math.floor((endDate - startDate) / 86400000); }
function ymd_(date) { return Utilities.formatDate(date, CFG.TZ, 'yyyy-MM-dd'); }
function isWeekend_(date) { const dow = date.getDay(); return dow === 0 || dow === 6; }
function nextBusinessDay_(date) {
  let d = new Date(date.getTime());
  while (isWeekend_(d)) d = addDays_(d, 1);
  return d;
}

/***********************
 *  HELPERS DE STATUS
 ***********************/
function normalizeStatus_(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim().toLowerCase();
  if (!s) return '';
  const s2 = s.replace(/^\d+[\.\-\s]+/, '').trim();
  return s2
    .replace(/finalizad[oa]s?/g, 'finalizado')
    .replace(/n\s*\/\s*a|nao se aplica|não se aplica/g, 'n/a');
}

function isNAorFinalizado_(v, planKey) {
  if (!v) return false;
  const vStr = String(v).trim();
  
  if (STATUS_IDS.NA[planKey] && vStr === String(STATUS_IDS.NA[planKey])) return true;
  if (STATUS_IDS.FINALIZADO[planKey] && vStr === String(STATUS_IDS.FINALIZADO[planKey])) return true;
  
  const s = normalizeStatus_(v);
  return s === 'n/a' || s === 'finalizado' || s === '';
}

function isIniciar_(v, planKey) {
  if (!v) return false;
  const vStr = String(v).trim();
  
  if (STATUS_IDS.INICIAR[planKey] && vStr === String(STATUS_IDS.INICIAR[planKey])) {
    return true;
  }
  
  const s = normalizeStatus_(v);
  return s === 'iniciar';
}

/***********************
 *  HTTP PIPEDRIVE
 ***********************/
function pd_(path, opt) {
  const url = CFG.BASE + path + (path.includes('?') ? '&' : '?') + 'api_token=' + encodeURIComponent(CFG.TOKEN);
  const params = Object.assign({ method: 'get', muteHttpExceptions: true, contentType: 'application/json' }, opt || {});
  const res = UrlFetchApp.fetch(url, params);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('PD ' + (params.method || 'GET') + ' ' + path + ' ' + code + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

/***********************
 *  NEGÓCIOS ELEGÍVEIS
 ***********************/
function fetchCandidateDeals_() {
  const resp = pd_('/deals?limit=500&status=open');
  const deals = resp.data || [];
  return deals.filter(d =>
    d[FIELD_KEYS.dataTerminoTriagem] && 
    d[FIELD_KEYS.dataInicioContrato] &&
    !d[FIELD_KEYS.dataTerminoContrato] &&
    (d[FIELD_KEYS.status.CCV] || d[FIELD_KEYS.status.ESCRITURA] || d[FIELD_KEYS.status.FINANCIAMENTO] || d[FIELD_KEYS.status.FGTS_AVISTA])
  );
}

/***********************
 *  ATIVIDADES: LISTAGEM E EXISTÊNCIA
 ***********************/
function listActivitiesAll_(dealId) {
  const all = [];
  const limit = 200;

  let start = 0;
  while (true) {
    const r = pd_(`/activities?deal_id=${dealId}&done=0&start=${start}&limit=${limit}`);
    const arr = r.data || [];
    all.push.apply(all, arr);
    const pg = r.additional_data && r.additional_data.pagination;
    if (!pg || !pg.more_items_in_collection) break;
    start = pg.next_start;
  }

  start = 0;
  while (true) {
    const r = pd_(`/activities?deal_id=${dealId}&done=1&start=${start}&limit=${limit}`);
    const arr = r.data || [];
    all.push.apply(all, arr);
    const pg = r.additional_data && r.additional_data.pagination;
    if (!pg || !pg.more_items_in_collection) break;
    start = pg.next_start;
  }

  return all;
}

function normalizeSubject_(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function activityExistsStrong_({ dealId, subject, dueDateYmd, dueTime }) {
  const subjN = normalizeSubject_(subject);
  const list = listActivitiesAll_(dealId);
  return list.some(a => {
    const sameType = (String(a.type || '').trim() === ACTIVITY_TYPE_KEY);
    const sameDue  = (String(a.due_date || '') === String(dueDateYmd));
    const sameTime = (String(a.due_time || '') === String(dueTime));
    const sameSubj = (normalizeSubject_(a.subject) === subjN);
    return sameType && sameDue && sameTime && sameSubj;
  });
}

function activityExistsBySubjectType_({ dealId, subject }) {
  const subjN = normalizeSubject_(subject);
  const list = listActivitiesAll_(dealId);
  return list.some(a => {
    const sameType = (String(a.type || '').trim() === ACTIVITY_TYPE_KEY);
    const sameSubj = (normalizeSubject_(a.subject) === subjN);
    return sameType && sameSubj;
  });
}

/***********************
 *  FORMATAÇÃO DO NOTE
 ***********************/
function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function formatNote_(rawNote) {
  var s = String(rawNote || '').replace(/\r\n?/g, '\n');
  s = s.replace(/—\s*Lembre-se:/gi, 'Observação:');
  var lines = s.split('\n');
  var out = [];
  for (var i=0;i<lines.length;i++){
    var raw = lines[i];
    if (raw.trim()===''){ out.push('<br/>'); continue; }
    var content = raw.replace(/^\s*[•◉\-—–→]\s*/, '').trimEnd();
    var bullet = /^Observa[cç][aã]o:/i.test(content) ? '' : '• ';
    out.push('<p>'+bullet+escapeHtml_(content)+'</p>');
  }
  return out.join('');
}

/***********************
 *  TABELAS DE CONTEÚDO
 ***********************/
const TXT = {
  CCV: {
    1: `• Confirmar se o cliente quer fazer com a Smart ou não; em ambos os casos, verificar ou instruir o cliente conforme abaixo.
• Verificar se todos os proponentes constam na proposta ou se foi solicitada a inclusão.
• Validar se a documentação completa dos proponentes e do imóvel está salva no Drive.
• Validar se todos os proponentes possuem certificado digital ativo.
• Elaborar a minuta do CCV, preenchendo corretamente:
  • Qualificações do gerente CEF
  • Dados de todos os compradores/proponentes
  • Cláusula de matrícula com todas as averbações relevantes
  • Dados completos do imóvel
• Salvar a minuta no formato "Minuta sem revisão – [Código do Imóvel]".
Observação: prazo para elaboração da minuta = 2 dias.`,
    2: `• Encaminhar a minuta para conferência do gerente parceiro.
• Confirmar com o gerente se todos os dados estão corretos (agência, procurações, valores e dados).
• Ajustar eventual necessidade de alteração de proposta ou inclusão/exclusão de proponentes.
• Garantir que a minuta esteja em PDF/A para evitar problemas.
• Caso algum proponente não tenha certificado digital, auxiliar na providência.
Observação: prazo para revisão da minuta = 2 dias.`,
    3: `• Verificar se o gerente retornou a minuta revisada.
  • Se sim: aplicar os ajustes solicitados e enviar a versão final.
  • Se não: cobrar imediatamente o gerente para não comprometer o SLA.
• Salvar a minuta validada pelo gerente para assinatura.`,
    4: `• Verificar se a minuta conferida está em PDF/A.
• Subir o contrato no E-NOTARIADO ou enviar para assinatura ICP-BR.
• Solicitar assinaturas dos compradores e do gerente.
• Conferir se as procurações digitais do gerente estão salvas no Drive; em caso de gerente externo, instruir o cliente a solicitar.
Observação: prazo para assinatura da minuta = 1 dia.`,
    5: `• Confirmar a assinatura do gerente parceiro e de todos os compradores no E-NOTARIADO.
• Validar o documento no ITI e/ou E-NOTARIADO e salvar a validação e o manifesto de assinaturas no Drive.
• Garantir que o contrato final assinado esteja em PDF/A e salvo no Drive.
• Atualizar o Pipedrive.
• Enviar cópia final ao cliente.`,
    6: `Verificar se o contrato já foi assinado pelas partes.
 Caso não esteja:
  • Confirmar se o atraso ocorreu na conferência do gerente ou na assinatura das partes
  • Cobrar imediatamente o responsável (gerente parceiro ou cliente)
  • Comunicar o responsável sobre a necessidade de urgência
Registrar status no Pipedrive.`,
    7: `Comunicar o cliente e gerente que o prazo previsto já foi ultrapassado, informar novo prazo de conclusão e justificativa.
  Se concluído nesse dia: salvar contrato assinado no Drive e atualizar Pipedrive.`
  },

  ESCRITURA: {
    1: `• Verificar cartório de notas e agência escolhida (parceiro ou externo).
• Caso seja externo, instruir o cliente sobre a escolha de parceiro e, se desejar trocar, sobre alteração de proposta.
• Validar se todos os proponentes possuem certificado E-NOTARIADO.
• Verificar se a documentação está completa para elaboração da minuta; caso não, providenciar.`,
    2: `• Conferir a agência:
  • Se externa: solicitar procurações digitais.
  • Se parceira: verificar procurações no Drive e, se necessário, solicitar.
• Criar tarefa de acompanhamento para retorno da procuração, se necessário.
• Verificar se o cartório/agência iniciou o processo; se não, cobrar.`,
    3: `• Verificar o andamento da elaboração da minuta junto ao cartório de notas.
• Confirmar se o ITBI já está em andamento (essencial para finalização).
• Solicitar o envio da minuta ao parceiro ou cliente para conferência.`,
    5: `• Enviar e conferir a minuta elaborada pelo cartório (cliente, gerente e assessor):
  • Qualificação do gerente
  • Dados do(s) comprador(es) e do imóvel
• Ajustar erros identificados pelo gerente ou cliente.
• Salvar a minuta revisada no Drive e acompanhar o ITBI.`,
    7: `• Acompanhar a emissão da guia do ITBI.
• Se não iniciado, solicitar com urgência.
• Se finalizado, agendar videoconferência.`,
    10: `• Acompanhar a emissão da guia do ITBI.
• Se emitida, acompanhar envio do boleto e pagamento do cliente.
• Se não emitida, checar o status com a prefeitura e acionar o necessário.
• Se finalizado, agendar videoconferência.`,
    12: `• Confirmar se o pagamento do ITBI foi realizado.
• Se pendente, cobrar atualização.
• Se pago, acompanhar a quitação na prefeitura.
• Se finalizado, agendar videoconferência.`,
    15: `• Verificar se o ITBI foi quitado e liberado.
• Se finalizado, agendar videoconferência.
• Se não finalizado, tratar como crítico, entender o motivo e acionar as medidas necessárias.`,
    16: `• Verificar e realizar o agendamento da videoconferência com cartório/agência.
• Confirmar cliente e gerente sobre data e horário.
• Criar atividade para acompanhamento no dia agendado.`,
    18: `• Confirmar se a videoconferência foi realizada.
• Se houver inconsistências, resolver com urgência.
• Cobrar assinaturas pendentes.
• Salvar o Traslado na pasta após verificar as assinaturas.`,
    20: `• Validar assinaturas do Traslado.
• Salvar Traslado + impressão de validação no Drive.
• Atualizar o campo "Data Término: Escritura".
• Avisar o cliente sobre o início do processo de Registro.
• Caso não finalizado, tratar como crítico e informar o cliente com justificativa e plano de ação.`,
    25: `• Confirmar se a Escritura foi lavrada e assinada.
• Se não concluída, registrar descumprimento de prazo interno (SLA 20 dias).
• Reforçar cobrança ao cartório e solicitar justificativa formal do atraso.
• Comunicar o cliente que estamos acompanhando junto ao cartório.`,
    30: `• Último dia para cumprimento do prazo CEF.
• Se a Escritura não estiver assinada, informar o cliente que o prazo foi atingido, com justificativa e plano de ação.
• Se concluída: salvar Traslado e validação no Drive e atualizar o Pipedrive.`
  },

  FIN: {
    1: `• Confirmar com o cliente se iniciou tratativas com o CCA responsável.
  • CCA Parceiro: contato via grupo interno (envio do link)
  • CCA Externo: contato externo e confirmar pré-aprovação de crédito
• Se não iniciou, instruir o cliente a dar andamento com urgência.`,
    2: `• Confirmar a fase do contrato:
  • CCA Externo: via cliente
  • CCA Parceiro: via BITRIX
• Definir o gerente que assinará o contrato e solicitar/salvar a cadeia de procurações no Drive.
• CCA Externo: confirmar com o cliente se a minuta pode ser compartilhada para conferência.`,
    3: `• Conferir se o cliente iniciou o preenchimento de formulários obrigatórios.
• Verificar se há previsão de entrevista com o gerente.
• Se não houver, entender o motivo com o CCA e apoiar a solução.
• CCA Externo: confirmar com o cliente se há dificuldade de avanço.`,
    5: `• Confirmar que o fluxo segue sem travas (cadastro, formulários e agenda com gerente).
• Se houver atraso, notificar o setor e o CCA com urgência.`,
    7: `• Solicitar ao CCA a minuta do contrato + matrícula atualizada para conferência.
• Se houver erros, pontuar ao CCA e estipular 1 dia para correção.
• Salvar minuta e matrícula no Drive do imóvel.
• CCA Externo: cliente pode enviar a minuta; enviar manual de conferência, se necessário.`,
    10: `• Verificar a previsão de assinatura no sistema.
• Se não houver, levantar impeditivos junto ao CCA e alinhar a solução.`,
    15: `• Confirmar se o contrato foi assinado.
• Validar documentos assinados (Contrato, CCIs, procurações).
• Salvar a versão final no Drive.
• Se não assinado, solicitar dados imediatos de assinatura.`,
    20: `• Checar se o contrato já foi assinado.
• Caso contrário, instruir o CCA a solicitar dilatação junto ao CEVEN.
• Criar atividade para +2 dias: confirmar se o pedido foi feito e acompanhar resposta do CEVEN.
• Se houver dilatação, ajustar o campo "Data Vencimento: Contrato de Financiamento".`,
    25: `• Informar CCA/cliente que o prazo está se encerrando.
• Cobrar assinatura imediatamente.
• Reforçar risco de cancelamento da arrematação se não assinar até D+30.`,
    30: `• Último dia para assinatura conforme norma da CEF.
• Se não houver assinatura: confirmar dilatação oficial ou risco de cancelamento da arrematação.`
  },

  FGTS: {
    1: `• Confirmar se o cliente já compareceu à agência para abertura do processo do FGTS.
• Reforçar documentos necessários (proposta, identidade, CTPS, extrato FGTS).
• Explicar que o prazo máximo CEF para assinatura é 30 dias corridos; SLA interno Smart = 20 dias.`,
    5: `• Contatar o cliente para verificar se a agência já iniciou a análise da documentação.
• Se houver pendência, apoiar o cliente na comunicação com o gerente.`,
    10: `• Cobrar atualização do cliente sobre o andamento na agência.
• Perguntar se já há previsão de assinatura.
• Explicar que, em caso de demora na liberação do FGTS, o gerente pode solicitar dilatação do prazo junto ao CEVEN.`,
    15: `• Confirmar se já existe previsão de assinatura do contrato.
• Caso não, orientar o cliente a intensificar o envio na agência.`,
    20: `• Verificar se o contrato foi assinado.
• Se sim: solicitar validação da assinatura e salvar a validação no Drive junto ao contrato.
• Se não: reforçar a urgência ao cliente e orientar sobre a necessidade de dilatação.
• Criar atividade para +2 dias: confirmar se o gerente solicitou dilatação.`,
    25: `• Reforçar ao cliente que o prazo CEF está se encerrando.
• Orientar sobre entraves, se houver.`,
    30: `• Último dia para assinatura.
• Confirmar com o cliente se o contrato foi assinado.
• Se sim: salvar comprovante e atualizar o Pipedrive.
• Se não: confirmar dilatação oficial ou risco de cancelamento da arrematação.`
  }
};

const TITLE_CCVD = { 1:'ELABORAR MINUTA',2:'REVISÃO GERENTE PARCEIRO',3:'ACOMPANHAR CONFERÊNCIA',4:'COLETAR ASSINATURAS',5:'FINALIZAR ASSINATURAS',6:'ALERTA DE ATRASO (CONFERÊNCIA OU ASSINATURA)',7:'DESCUMPRIMENTO DE SLA' };
const TITLE_ESC  = { 1:'INICIAR',2:'PROVIDENCIAR PROCURAÇÕES',3:'STATUS DE ANDAMENTO DA MINUTA',5:'REVISAR MINUTA',7:'ACOMPANHAR ITBI (1ª VERIFICAÇÃO)',10:'ACOMPANHAR ITBI (2ª VERIFICAÇÃO)',12:'ACOMPANHAR ITBI (3ª VERIFICAÇÃO)',15:'CHECK FINAL DE ITBI',16:'MARCAR VIDEOCONFERÊNCIA',18:'ACOMPANHAR ASSINATURA',20:'VALIDAR E FINALIZAR',25:'ALERTA DE DESCUMPRIMENTO',30:'PRAZO FINAL / CRÍTICO' };
const TITLE_FIN  = { 1:'INICIAR',2:'VERIFICAR TRATATIVAS',3:'FORMULÁRIOS E ENTREVISTA',5:'PONTO DE CONTROLE',7:'CONFERIR MINUTA',10:'VERIFICAR ASSINATURA',15:'ACOMPANHAR ASSINATURA',20:'ALERTA: SLA SMART',25:'PRAZO CRÍTICO',30:'PRAZO FINAL CEF' };
const TITLE_FGTS = { 1:'INICIAR ORIENTAÇÃO',5:'ACOMPANHAR PRIMEIRO RETORNO',10:'ACOMPANHAMENTO INTERMEDIÁRIO',15:'ALERTA DE PRAZO',20:'SLA SMART',25:'COBRANÇA REFORÇADA',30:'PRAZO FINAL CEF' };

const PRIORITY_MAP = {
  CCV:        { high:new Set([1,5,6,7]),              medium:new Set([2,3,4]),                  low:new Set() },
  ESCRITURA:  { high:new Set([1,20,25,30]),           medium:new Set([2,3,5,7,10,12,15,16,18]), low:new Set() },
  FIN:        { high:new Set([1,2,20,25,30]),         medium:new Set([3,5,7,10,15]),            low:new Set() },
  FGTS:       { high:new Set([1,20,30]),              medium:new Set([5,10,15]),                low:new Set([25]) }
};

function getPriority_(planKey, day){
  const pm = PRIORITY_MAP[planKey];
  if (!pm) return 'low';
  if (pm.high.has(day)) return 'high';
  if (pm.medium.has(day)) return 'medium';
  if (pm.low.has(day)) return 'low';
  return 'low';
}

const PLAN = {
  CCV: {
    days: [
      { day: 1, hour: 9 },
      { day: 2, hour: 10 },
      { day: 3, hour: 11 },
      { day: 4, hour: 12 },
      { day: 5, hour: 13 },
      { day: 6, hour: 14 },
      { day: 7, hour: 15 }
    ],
    title: (d) => `CCV - ${d} DIA${d>1?'S':''} - ${TITLE_CCVD[d]}`,
    note: (d) => formatNote_(TXT.CCV[d])
  },
  ESCRITURA: {
    days: [
      { day: 1, hour: 9 },
      { day: 2, hour: 10 },
      { day: 3, hour: 11 },
      { day: 5, hour: 12 },
      { day: 7, hour: 13 },
      { day: 10, hour: 14 },
      { day: 12, hour: 15 },
      { day: 15, hour: 16 },
      { day: 16, hour: 17 },
      { day: 18, hour: 9 },
      { day: 20, hour: 10 },
      { day: 25, hour: 11 },
      { day: 30, hour: 12 }
    ],
    title: (d) => `ESCRITURA - ${d} DIA${d>1?'S':''} - ${TITLE_ESC[d]}`,
    note: (d) => formatNote_(TXT.ESCRITURA[d])
  },
  FIN: {
    days: [
      { day: 1, hour: 9 },
      { day: 2, hour: 10 },
      { day: 3, hour: 11 },
      { day: 5, hour: 12 },
      { day: 7, hour: 13 },
      { day: 10, hour: 14 },
      { day: 15, hour: 15 },
      { day: 20, hour: 16 },
      { day: 25, hour: 17 },
      { day: 30, hour: 9 }
    ],
    title: (d) => `FINANCIAMENTO - ${d} DIA${d>1?'S':''} - ${TITLE_FIN[d]}`,
    note: (d) => formatNote_(TXT.FIN[d])
  },
  FGTS: {
    days: [
      { day: 1, hour: 9 },
      { day: 5, hour: 10 },
      { day: 10, hour: 11 },
      { day: 15, hour: 12 },
      { day: 20, hour: 13 },
      { day: 25, hour: 14 },
      { day: 30, hour: 15 }
    ],
    title: (d) => `FGTS - ${d} DIA${d>1?'S':''} - ${TITLE_FGTS[d]}`,
    note: (d) => formatNote_(TXT.FGTS[d])
  }
};

/***********************
 *  DECIDIR PLANOS A CRIAR
 ***********************/
function getPlansToCreate_(deal) {
  const plans = [];

  const st = {
    FIN: deal[FIELD_KEYS.status.FINANCIAMENTO],
    ESCRITURA: deal[FIELD_KEYS.status.ESCRITURA],
    CCV: deal[FIELD_KEYS.status.CCV],
    FGTS: deal[FIELD_KEYS.status.FGTS_AVISTA],
  };

  if (isIniciar_(st.FIN, 'FINANCIAMENTO')) plans.push('FIN');
  if (isIniciar_(st.ESCRITURA, 'ESCRITURA')) plans.push('ESCRITURA');
  if (isIniciar_(st.CCV, 'CCV')) plans.push('CCV');
  if (isIniciar_(st.FGTS, 'FGTS_AVISTA')) plans.push('FGTS');

  return plans;
}

/***********************
 *  CRIAÇÃO DE ATIVIDADE COM HORÁRIO E PRIORIDADE
 ***********************/
function createActivity_({ deal, subject, note, dueDate, dueTime, priority }) {
  const dueBday = nextBusinessDay_(dueDate);
  const dueY = ymd_(dueBday);

  if (activityExistsStrong_({ dealId: deal.id, subject, dueDateYmd: dueY, dueTime })) {
    Logger.log('⊘ Já existe: %s | %s %s', subject, dueY, dueTime);
    return;
  }

  // 🎯 CONVERTE PRIORIDADE USANDO OS IDs REAIS DO PIPEDRIVE
  const priorityValue = getPriorityValue_(priority);

  const body = {
    subject: subject,
    type: ACTIVITY_TYPE_KEY,
    done: 0,
    deal_id: deal.id,
    due_date: dueY,
    due_time: dueTime,
    duration: '01:00',
    note: note || '',
    busy_flag: true,
    priority: priorityValue  // ✅ USA O ID CORRETO
  };

  if (deal.user_id && deal.user_id.id) {
    body.user_id = deal.user_id.id;
  }
  if (deal.person_id && deal.person_id.value) {
    body.person_id = deal.person_id.value;
  }
  if (deal.org_id && deal.org_id.value) {
    body.org_id = deal.org_id.value;
  }

  Logger.log('🔨 Criando: %s | %s %s | Prio: %s (ID=%s)', subject, dueY, dueTime, priority, priorityValue);

  try {
    const result = pd_('/activities', { 
      method: 'post', 
      payload: JSON.stringify(body) 
    });

    if (result && result.data && result.data.id) {
      Logger.log('  ✅ Criada ID: %s', result.data.id);
      Logger.log('  📊 Priority retornada: %s', result.data.priority);
    }
  } catch (err) {
    Logger.log('  ❌ Erro: %s', err.message);
    throw err;
  }
}

/***********************
 *  EXECUTOR PRINCIPAL
 ***********************/
function tick() {
  const today = tzToday_();
  const deals = fetchCandidateDeals_();

  let created = 0, skipped = 0, checked = 0;

  deals.forEach((deal) => {
    checked++;

    const baseStr = deal[FIELD_KEYS.dataInicioContrato];
    if (!baseStr) return;

    const baseDate = parseLocalDate_(baseStr);
    const dx = diffDays_(baseDate, today);

    const plans = getPlansToCreate_(deal);
    if (!plans.length) return;

    for (const planKey of plans) {
      const pl = PLAN[planKey];
      const dayConfigs = pl.days.slice();

      dayConfigs.forEach((config) => {
        const d = config.day;
        const hour = config.hour;
        
        if (dx >= d) {
          const subject  = pl.title(d);
          const note     = pl.note(d);
          const priority = getPriority_(planKey, d);
          const dueRaw   = addDays_(baseDate, d);
          const dueBday  = nextBusinessDay_(dueRaw);
          const dueTime  = String(hour).padStart(2, '0') + ':00';

          if (activityExistsStrong_({ dealId: deal.id, subject, dueDateYmd: ymd_(dueBday), dueTime }) || 
              activityExistsBySubjectType_({ dealId: deal.id, subject })) {
            skipped++;
            return;
          }
          createActivity_({ deal, subject, note, dueDate: dueBday, dueTime, priority });
          created++;
        }
      });

      const nextConfig = dayConfigs.find(cfg => cfg.day > dx);
      if (nextConfig) {
        const nextD = nextConfig.day;
        const nextHour = nextConfig.hour;
        const subjectN  = pl.title(nextD);
        const noteN     = pl.note(nextD);
        const priorityN = getPriority_(planKey, nextD);
        const dueRawN   = addDays_(baseDate, nextD);
        const dueBdayN  = nextBusinessDay_(dueRawN);
        const dueTimeN  = String(nextHour).padStart(2, '0') + ':00';

        if (!activityExistsStrong_({ dealId: deal.id, subject: subjectN, dueDateYmd: ymd_(dueBdayN), dueTime: dueTimeN }) && 
            !activityExistsBySubjectType_({ dealId: deal.id, subject: subjectN })) {
          createActivity_({ deal, subject: subjectN, note: noteN, dueDate: dueBdayN, dueTime: dueTimeN, priority: priorityN });
          created++;
        } else {
          skipped++;
        }
      }
    }
  });

  Logger.log(JSON.stringify({ ok:true, created, skipped, checked, date: ymd_(today) }));
}

/***********************
 *  FUNÇÃO DE TESTE ÚNICA
 ***********************/
function testarNegocio(id) {
  const DEAL_ID = id || 11176;
  const today = tzToday_();
  
  Logger.log('=== TESTE DO NEGÓCIO %s ===', DEAL_ID);
  Logger.log('Data de hoje: %s\n', ymd_(today));
  
  // 🎯 PRIMEIRO: Carrega os IDs de prioridade do Pipedrive
  Logger.log('🔍 Carregando IDs de prioridade do Pipedrive...');
  const priorityIds = getPriorityIds_();
  Logger.log('✅ IDs carregados: %s\n', JSON.stringify(priorityIds));
  
  const dealResp = pd_('/deals/' + DEAL_ID);
  const deal = dealResp && dealResp.data;
  
  if (!deal) { 
    Logger.log('❌ Negócio %s não encontrado.', DEAL_ID); 
    return; 
  }

  const baseStr = deal[FIELD_KEYS.dataInicioContrato];
  const hasTri  = !!deal[FIELD_KEYS.dataTerminoTriagem];
  const hasTerminoContrato = !!deal[FIELD_KEYS.dataTerminoContrato];
  
  if (!baseStr || !hasTri || hasTerminoContrato) {
    Logger.log('❌ Elegibilidade falhou:');
    Logger.log('   Data Início Contrato: %s', baseStr ? '✅' : '❌');
    Logger.log('   Data Término Triagem: %s', hasTri ? '✅' : '❌');
    Logger.log('   Contrato finalizado: %s', hasTerminoContrato ? '❌ SIM' : '✅ NÃO');
    return;
  }

  const baseDate = parseLocalDate_(baseStr);
  const dx = diffDays_(baseDate, today);
  
  Logger.log('📅 Data Início Contrato: %s', ymd_(baseDate));
  Logger.log('📊 Dias desde início do contrato: %s\n', dx);

  const plans = getPlansToCreate_(deal);
  
  if (!plans.length) {
    Logger.log('❌ Sem planos a criar para deal %s', DEAL_ID);
    Logger.log('Motivo: Nenhum status está em "Iniciar"\n');
    
    Logger.log('Status atual:');
    Logger.log('  • FINANCIAMENTO: %s', deal[FIELD_KEYS.status.FINANCIAMENTO] || '(vazio)');
    Logger.log('  • ESCRITURA: %s', deal[FIELD_KEYS.status.ESCRITURA] || '(vazio)');
    Logger.log('  • CCV: %s', deal[FIELD_KEYS.status.CCV] || '(vazio)');
    Logger.log('  • FGTS: %s', deal[FIELD_KEYS.status.FGTS_AVISTA] || '(vazio)');
    return;
  }

  Logger.log('✅ Planos identificados: %s\n', plans.join(', '));

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const planKey of plans) {
    Logger.log('--- Processando plano: %s ---', planKey);
    const pl = PLAN[planKey];
    const dayConfigs = pl.days.slice();

    dayConfigs.forEach((config) => {
      const d = config.day;
      const hour = config.hour;
      
      if (dx >= d) {
        const s = pl.title(d);
        const n = pl.note(d);
        const p = getPriority_(planKey, d);
        const pValue = getPriorityValue_(p);
        const dueRaw = addDays_(baseDate, d);
        const dueB = nextBusinessDay_(dueRaw);
        const dueY = ymd_(dueB);
        const dueTime = String(hour).padStart(2, '0') + ':00';
        
        if (!activityExistsStrong_({ dealId: DEAL_ID, subject: s, dueDateYmd: dueY, dueTime }) && 
            !activityExistsBySubjectType_({ dealId: DEAL_ID, subject: s })) {
          createActivity_({ deal, subject: s, note: n, dueDate: dueB, dueTime, priority: p });
          Logger.log('  ✔ Backlog: D+%s %s | %s | prio %s (ID=%s)', d, dueTime, s, p, pValue);
          totalCreated++;
        } else {
          Logger.log('  ⊘ Já existe: D+%s %s | %s', d, dueTime, s);
          totalSkipped++;
        }
      }
    });

    const nextConfig = dayConfigs.find(cfg => cfg.day > dx);
    if (nextConfig) {
      const nextD = nextConfig.day;
      const nextHour = nextConfig.hour;
      const sN = pl.title(nextD);
      const nN = pl.note(nextD);
      const pN = getPriority_(planKey, nextD);
      const pValueN = getPriorityValue_(pN);
      const dueRawN = addDays_(baseDate, nextD);
      const dueBN = nextBusinessDay_(dueRawN);
      const dueYN = ymd_(dueBN);
      const dueTimeN = String(nextHour).padStart(2, '0') + ':00';
      
      if (!activityExistsStrong_({ dealId: DEAL_ID, subject: sN, dueDateYmd: dueYN, dueTime: dueTimeN }) && 
          !activityExistsBySubjectType_({ dealId: DEAL_ID, subject: sN })) {
        createActivity_({ deal, subject: sN, note: nN, dueDate: dueBN, dueTime: dueTimeN, priority: pN });
        Logger.log('  ✔ Próxima: D+%s %s | %s | prio %s (ID=%s)', nextD, dueTimeN, sN, pN, pValueN);
        totalCreated++;
      } else {
        Logger.log('  ⊘ Já existe: D+%s %s | %s', nextD, dueTimeN, sN);
        totalSkipped++;
      }
    }
    Logger.log('');
  }
  
  Logger.log('=== RESUMO ===');
  Logger.log('✅ Atividades criadas: %s', totalCreated);
  Logger.log('⊘ Atividades puladas: %s', totalSkipped);
  Logger.log('🎯 Total processado: %s', totalCreated + totalSkipped);
  Logger.log('\n=== FIM DO TESTE ===');
}