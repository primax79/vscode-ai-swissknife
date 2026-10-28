# N001 Un test di npm test usa git nel repository vero e fallisce se git è occupato

- id: N001
- title: Un test di npm test usa git nel repository vero e fallisce se git è occupato
- kind: bug
- status: ready
- created: 2026-10-28T06:47:21.541122+00:00
- author: ai-coding-tools-87
- about: -
- produced: -
- processed-by: -
- short: Test usa git del repo

2026-10-28, dopo il merge di 49.6 su main: npm test 598/599 con 1 fallimento. Nello stesso momento un git add nel repository è fallito con index.lock esistente, quindi un test eseguiva git nel checkout reale (non in una copia temporanea). Riesecuzione: 599/599. Da fare: trovare il test (candidati: test che risolvono percorsi da process.cwd() o leggono la storia git del repo, es. ricerca del commit d'installazione in drift/provenance), isolarlo su un repo temporaneo, conservare l'output se ricapita.
