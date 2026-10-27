# T001 Test di discovery indipendenti dalla HOME reale

- id: T001
- title: Test di discovery indipendenti dalla HOME reale
- category: tests
- priority: P3
- priority-reason: Le prove degli use case UC008, UC019, UC029 falliscono con una HOME isolata; il prodotto funziona, il test no
- next-up: no
- state: delivered
- executor: kilo
- depends-on: -
- decider: -
- sources: verifica degli use case 2026-10-27 (ai-coding-tools-c1)
- paths: src/engine/discovery.test.ts
- handoff: Read tasks/tests/T001-test-di-discovery-indipendenti-dalla-home-reale.md, do the open steps, run the Verification, update the task and the registry.
- short: Test senza HOME reale

## Goal

Il test 'attempts to resolve git-single-item and remote-url sources' (src/engine/discovery.test.ts) passa con la HOME reale e fallisce con HOME=$(mktemp -d) (0 osservati invece di 1): dipende dall'ambiente dell'utente (home o configurazione git). Isolarlo: la scansione riceve la radice home dal test, git gira con una configurazione propria del test; poi tutti i test e le prove degli use case passano anche con una HOME vuota.

## Steps

- [x] Trovare la dipendenza (os.homedir, ~/.gitconfig o altro) con HOME isolata: individuata la mancata propagazione di `homeRoot` da `scanInstalledInventory` a `resolveAndTranslate` (e da lì a `resolveContentFromSource` e ai resolver `remote-url`/`git`), che ripiegava su `os.homedir()` fallendo in assenza della cache preesistente nella home reale.
- [x] Iniettare la home nel test o nella funzione; nessuna lettura della HOME reale nei test: `resolveAndTranslate` e `resolveContentFromSource` ora accettano `resolverOpts.homeRoot`, propagato da `scanInstalledInventory`, `planInstall`, `checkForUpstreamUpdate` e comandi CLI; isolata la configurazione git in `discovery.test.ts` tramite `GIT_CONFIG_GLOBAL` e `GIT_CONFIG_NOSYSTEM`.
- [x] Aggiungere a npm test un controllo che giri l'intera suite con HOME isolata: creato `scripts/test-isolated.js` e aggiunto lo script `test:isolated` in `package.json`.

## Verification

- HOME=$(mktemp -d) npm test: 0 fallimenti; le prove di UC008, UC019, UC029 passano con HOME isolata.
- `npm run test:isolated` eseguito con successo: 117 suite, 577 test (576 passati, 0 falliti, 1 saltato).
- `npm run lint`: 0 errori (28 warning preesistenti).
- `npm run typecheck`: 0 errori.

## Log

- 2026-10-27, kilo: state `open` -> `delivered` — risolta dipendenza da HOME reale in discovery iniettando homeRoot in resolveAndTranslate e aggiunto script test:isolated
