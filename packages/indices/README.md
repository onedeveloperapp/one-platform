# @flyee/indices

The monthly rates a condemnation is updated by, item 4.6 of the case journey plan (`atualizacao-v1` of `@flyee/rules/update`): the IPCA, by which it is corrected since Lei 14.905/2024, and the Selic, of which the IPCA is taken out for the interest.

- `types.ts`: the interface (`IndexSource.monthly(series, from, to)`), answered month by month in percent, or `unavailable` with a code.
- `providers/bcb.ts`: the Banco Central's public time series (SGS), with no key: series 433 (the IPCA's monthly variation) and 4390 (the Selic accumulated in the month). Written from the SGS's public address and the shape of its JSON answer; a range with no value answers 404, read as a reading with nothing in it.
- `fake.ts`: the series in memory.
- `contract.test.ts`: what any implementation must do, the Banco Central's answers scripted in their shapes. Nothing here ran against the live series yet.
