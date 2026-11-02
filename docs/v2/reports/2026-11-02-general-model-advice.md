# Catalogue-based model advice

All model suggestions now use one resolver shared by search fallback and mascot presentation. It distinguishes exact identifiers, exact identifiers with longer variants, incomplete identifiers, ambiguous candidates and single-edit spelling mistakes. There are no named model exceptions.

Normalization covers case, surrounding whitespace, the HD prefix and full-width input. Typo suggestions stay within the same alphabetic family and allow one insertion, deletion, substitution or adjacent transposition. Numeric-only chip searches and ordinary questions do not enter model guessing. Distant identifiers are left unresolved.

Exact catalogue entries and concrete exact results remain authoritative. Multiple candidates require explicit customer selection. A unique completion may be fetched automatically; a unique typo candidate may be fetched only for identifiers at least five characters long. Every automatic approximation is labeled and does not establish device or firmware compatibility. Short identifiers are intentionally more conservative.

Validation: 20 focused tests passed. Generated cases exercise ten alphabetic families and several numeric/suffix forms, including 150 exact/completion checks and typo/ambiguity boundaries. These are generated regression checks, not customer-answer accuracy measurements.

Live desktop and 390px browser verification passed across C, A, R and VP families. Request traces confirm ambiguous searches did not fetch a first candidate, optional selection triggered a new query, unique typo approximations were labeled, exact queries remained intact and competitive highlights still appeared. No page errors or horizontal overflow were observed.

Release `20261102-model-advice-28` changes only the two frontend scripts. Backend bytes and the competitive knowledge artifact remain unchanged; the previous release is retained for recovery. Both live scripts were checked against source bytes after activation.
