/**
 * send-staging.js — STUB
 * Full implementation lives in the invoices repo.
 *
 * Schedule: 09:00 UTC on the 22nd of every month
 */
exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({ message: 'Handled by invoices repo' }),
});
