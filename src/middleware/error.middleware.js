export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

export function errorHandler(error, _req, res, _next) {
  console.error('Request failed:', error?.name || 'internal error');
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'An unexpected server error occurred.' });
}
