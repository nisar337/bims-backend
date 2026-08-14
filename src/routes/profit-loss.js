import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Generate P&L statement
router.post('/generate', verifyToken, asyncHandler(async (req, res) => {
  const { period_start, period_end } = req.body

  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'period_start and period_end are required' })
  }

  // Get all financial data for the period
  const [incomeData, expenseData, ownerExpenseData] = await Promise.all([
    supabase
      .from('income_transactions')
      .select('amount')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end),
    supabase
      .from('expense_transactions')
      .select('amount')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end),
    supabase
      .from('owner_expense_transactions')
      .select('amount')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end)
  ])

  const totalIncome = incomeData.data?.reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
  const totalExpense = expenseData.data?.reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
  const totalOwnerExpense = ownerExpenseData.data?.reduce((sum, tx) => sum + parseFloat(tx.amount), 0) || 0
  // Net Operating Profit / Loss = Total Operating Income - Total Operating Expenses (Owner accounts/drawings do not affect P&L)
  const netProfitLoss = totalIncome - totalExpense

  const { data, error } = await supabase
    .from('profit_loss_statements')
    .insert([{
      period_start,
      period_end,
      total_income: totalIncome,
      total_expense: totalExpense,
      total_owner_expense: totalOwnerExpense,
      generated_by: req.user.id
    }])
    .select()

  if (error) throw error

  res.status(201).json({
    ...data[0],
    net_profit_loss: netProfitLoss
  })
}))

// Get P&L for specific period
router.get('/period', asyncHandler(async (req, res) => {
  const { period_start, period_end } = req.query

  // Get all financial data for the period
  const [incomeResult, expenseResult, ownerExpenseResult] = await Promise.all([
    supabase
      .from('income_transactions')
      .select('amount, income_heads(head_name)')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end),
    supabase
      .from('expense_transactions')
      .select('amount, expense_heads(head_name)')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end),
    supabase
      .from('owner_expense_transactions')
      .select('amount, owner_expense_heads(head_name)')
      .gte('transaction_date', period_start)
      .lte('transaction_date', period_end)
  ])

  const incomeByHead = {}
  let totalIncome = 0
  incomeResult.data?.forEach(tx => {
    const headName = tx.income_heads?.head_name || 'Unknown'
    incomeByHead[headName] = (incomeByHead[headName] || 0) + parseFloat(tx.amount)
    totalIncome += parseFloat(tx.amount)
  })

  const expenseByHead = {}
  let totalExpense = 0
  expenseResult.data?.forEach(tx => {
    const headName = tx.expense_heads?.head_name || 'Unknown'
    expenseByHead[headName] = (expenseByHead[headName] || 0) + parseFloat(tx.amount)
    totalExpense += parseFloat(tx.amount)
  })

  const ownerExpenseByHead = {}
  let totalOwnerExpense = 0
  ownerExpenseResult.data?.forEach(tx => {
    const headName = tx.owner_expense_heads?.head_name || 'Unknown'
    ownerExpenseByHead[headName] = (ownerExpenseByHead[headName] || 0) + parseFloat(tx.amount)
    totalOwnerExpense += parseFloat(tx.amount)
  })

  // Net Operating Profit / Loss = Total Operating Income - Total Operating Expenses (Owner accounts/drawings do not affect P&L)
  const netProfitLoss = totalIncome - totalExpense

  res.json({
    period: {
      start: period_start,
      end: period_end
    },
    income: {
      breakdown: incomeByHead,
      total: totalIncome
    },
    expense: {
      breakdown: expenseByHead,
      total: totalExpense
    },
    owner_expense: {
      breakdown: ownerExpenseByHead,
      total: totalOwnerExpense
    },
    summary: {
      total_income: totalIncome,
      total_expense: totalExpense,
      total_owner_expense: totalOwnerExpense,
      net_profit_loss: netProfitLoss,
      status: netProfitLoss > 0 ? 'Profit' : netProfitLoss < 0 ? 'Loss' : 'Break Even'
    }
  })
}))

// Get P&L statements
router.get('/statements', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('profit_loss_statements')
    .select('*')
    .order('period_start', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Get specific P&L statement
router.get('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('profit_loss_statements')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) throw error
  res.json(data)
}))

export default router
