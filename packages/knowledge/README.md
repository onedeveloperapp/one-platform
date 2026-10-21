# @flyee/knowledge

The pure rules of the firm's library: reading what a piece cites, and measuring how alike two pieces are. No I/O, no clock, no framework (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sprint S7).

## What is here

| File | What it is |
|---|---|
| `src/citations.ts` | `extractCitations(text)`: every norm and decision a text cites (a law by number or by name, an article with the norm it is of, a decree, a resolution, a súmula, a theme, a decision by its class and number, a case of a court below by its CNJ number, an enunciado, and the norms that are no law: a provisional measure, an amendment, an ordinance, a regulation), each with the key it has in the library (`sourceKey`) and, for what it could not read into a source, the kind `ilegivel`. `canonicalCitation(source)`: the words a source is cited by, as the database writes them. `citationGap(citation)`: why a citation cannot be checked as it is written. `isCovered(citation, keys)`: what a library answers for |
| `src/citations.test.ts` | The forms it reads, as tables: the ones lawyers write, the ones the library itself writes (`legal_source_citation`, migration 0029), what it must refuse to read as a source, and that a long text is read in the time of its length |
| `src/similarity.ts` | `signature(text)`: 128 numbers that stand for a text (MinHash over sequences of five words, with every figure read as one word). `similarity(a, b)`: the share of text two pieces have in common, from their signatures |
| `src/similarity.test.ts` | That the same text gives the same signature on any machine, and that the estimate stays within a few points of the true share |

`npm test -w @flyee/knowledge` runs both.

## Rules

- **The reader names, the library decides.** `extractCitations` only reads a text and gives each citation its key. Whether a source is verified is the firm's library (`legal_sources`), and the gate that refuses to approve a draft with a citation outside it is in the database (`case_draft_state_blocker`, migration 0029). `isCovered` here is the same rule, for a screen.
- **It fails closed.** What is written as a citation and read into no source is still a citation: one of the kind `ilegivel`, which no library answers for, so the piece that holds it is not approved. That is what happens to a law of a state or a municipality, a numbered act of a kind the reader has no form for, a reporter's block ("Rel. Min. ..., julgado em ...") with no decision it can name beside it, and an appeal of a court below written by a number that is not a CNJ one. The same goes for an article with no norm beside it ("art. 14 do referido diploma", kind `artigo`). The cure is in the text: write the norm next to the article, the CNJ number of the case, or take the citation out.
- **Nothing is half a source.** `citationGap` names what a citation lacks to be somebody's: no norm (an article alone), no issuer (a súmula, a theme, a resolution or an enunciado of nobody; a decision of a class several courts have, such as `HC` or `AgInt`, with no court beside it), no year (a decree or another norm numbered again every year), or a form the reader does not read. A library entry never has a gap: the database refuses one (`legal_source_number_ok`, `legal_source_issuer_ok`).
- **One key and one name, two writers.** `sourceKey` and `canonicalCitation` here, `legal_source_key` and `legal_source_citation` in the database, write the same strings from the same four things (kind, issuer, number, article); a test of the app keeps them together for every kind. A library entry is created from a citation the lawyer types as they would write it in a piece, read by this same reader: so an entry always has the key its citations are read into, and what the library says a source is cited as is read back into that very source.
- **Laws are named by their number alone** (their numbering is one sequence), decrees by number and year (theirs started again), a súmula and a theme with the court that issued them, a decision by its class and number (`RESP 1584465`), with its court when the class is one several courts have. A code that was replaced is the law it was (the CPC of 1973 is not the one of 2015).
- **What it does not notice at all, it does not block.** The reader knows the forms in its tables. A citation written in a way that matches none of them, not even as something that looks like a citation, passes unseen: the tables in `citations.test.ts` are where a new form is added, with the case that showed it.
- **Similarity measures and decides nothing.** It is what a judge who reads two petitions of the same firm would see, shown to the firm first. Names, dates, flight numbers and amounts changed leave two texts the same text: every figure is one word.

## What joins, and when

| What | Milestone |
|---|---|
| Search over the library's texts (the hybrid retrieval of the mold in commit `ab2e84d`: pgvector and Portuguese full text fused by rank, with its evaluation set). It needs pgvector, which the embedded test database does not have | M3 to M5 |
| A check of a transcribed passage against the text the library holds for its source | M3 |
