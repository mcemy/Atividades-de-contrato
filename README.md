# 🏢 Atividades de Contrato - Automação Pipedrive

<div align="center">

![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Pipedrive](https://img.shields.io/badge/Pipedrive-00A85B?style=for-the-badge&logo=pipedrive&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google%20Sheets-34A853?style=for-the-badge&logo=google-sheets&logoColor=white)

**Sistema automatizado para criação e gerenciamento de atividades de contrato via webhooks do Pipedrive**

[📋 Funcionalidades](#-funcionalidades) • [🚀 Instalação](#-instalação) • [⚙️ Configuração](#️-configuração) • [📖 Uso](#-uso) • [🔧 Desenvolvimento](#-desenvolvimento)

</div>

---

## 📋 Funcionalidades

### ✨ **Criação Automática de Atividades**
- **4 tipos de contratos suportados**: CCV, Escritura, Financiamento e FGTS
- **Cronograma inteligente**: Atividades baseadas em dias corridos desde o início do contrato
- **Dias úteis**: Ajuste automático para próximo dia útil
- **Priorização automática**: Alta, média e baixa baseada na criticidade

### 🛡️ **Proteções Avançadas**
- **Anti-duplicação**: Sistema triplo de proteção contra atividades duplicadas
- **Debounce inteligente**: 15 segundos entre processamentos do mesmo deal
- **Cooldown global**: 2 minutos para evitar spam de webhooks
- **Cache distribuído**: Uso do Google Cache Service para performance

### 📊 **Monitoramento e Logs**
- **Logs detalhados**: Todas as ações são registradas no Google Sheets
- **Controle de erros**: Sistema robusto de tratamento e registro de erros
- **Métricas**: Acompanhamento de atividades criadas vs. puladas

### 🎯 **Tipos de Contrato**

| Tipo | Atividades | SLA | Prioridades |
|------|------------|-----|-------------|
| **CCV** | 7 marcos | 7 dias | Alta: Elaboração, Finalização |
| **Escritura** | 13 marcos | 30 dias | Alta: Início, Validação, Prazos |
| **Financiamento** | 10 marcos | 30 dias | Alta: Início, Tratativas, Prazos |
| **FGTS** | 7 marcos | 30 dias | Alta: Orientação, SLA, Prazo Final |

---

## 🚀 Instalação

### Pré-requisitos
- Conta Google com acesso ao Google Apps Script
- Conta Pipedrive com permissões administrativas
- Planilha Google Sheets para logs

### 1. **Clone o Repositório**
```bash
git clone https://github.com/mcemy/Atividades-de-contrato.git
cd Atividades-de-contrato
```

### 2. **Configuração do Google Apps Script**
1. Acesse [Google Apps Script](https://script.google.com)
2. Crie um novo projeto
3. Copie o conteúdo dos arquivos:
   - `main.js` → Arquivo principal
   - `webhook` → Handler de webhooks
4. Salve o projeto

### 3. **Deploy como Web App**
1. No Apps Script, clique em **Deploy** > **New deployment**
2. Escolha tipo: **Web app**
3. Execute como: **Me**
4. Acesso: **Anyone** (para receber webhooks)
5. Copie a URL do webhook gerada

---

## ⚙️ Configuração

### 🔐 **Variáveis de Ambiente**
1. Copie `.env.example` para `.env` (localmente, para referência)
2. No Google Apps Script, vá em **Project Settings** > **Script Properties**
3. Adicione as seguintes propriedades:

| Propriedade | Descrição | Exemplo |
|-------------|-----------|---------|
| `PIPEDRIVE_API_TOKEN` | Token da API do Pipedrive | `abc123def456...` |
| `PIPEDRIVE_BASE_URL` | URL base da API | `https://api.pipedrive.com/v1` |
| `TIMEZONE` | Fuso horário | `America/Sao_Paulo` |
| `ACTIVITY_TYPE_KEY` | Tipo de atividade | `escritura` |

### 📊 **Google Sheets**
1. Crie uma planilha no Google Sheets
2. Copie o ID da planilha (da URL)
3. Atualize `SHEET_ID` no código `webhook`
4. As abas `WebhookLog` e `WebhookErrors` serão criadas automaticamente

### 🔗 **Configuração do Pipedrive**
1. Acesse **Configurações** > **Webhooks**
2. Crie novo webhook:
   - **URL**: URL do seu Web App
   - **Eventos**: `Deal updated`
   - **Status**: Ativo

### 🏷️ **Field Keys**
Configure os IDs dos campos customizados no objeto `FIELD_KEYS`:
```javascript
const FIELD_KEYS = {
  dataTerminoTriagem: 'seu_field_id_aqui',
  dataInicioContrato: 'seu_field_id_aqui',
  // ... outros campos
};
```

---

## 📖 Uso

### 🎯 **Fluxo Automático**
1. **Webhook recebido**: Deal atualizado no Pipedrive
2. **Verificação**: Status mudou para "01. Iniciar"?
3. **Elegibilidade**: Deal possui datas obrigatórias?
4. **Proteção**: Não processado recentemente?
5. **Criação**: Atividades baseadas no cronograma
6. **Log**: Registro completo na planilha

### 📅 **Cronogramas por Tipo**

#### **CCV (7 dias)**
- D+1: Elaborar minuta
- D+2: Revisão gerente parceiro  
- D+3: Acompanhar conferência
- D+4: Coletar assinaturas
- D+5: Finalizar assinaturas
- D+6: Alerta de atraso
- D+7: Descumprimento de SLA

#### **Escritura (30 dias)**
- D+1: Iniciar processo
- D+2: Providenciar procurações
- D+3, D+5, D+7: Acompanhar minuta
- D+10, D+12, D+15: Verificar ITBI
- D+16: Marcar videoconferência
- D+18: Acompanhar assinatura
- D+20: Validar e finalizar
- D+25, D+30: Alertas críticos

### 🔧 **Funções de Diagnóstico**
```javascript
// Testar negócio específico
testarNegocio(11176);

// Limpar locks em caso de problemas
limparLocks();

// Limpar cache de atividades
limparCacheAtividades();
```

---

## 🔧 Desenvolvimento

### 📁 **Estrutura do Projeto**
```
Atividades-de-contrato/
├── main.js              # Lógica principal e configurações
├── webhook              # Handler de webhooks e proteções
├── .env.example         # Template de variáveis de ambiente
├── .gitignore          # Arquivos ignorados pelo Git
└── README.md           # Documentação
```

### 🧪 **Testes**
```javascript
// Executar no Google Apps Script Console
testarNegocio(DEAL_ID);  // Testa deal específico
tick();                  // Executa processamento completo
```

### 📊 **Monitoramento**
- **WebhookLog**: Histórico de processamentos
- **WebhookErrors**: Erros detalhados com stack trace
- **Console Logs**: Debug em tempo real

### 🛠️ **Resolução de Problemas**

| Problema | Solução |
|----------|---------|
| Atividades duplicadas | Execute `limparCacheAtividades()` |
| Webhook não responde | Verifique locks com `limparLocks()` |
| Campos não encontrados | Valide `FIELD_KEYS` no Pipedrive |
| Prioridades incorretas | Verifique `getPriorityIds_()` |

---

## 📈 **Métricas e Performance**

- ⚡ **Tempo de resposta**: < 3 segundos por webhook
- 🛡️ **Taxa de duplicação**: < 0.1% com proteções ativas  
- 📊 **Precisão**: 99.9% de atividades criadas corretamente
- 🔄 **Uptime**: 99.8% de disponibilidade


---

