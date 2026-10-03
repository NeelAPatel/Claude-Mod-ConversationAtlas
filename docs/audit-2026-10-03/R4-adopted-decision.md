1. **Recommend (a): `adopted` means the lineage/content of the currently displayed map.** `Earlier Sessions` uses it to mark entries as already represented, so full replacement should replace that set too. This avoids discarded-map adoptions incorrectly blocking re-import. It accepts that an adoption from the discarded map may become available again.

2. `recoverFull` should set `adopted` to `unique([...loaded.adopted, source.id])`; discard `current.adopted`. Preserve current session identity, root and recall list. Clear pending context, append the recovery event, and—after R3—set `fresh: []`.

3. Plain `adoptRecall` remains incremental: if `rid` is already adopted it is a no-op; otherwise it appends `rid` to the current set and merges the saved summary intent. It never uses `loaded.adopted`.

4. This matches `evidence.ts`: adopted entries are dimmed, receive the adopted glyph and lose Resume actions. `saveFile` persists `adopted`; `recall` and `fresh` are excluded. Store persistence therefore preserves the current map’s lineage.

5. Test: `recoverFull replaces adopted lineage`: current `[A]`, loaded `[C]`, source `B` produces `[C,B]`, leaving `A` available again.

6. Test: source already containing its own ID remains deduplicated.

7. Test: plain Resume appends `B` to existing `[A]`, and repeating Resume `B` leaves the set unchanged.

8. Test: Evidence marks every adopted ID unavailable and leaves non-adopted IDs actionable.

9. Test: save/full-recover round trip preserves the loaded `adopted` set and adds the source ID.

10. Test: only explicit `adopt` and `adopt-full` paths change `adopted`; observer/replay paths do not.

11. R3 is conceptually independent. Full replacement should clear `fresh` because freshness belongs to the outgoing render state, regardless of which adoption meaning is chosen.

12. Plain Resume may retain current freshness while its reducers add fresh IDs for newly merged goal/detour content.