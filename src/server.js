import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import studentRoutes from './routes/students.js'
import feeRoutes from './routes/fees.js'
import authRoutes from './routes/auth.js'
import incomeRoutes from './routes/income.js'
import expenseRoutes from './routes/expense.js'
import bankRoutes from './routes/bank.js'
import ownerExpenseRoutes from './routes/owner-expense.js'
import ownerAccountRoutes from './routes/owner-accounts.js'
import profitLossRoutes from './routes/profit-loss.js'
import trialBalanceRoutes from './routes/trial-balance.js'
import daybookRoutes from './routes/daybook.js'
import { checkSupabaseConnection } from './config/supabase.js'

const app = express()
const PORT = process.env.PORT || 3001
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const allowedOrigins = [
  'http://localhost:5173',
  'https://bims-frontend-two.vercel.app',
  ...configuredOrigins,
]

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error('Origin is not allowed by CORS'))
  }
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/fees', feeRoutes)
app.use('/api/income', incomeRoutes)
app.use('/api/expense', expenseRoutes)
app.use('/api/bank', bankRoutes)
app.use('/api/owner-expense', ownerExpenseRoutes)
app.use('/api/owner-accounts', ownerAccountRoutes)
app.use('/api/accounts', ownerAccountRoutes)
app.use('/api/profit-loss', profitLossRoutes)
app.use('/api/trial-balance', trialBalanceRoutes)
app.use('/api/daybook', daybookRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal Server Error', message: err.message })
})

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  const dbConnected = await checkSupabaseConnection()
  if (dbConnected) {
    console.log('✅ Backend is connected to the database and ready to use.')
  } else {
    console.log('⚠️ Backend started, but database connection check failed.')
  }
})

export default app
