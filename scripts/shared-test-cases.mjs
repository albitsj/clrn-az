/** Run matrix rows sequentially so network mocks and compiler hosts stay isolated.
 * @param rows - Ordered test data.
 * @param check - Assertion callback for one row.
 */
export async function forEachCase(rows, check) {
  for (const row of rows) await check(row);
}
