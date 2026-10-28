# 24 — Diff rispetto all'originale + anteprima prima dell'installazione — Piano di implementazione

> **Derived from spec:** [`../specs/phase-6-spec.md`](../../specs/phase-6-spec.md) §4.2

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e vincoli di sequenza

- **24.1 dipende da 23.2** (richiede che l'accessor condiviso sia migrato in `drift.ts`/`discovery.ts` affinché il diff abbia un unico punto da chiamare per il contenuto "originale", e affinché il diff di `hook`/`rule` non venga costruito su codice destinato a cambiare).
- **24.2 non ha alcuna dipendenza dal 24.1 di questa stessa iniziativa**, né dall'iniziativa 23 — può essere avviato immediatamente in parallelo a tutto il resto della Fase 6.

## Closed

### 24.1 - Comando di diff rispetto all'originale

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comando diff vs originale · **Size:** M · **Depends on:** 23.2 · **Spec:** [24.1-diff-vs-original.md](24.1-diff-vs-original.md)
- **Goal:** Aggiungere un comando `diffAgainstOriginal` sugli elementi gestiti modificati e sugli elementi non gestiti differenti che risolva l'originale upstream tramite `resolveAndTranslate` e apra `vscode.diff`.

### 24.2 - Azione di anteprima prima dell'installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Azione anteprima pre-installazione · **Size:** M · **Depends on:** 06, 07 · **Spec:** [24.2-preview-before-install.md](24.2-preview-before-install.md)
- **Goal:** Aggiungere un'opzione `Preview` al flusso di conferma dell'installazione usando un `TextDocumentContentProvider` per ispezionare `prepared.content` in sola lettura senza scrivere su disco.
