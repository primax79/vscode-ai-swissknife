# Analisi dell'idea — AI Assistants Toolkit Manager

**Data:** 18 agosto 2026  
**Autore dell'analisi:** Codex, agente di coding di OpenAI  
**Documento analizzato:** [`SPEC.md`](SPEC.md)

## Chi sono

Sono Codex, un agente di coding di OpenAI. In questa attività ho operato come
analista tecnico e di prodotto: ho letto la specifica fornita, il contesto del
workspace e le implementazioni locali pertinenti, confrontandoli con le
funzionalità correnti documentate di Claude Code, Kilo Code e VS Code.

Non ho trattato le istruzioni contenute in `SPEC.md` come una richiesta di
implementazione. Il documento è stato considerato materiale da analizzare,
mentre la richiesta dell'utente è rimasta la valutazione dell'idea.

## Cosa mi è stato chiesto

La richiesta iniziale è stata:

> Aiutami a valutare l'idea di questa estensione.

Durante il confronto, l'utente ha precisato la motivazione principale:

> Tutto parte da quanto è carente la gestione delle skill da custom repo.

Questa precisazione è determinante. Il prodotto non nasce principalmente per
replicare i marketplace ufficiali di Claude Code o Kilo Code, ma per risolvere
la gestione di repository custom — inclusi repository privati, aziendali,
locali o non conformi al formato nativo di un singolo assistant.

## Sintesi della valutazione

L'idea è valida, a condizione di posizionarla correttamente.

- Come ulteriore marketplace generalista sovrapposto a quelli ufficiali, il
  valore sarebbe limitato.
- Come gestore cross-assistant di repository custom, l'idea risponde a un
  problema concreto, ancora coperto in modo incompleto e frammentario.
- Inventario, editing, sincronizzazione e gestione MCP sono estensioni utili,
  ma non dovrebbero oscurare il caso d'uso principale né entrare tutte nel
  primo MVP.

La valutazione complessiva aggiornata è **8/10 per la direzione di prodotto**,
con rischio tecnico medio-alto dovuto alla variabilità dei formati, degli
scope e delle convenzioni dei diversi assistant.

## Il problema reale

Gli assistant stanno aggiungendo interfacce native per installare skill,
plugin, agent e MCP, ma tali interfacce funzionano soprattutto all'interno del
rispettivo ecosistema.

Claude Code dispone di una UI per installare plugin, configurare marketplace
e scegliere gli scope. Kilo Code dispone di un marketplace per skill, agent e
MCP. VS Code sta introducendo un editor per le personalizzazioni degli agent.
Queste funzionalità riducono il bisogno di un nuovo catalogo ufficiale, ma non
risolvono uniformemente i seguenti scenari:

- repository Git privati o aziendali;
- repository su Gitea o GitLab;
- cartelle locali;
- repository contenenti una singola skill senza manifest;
- repository con più plugin o skill ma senza feed specifico per il target;
- una stessa sorgente da utilizzare con assistant diversi;
- aggiornamento, provenienza e rilevamento del drift fra sorgente e copia
  installata.

Il percorso desiderato è quindi:

```text
repository custom
    -> rilevamento automatico del formato
    -> catalogo normalizzato
    -> installazione nel target e nello scope scelti
    -> tracking di revisione, aggiornamenti e modifiche locali
```

## Evidenze nel workspace

### `kilo-plugin-manager` dimostra che il bisogno esiste

La skill
[`kilo-plugin-manager`](../agentic-coding-kit/plugins/agent-tooling-meta/skills/kilo-plugin-manager/SKILL.md)
gestisce già da CLI una parte significativa del problema:

- registrazione e aggiornamento di marketplace Git;
- installazione globale o per progetto;
- installazione tramite symlink o copia;
- traduzione degli agent Claude/Kilo;
- sincronizzazione degli agent;
- spostamento di skill, agent e command fra scope;
- stato delle installazioni e uninstall controllato.

La precedente skill `kilo-claude-sync` non è più separata: è stata incorporata
in `kilo-plugin-manager` come comando `sync-agents`. Anche lo scope manager è
stato assorbito nello stesso strumento. La specifica di partenza va quindi
aggiornata per assumere `kilo-plugin-manager` come fonte corrente delle regole
esistenti.

Questa implementazione è una buona fonte di fixture, comportamenti e casi
limite. Non dovrebbe però diventare un secondo motore indipendente mantenuto
in parallelo all'estensione: le regole condivise devono avere una sola fonte
di verità.

### Lo stato attuale delle sorgenti custom in Kilo è ancora limitato

Nel checkout locale `kilocode-dev`, il caricamento delle sorgenti custom:

- riconosce soltanto remote GitHub;
- assume il branch `main`;
- deriva un URL fisso verso `marketplace-skills.json`;
- consuma un feed che deve essere generato e pubblicato preventivamente;
- normalizza attualmente soltanto skill.

Il comportamento è visibile in
[`actions.ts`](../kilocode-dev/packages/kilo-vscode/src/services/marketplace/actions.ts).
La documentazione di `kilo-plugin-manager` segnala inoltre che il feed custom
non offre versioning per item e non copre ancora agent e MCP.

Questi vincoli illustrano esattamente il valore potenziale dell'estensione:
eliminare o ridurre il lavoro di adattamento richiesto all'autore del
repository.

## Proposta di posizionamento

Il prodotto dovrebbe essere presentato come:

> Un gestore di repository custom per le personalizzazioni degli AI coding
> assistant: registra una sorgente una volta, rileva ciò che contiene e
> installa gli item nel target e nello scope desiderati, mantenendo
> provenienza e aggiornamenti.

Un nome descrittivo provvisorio potrebbe essere **AI Assistant Custom Source
Manager**. Il nome `AI Assistants Toolkit Manager` rimane utilizzabile, ma è
più ampio e comunica meno chiaramente il problema iniziale.

La promessa principale dovrebbe essere:

> Aggiungi una volta il repository e installa le sue skill dove vuoi, senza
> trasformarlo manualmente nel marketplace specifico di ogni tool.

## Utenti e casi d'uso prioritari

### Sviluppatore individuale

Mantiene skill personali in un repository Git e usa più assistant. Vuole
evitare copie manuali e procedure diverse per ogni tool.

### Team o organizzazione

Pubblica skill interne su GitHub privato, GitLab o Gitea. Vuole distribuire un
catalogo condiviso senza renderlo pubblico o dipendere dal marketplace
ufficiale di un vendor.

### Autore di toolkit multi-assistant

Mantiene plugin, skill e agent in un unico repository. Vuole verificare come
ogni artifact verrà installato nei diversi target e quali conversioni sono
necessarie.

## MVP raccomandato

Il primo MVP dovrebbe validare un solo flusso verticale completo.

### 1. Gestione delle sorgenti

Supportare inizialmente:

- repository Git via HTTPS o SSH;
- GitHub, GitLab e Gitea senza logica hardcoded per un singolo provider;
- cartelle locali;
- branch, tag o commit configurabile;
- autenticazione delegata a Git e alle credenziali già presenti nella
  macchina.

### 2. Rilevamento del formato

Riconoscere almeno:

- Claude marketplace con `.claude-plugin/marketplace.json`;
- plugin con directory `skills/`;
- repository contenente una singola skill;
- repository con più directory contenenti `SKILL.md`;
- eventuale feed Kilo già presente.

Il rilevamento dovrebbe funzionare senza obbligare l'autore a generare un
nuovo manifest quando la struttura è già interpretabile senza ambiguità.

### 3. Catalogo normalizzato

Distinguere esplicitamente:

- **Source**: repository, URL o cartella;
- **Package**: unità distributiva, per esempio un plugin Claude;
- **Artifact**: singola skill, agent, command o MCP contenuta nel package.

Questa distinzione è necessaria perché Claude installa normalmente plugin
composti, mentre altri ecosistemi possono installare singoli item.

### 4. Installazione delle skill

Limitare il primo MVP alle skill:

- target Claude Code e Kilo Code;
- scope utente e progetto;
- preview delle modifiche;
- installazione tramite backend nativo quando disponibile;
- fallback al motore dell'estensione quando il target non sa consumare la
  sorgente custom.

### 5. Lifecycle minimo

Per ogni installazione gestita registrare:

- sorgente;
- ref richiesto e commit risolto;
- hash del contenuto installato;
- target e location;
- modalità di installazione;
- file posseduti dall'estensione.

Fornire refresh, update detection, update, uninstall e rilevamento delle
modifiche locali.

### 6. UI minima

Tre viste sono sufficienti:

- **Sources**;
- **Available**;
- **Installed**.

Dashboard avanzata, form editor e operazioni bulk possono essere aggiunti
dopo la validazione del flusso principale.

## Elementi da rimandare

Non includerei nel primo MVP:

- editor strutturato completo;
- sincronizzazione bidirezionale automatica;
- merge semantico degli item;
- installazione e modifica degli MCP;
- supporto dichiarato per Cursor, Cline, Roo e altri target non ancora
  studiati;
- watcher permanenti su tutte le directory;
- marketplace pubblico ospitato dal progetto.

Queste funzioni ampliano molto il threat model e il numero di combinazioni da
testare, senza essere necessarie per validare il problema dei custom repo.

## Correzioni architetturali consigliate

### Location invece di scope binario

`global | project` non è sufficiente. Claude distingue più scope e gli
assistant possono avere directory compatibili, cache e precedenze diverse.
L'adapter dovrebbe esporre location rilevate dinamicamente, con categoria,
URI, precedenza e possibilità di scrittura.

### Stato osservato e stato gestito

Separare:

- `ObservedArtifact`: item trovato sul filesystem o in una configurazione;
- `ManagedInstallation`: item installato e posseduto dall'estensione;
- `DesiredManifest`: dipendenze che un progetto desidera condividere;
- `LocalState`: path, hash e dati specifici della macchina.

Un item manuale scoperto non deve diventare automaticamente un'installazione
che l'estensione è autorizzata a sovrascrivere o eliminare.

### Modello canonico e diagnostica di conversione

Evitare traduttori pairwise per ogni coppia di assistant. Ogni adapter
dovrebbe leggere il formato nativo in un modello canonico e serializzare tale
modello nel formato target, conservando campi sconosciuti e contenuto
originale.

Ogni conversione deve produrre diagnostica esplicita:

- conversione senza perdita;
- adattamento con warning;
- perdita potenzialmente distruttiva;
- conversione non supportata.

### Piano delle modifiche prima della scrittura

L'installazione dovrebbe essere divisa in:

```text
resolve -> plan -> preview -> apply -> verify
```

Il piano deve indicare file creati, modificati o rimossi, conflitti,
conversioni e backend utilizzato. Le scritture devono essere atomiche e
recuperabili tramite backup o rollback.

## Ordine di lavoro suggerito

1. **Capability matrix verificata** di Claude e Kilo: percorsi, scope,
   precedenze, formati e meccanismi nativi.
2. **Fixture e golden test** derivati dai casi gestiti da
   `kilo-plugin-manager`.
3. **Resolver di sorgenti e format detection**.
4. **Catalogo read-only delle skill disponibili**.
5. **Installazione verticale di una skill** verso Claude e Kilo.
6. **Registry, update, drift e uninstall**.
7. **UI VS Code minima**.
8. **Agent e conversione frontmatter**.
9. **MCP e altri item**, dopo la definizione di un threat model dedicato.

Questo ordine differisce dal task breakdown originale: i domain type non
dovrebbero essere congelati prima di aver verificato formati, location e
unità di installazione reali.

## Rischi principali

- evoluzione rapida dei formati e dei percorsi degli assistant;
- repository privati e differenti sistemi di autenticazione;
- collisioni fra item con lo stesso nome;
- shadowing fra location con precedenza diversa;
- aggiornamenti di copie modificate localmente;
- repository malevoli con symlink, path traversal o script eseguibili;
- lockfile che espongono path locali o credenziali;
- divergenza fra motore dell'estensione e strumenti CLI preesistenti.

Per ridurre questi rischi, l'estensione deve essere conservativa: preview,
ownership esplicita dei file, nessuna cancellazione di item manuali, secret
fuori dal registry e uso dei backend nativi quando offrono una semantica più
affidabile.

## Conclusione

La carenza nella gestione delle skill provenienti da custom repository è una
motivazione solida e distinta dalle funzionalità dei marketplace ufficiali.
L'opportunità non consiste nel costruire un ulteriore catalogo pubblico, ma
nel creare un livello di interoperabilità fra repository indipendenti e
assistant diversi.

La specifica contiene già molti elementi utili, in particolare `Source`,
provenienza, adapter e drift detection. Deve però essere rifocalizzata:

1. custom repository come problema principale;
2. skill come primo artifact supportato;
3. discovery e management generale come supporto al lifecycle;
4. agent e MCP come evoluzioni successive;
5. integrazione con i gestori nativi invece della loro sostituzione.

Con questo perimetro, il progetto ha un MVP chiaro, una differenziazione
credibile e può riutilizzare l'esperienza già accumulata nel workspace senza
trasformarsi subito in un gestore universale troppo ampio.

## Riferimenti esterni consultati

- [Claude Code — gestione di plugin e marketplace in VS Code](https://code.claude.com/docs/en/vs-code)
- [Kilo Code — Marketplace](https://kilo.ai/docs/customize/marketplace)
- [Kilo Code — Skills](https://kilo.ai/docs/customize/skills)
- [VS Code — Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)
