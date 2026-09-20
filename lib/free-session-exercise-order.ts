export function orderFreeExerciseChoices<T extends { sessionCount: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftUsed = left.item.sessionCount > 0 ? 1 : 0;
      const rightUsed = right.item.sessionCount > 0 ? 1 : 0;
      return rightUsed - leftUsed || left.index - right.index;
    })
    .map(({ item }) => item);
}
