import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all owner expense heads
router.get('/heads', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('owner_expense_heads')
    .select('*')
    .eq('status', true)

  if (error) throw error
  res.json(data)
}))

// Create owner expense head
router.post('/head', verifyToken, asyncHandler(async (req, res) => {
  const { head_name, description } = req.body

  if (!head_name) {
    return res.status(400).json({ error: 'head_name is required' })
  }

  const { data, error } = await supabase
    .from('owner_expense_heads')
    .insert([{ head_name, description }])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Get owner expense transactions
router.get('/transactions', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query
  
  let query = supabase
    .from('owner_expense_transactions')
    .select(`
      *,
      owner_expense_heads(head_name)
    `)
  
  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Get owner expense by head
router.get('/head/:head_id', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('owner_expense_transactions')
    .select('*')
    .eq('owner_expense_head_id', req.params.head_id)

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  
  const total = data?.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0) || 0
  res.json({ transactions: data, total })
}))

// Record owner expense transaction
router.post('/transaction', verifyToken, asyncHandler(async (req, res) => {
  const { owner_expense_head_id, amount, transaction_date, description, reference_no } = req.body

  if (!owner_expense_head_id || !amount || !transaction_date) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const { data, error } = await supabase
    .from('owner_expense_transactions')
    .insert([{
      owner_expense_head_id,
      amount: parseFloat(amount),
      transaction_date,
      description,
      reference_no,
      created_by: req.user.id
    }])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Update owner expense transaction
router.put('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { amount, description, reference_no, transaction_date } = req.body

  const { data, error } = await supabase
    .from('owner_expense_transactions')
    .update({
      amount: amount ? parseFloat(amount) : undefined,
      description,
      reference_no,
      transaction_date,
      updated_at: new Date()
    })
    .eq('id', req.params.id)
    .select()

  if (error) throw error
  res.json(data[0])
}))

// Delete owner expense transaction
router.delete('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('owner_expense_transactions')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Owner expense transaction deleted' })
}))

// Get owner expense summary
router.get('/summary', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('owner_expense_transactions')
    .select('amount, owner_expense_head_id, owner_expense_heads(head_name)')

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query

  if (error) throw error

  const summary = {}
  let totalOwnerExpense = 0

  data?.forEach(tx => {
    const headName = tx.owner_expense_heads?.head_name || 'Unknown'
    summary[headName] = (summary[headName] || 0) + parseFloat(tx.amount)
    totalOwnerExpense += parseFloat(tx.amount)
  })

  res.json({ summary, totalOwnerExpense })
}))

export default router
