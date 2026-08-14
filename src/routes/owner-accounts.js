import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all owner / capital accounts
router.get('/accounts', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('status', true)
    .eq('account_type', 'Owner')
    .order('created_at', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Get owner account by ID
router.get('/account/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) throw error
  res.json(data)
}))

// Create owner account
router.post('/account', verifyToken, asyncHandler(async (req, res) => {
  const { account_name, account_number, opening_balance, description } = req.body

  if (!account_name) {
    return res.status(400).json({ error: 'Account / Owner name is required' })
  }

  const openingBal = parseFloat(opening_balance || 0)
  const accNum = account_number || `OWN-${Date.now().toString().slice(-4)}`

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert([{
      account_name,
      bank_name: description || 'Owner Equity',
      account_number: accNum,
      account_type: 'Owner',
      opening_balance: openingBal,
      current_balance: openingBal,
      status: true
    }])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Delete / deactivate owner account
router.delete('/account/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .update({ status: false, updated_at: new Date() })
    .eq('id', req.params.id)
    .select()

  if (error) throw error

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Account not found' })
  }

  res.json({ message: 'Owner account deleted', account: data[0] })
}))

// Get transactions for owner account
router.get('/transactions', asyncHandler(async (req, res) => {
  const { account_id, start_date, end_date } = req.query

  let query = supabase
    .from('bank_transactions')
    .select(`
      *,
      bank_accounts(account_name, bank_name, account_type)
    `)

  if (account_id) query = query.eq('bank_account_id', account_id)
  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: true })

  if (error) throw error
  res.json(data)
}))

// Record owner credit or debit transaction
router.post('/transaction', verifyToken, asyncHandler(async (req, res) => {
  const { account_id, transaction_type, amount, transaction_date, description, reference_no } = req.body

  if (!account_id || !transaction_type || !amount || !transaction_date) {
    return res.status(400).json({ error: 'Missing required transaction fields' })
  }

  // Credit = Funds Introduced / Capital Addition
  // Debit = Drawings / Personal Withdrawal
  const typeMapped = transaction_type === 'Credit' ? 'Deposit' : 'Withdrawal'
  const amountNum = parseFloat(amount)

  // Update account balance
  const { data: account, error: accountError } = await supabase
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', account_id)
    .single()

  if (accountError) throw accountError

  const newBalance = typeMapped === 'Deposit'
    ? (account.current_balance || 0) + amountNum
    : (account.current_balance || 0) - amountNum

  await supabase
    .from('bank_accounts')
    .update({ current_balance: newBalance, updated_at: new Date() })
    .eq('id', account_id)

  const { data, error } = await supabase
    .from('bank_transactions')
    .insert([{
      bank_account_id: account_id,
      transaction_type: typeMapped,
      amount: amountNum,
      transaction_date,
      description: description || '',
      reference_no: reference_no || '',
      cheque_no: '',
      created_by: req.user.id
    }])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Delete owner transaction
router.delete('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data: tx, error: fetchErr } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (fetchErr || !tx) {
    return res.status(404).json({ error: 'Transaction not found' })
  }

  // Revert account balance
  const { data: account } = await supabase
    .from('bank_accounts')
    .select('current_balance')
    .eq('id', tx.bank_account_id)
    .single()

  if (account) {
    const revertedBalance = tx.transaction_type === 'Deposit'
      ? account.current_balance - parseFloat(tx.amount)
      : account.current_balance + parseFloat(tx.amount)

    await supabase
      .from('bank_accounts')
      .update({ current_balance: revertedBalance, updated_at: new Date() })
      .eq('id', tx.bank_account_id)
  }

  const { error } = await supabase
    .from('bank_transactions')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Transaction deleted successfully' })
}))

export default router
