import jwt from 'jsonwebtoken'

const allowLocalDev = process.env.NODE_ENV !== 'production'

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    if (allowLocalDev) {
      req.user = { id: 'dev-user', email: 'dev@local.test' }
      return next()
    }
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key')
    req.user = decoded
    next()
  } catch (error) {
    if (allowLocalDev) {
      req.user = { id: 'dev-user', email: 'dev@local.test' }
      return next()
    }
    return res.status(403).json({ error: 'Invalid or expired token' })
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

export default { verifyToken, asyncHandler }
