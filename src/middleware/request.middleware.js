export function requireJsonAction(req, res, next) {
  if (!req.is('application/json') || req.get('X-Requested-With') !== 'YugiAgent') {
    return res.status(403).json({ error: 'Request could not be verified. Refresh the page and try again.' });
  }
  next();
}
