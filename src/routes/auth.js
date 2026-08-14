import express from 'express'
import jwt from 'jsonwebtoken'
import { asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

// Login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const token = jwt.sign({ id: data.user.id, email: data.user.email }, JWT_SECRET, {
    expiresIn: '24h',
  })

  res.json({ token, user: data.user })
}))

// Register
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  res.status(201).json({ user: data.user, message: 'User registered successfully' })
}))

// Logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' })
})

// Get current user
router.get('/me', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    res.json({ user: decoded })
  } catch (error) {
    res.status(403).json({ error: 'Invalid token' })
  }
}))

export default router
