/**
 * send-invoices.js — STUB
 * Full implementation lives in the invoices repo.
 * This stub exists so the function slot is reserved
 * and the schedule is defined from day one.
 *
 * Schedule: 09:00 UTC on the 25th of every month
 * (defined in netlify.toml in the invoices repo)
 */
exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({ message: 'Handled by invoices repo' }),
});
