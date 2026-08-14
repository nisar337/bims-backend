import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all income heads (placing the master 'Income' head first)
router.get('/heads', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('income_heads')
    .select('*')
    .eq('status', true)

  if (error) throw error

  // Sort so that 'Income' is at the very top
  const sorted = [...(data || [])].sort((a, b) => {
    if (a.head_name.toLowerCase() === 'income') return -1
    if (b.head_name.toLowerCase() === 'income') return 1
    return a.head_name.localeCompare(b.head_name)
  })

  res.json(sorted)
}))

// Get income transactions
router.get('/transactions', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query
  
  let query = supabase
    .from('income_transactions')
    .select(`
      *,
      income_heads(head_name)
    `)
  
  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Get income by head
router.get('/head/:head_id', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('income_transactions')
    .select('*')
    .eq('income_head_id', req.params.head_id)

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  
  const total = data?.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0) || 0
  res.json({ transactions: data, total })
}))

// Record income transaction (directly adds credit to Income head and Cash in Hand account)
router.post('/transaction', verifyToken, asyncHandler(async (req, res) => {
  const { income_head_id, amount, transaction_date, description, reference_no } = req.body

  if (!income_head_id || !amount || !transaction_date) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const amountNum = parseFloat(amount)

  // 1. Insert into income_transactions (Credit to Income Head)
  const { data, error } = await supabase
    .from('income_transactions')
    .insert([{
      income_head_id,
      amount: amountNum,
      transaction_date,
      description,
      reference_no,
      created_by: req.user.id
    }])
    .select()

  if (error) throw error

  // 2. Directly add to Cash in Hand account (Debit/Inflow)
  try {
    const { data: cashAccounts } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('status', true)
      .or('account_type.eq.Cash,account_name.ilike.%Cash in Hand%')

    const cashAcc = cashAccounts && cashAccounts.length > 0 ? cashAccounts[0] : null

    if (cashAcc) {
      // Record cash deposit
      await supabase
        .from('bank_transactions')
        .insert([{
          bank_account_id: cashAcc.id,
          transaction_type: 'Deposit',
          amount: amountNum,
          transaction_date,
          description: description || 'Income Received (Cash)',
          reference_no: reference_no || `INC-${data[0].id.slice(0, 4).toUpperCase()}`,
          cheque_no: '',
          created_by: req.user.id
        }])

      // Increment cash in hand balance
      const newCashBal = (parseFloat(cashAcc.current_balance) || 0) + amountNum
      await supabase
        .from('bank_accounts')
        .update({ current_balance: newCashBal, updated_at: new Date() })
        .eq('id', cashAcc.id)
    }
  } catch (err) {
    console.error('Warning: could not sync income to Cash in Hand account:', err.message)
  }

  res.status(201).json(data[0])
}))

// Update income transaction
router.put('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { amount, description, reference_no, transaction_date } = req.body

  const { data, error } = await supabase
    .from('income_transactions')
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

// Delete income transaction
router.delete('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  // 1. Fetch transaction details before deleting
  const { data: tx } = await supabase
    .from('income_transactions')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (tx) {
    // 2. Revert from Cash in Hand account
    try {
      const { data: cashAccounts } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('status', true)
        .or('account_type.eq.Cash,account_name.ilike.%Cash in Hand%')

      const cashAcc = cashAccounts && cashAccounts.length > 0 ? cashAccounts[0] : null
      if (cashAcc) {
        const refTag = `INC-${tx.id.slice(0, 4).toUpperCase()}`
        await supabase
          .from('bank_transactions')
          .delete()
          .eq('bank_account_id', cashAcc.id)
          .or(`reference_no.eq.${refTag},reference_no.eq.${tx.reference_no || '__none__'}`)

        const revertedBal = Math.max(0, (parseFloat(cashAcc.current_balance) || 0) - parseFloat(tx.amount || 0))
        await supabase
          .from('bank_accounts')
          .update({ current_balance: revertedBal, updated_at: new Date() })
          .eq('id', cashAcc.id)
      }
    } catch (err) {
      console.error('Warning: could not revert cash in hand on income delete:', err.message)
    }
  }

  const { error } = await supabase
    .from('income_transactions')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Income transaction deleted' })
}))

// Get income summary
router.get('/summary', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('income_transactions')
    .select('amount, income_head_id, income_heads(head_name)')

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query

  if (error) throw error

  const summary = {}
  let totalIncome = 0

  data?.forEach(tx => {
    const headName = tx.income_heads?.head_name || 'Unknown'
    summary[headName] = (summary[headName] || 0) + parseFloat(tx.amount)
    totalIncome += parseFloat(tx.amount)
  })

  res.json({ summary, totalIncome })
}))

export default router
