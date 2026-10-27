# Raw note — refactor frameworks/sources

**Date:** 2026-09-08
**Author:** Alfredo (raw planning note, originally `note/refactor_frameworks.md`)
**Produced:** [`specs/adapter-and-source-registries.md`](../../specs/adapter-and-source-registries.md),
driving initiatives [29 — Adapter registry & config](../../done/29-adapter-registry/plan.md) and
[30 — Source-resolver registry](../../done/30-source-resolver-registry/plan.md).

Two design forks in the original note were resolved with the user before
writing the spec (see the spec's Locked-in decisions for the full *why*):

- "Framework" and "Adapter" are the same entity — the existing `Adapter`
  interface is enriched in place, not wrapped by a new parallel class.
- The "enabled frameworks" config lives in a native VS Code setting
  (`contributes.configuration`), not the shared git-tracked manifest.

---

Original text, verbatim:

> refactor importante. richiede studio approfondito, definizione dei task, delega
>
> vorrei gestire i framework in maniera più pulita
>
> ora abbiamo la logica sparsa in un sacco di punti
>
> mi immagino così
>
> classe astratta ai_framwork (o come vogliamo chiamare)
> implementazione claude_framework, fornisce nome, icona, logica di patching di skill etc, folder per progetto, folder globale, e tutti i parametri necessari
> implementazione kilo_framework, stessa cosa
>
> per un nuovo framework basta aggiungere una nuova classe
>
> quando dobbiamo iterare, non facciamo una serie di if ma foreach sul set di framework
>
> aggiungiamo anche menu di configurazione per indicare cosa sia attivo
>
> stesso approccio per le tipologie di sources
