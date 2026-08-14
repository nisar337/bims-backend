import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all expense heads
router.get('/heads', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('expense_heads')
    .select('*')
    .eq('status', true)

  if (error) throw error
  res.json(data)
}))

// Get expense transactions
router.get('/transactions', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query
  
  let query = supabase
    .from('expense_transactions')
    .select(`
      *,
      expense_heads(head_name)
    `)
  
  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Get expense by head
router.get('/head/:head_id', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('expense_transactions')
    .select('*')
    .eq('expense_head_id', req.params.head_id)

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  
  const total = data?.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0) || 0
  res.json({ transactions: data, total })
}))

// Record expense transaction (deducts from Cash in Hand account if paid by cash)
router.post('/transaction', verifyToken, asyncHandler(async (req, res) => {
  const { expense_head_id, amount, transaction_date, description, reference_no, vendor_name } = req.body

  if (!expense_head_id || !amount || !transaction_date) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const amountNum = parseFloat(amount)

  const { data, error } = await supabase
    .from('expense_transactions')
    .insert([{
      expense_head_id,
      amount: amountNum,
      transaction_date,
      description,
      reference_no,
      vendor_name,
      created_by: req.user.id
    }])
    .select()

  if (error) throw error

  // Deduct from Cash in Hand account
  try {
    const { data: cashAccounts } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('status', true)
      .or('account_type.eq.Cash,account_name.ilike.%Cash in Hand%')

    const cashAcc = cashAccounts && cashAccounts.length > 0 ? cashAccounts[0] : null
    if (cashAcc) {
      await supabase
        .from('bank_transactions')
        .insert([{
          bank_account_id: cashAcc.id,
          transaction_type: 'Withdrawal',
          amount: amountNum,
          transaction_date,
          description: description || `Expense: ${vendor_name || 'Cash Outflow'}`,
          reference_no: reference_no || `EXP-${data[0].id.slice(0, 4).toUpperCase()}`,
          cheque_no: '',
          created_by: req.user.id
        }])

      const newCashBal = (parseFloat(cashAcc.current_balance) || 0) - amountNum
      await supabase
        .from('bank_accounts')
        .update({ current_balance: newCashBal, updated_at: new Date() })
        .eq('id', cashAcc.id)
    }
  } catch (err) {
    console.error('Warning: could not sync expense to Cash in Hand:', err.message)
  }

  res.status(201).json(data[0])
}))

// Update expense transaction
router.put('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { amount, description, reference_no, transaction_date, vendor_name } = req.body

  const { data, error } = await supabase
    .from('expense_transactions')
    .update({
      amount: amount ? parseFloat(amount) : undefined,
      description,
      reference_no,
      transaction_date,
      vendor_name,
      updated_at: new Date()
    })
    .eq('id', req.params.id)
    .select()

  if (error) throw error
  res.json(data[0])
}))

// Delete expense transaction
router.delete('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data: tx } = await supabase
    .from('expense_transactions')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (tx) {
    try {
      const { data: cashAccounts } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('status', true)
        .or('account_type.eq.Cash,account_name.ilike.%Cash in Hand%')

      const cashAcc = cashAccounts && cashAccounts.length > 0 ? cashAccounts[0] : null
      if (cashAcc) {
        const refTag = `EXP-${tx.id.slice(0, 4).toUpperCase()}`
        await supabase
          .from('bank_transactions')
          .delete()
          .eq('bank_account_id', cashAcc.id)
          .or(`reference_no.eq.${refTag},reference_no.eq.${tx.reference_no || '__none__'}`)

        const revertedBal = (parseFloat(cashAcc.current_balance) || 0) + parseFloat(tx.amount || 0)
        await supabase
          .from('bank_accounts')
          .update({ current_balance: revertedBal, updated_at: new Date() })
          .eq('id', cashAcc.id)
      }
    } catch (err) {
      console.error('Warning: could not revert cash in hand on expense delete:', err.message)
    }
  }

  const { error } = await supabase
    .from('expense_transactions')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Expense transaction deleted' })
}))

// Get expense summary
router.get('/summary', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('expense_transactions')
    .select('amount, expense_head_id, expense_heads(head_name)')

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query

  if (error) throw error

  const summary = {}
  let totalExpense = 0

  data?.forEach(tx => {
    const headName = tx.expense_heads?.head_name || 'Unknown'
    summary[headName] = (summary[headName] || 0) + parseFloat(tx.amount)
    totalExpense += parseFloat(tx.amount)
  })

  res.json({ summary, totalExpense })
}))

export default router
