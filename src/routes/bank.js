import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Helper to compute live Cash in Hand balance from its ledger
const getLiveCashInHand = async (cashAccountId, openingBalance = 0) => {
  try {
    const { data: txs, error } = await supabase
      .from('bank_transactions')
      .select('amount, transaction_type')
      .eq('bank_account_id', cashAccountId)

    if (error) throw error

    const deposits = txs?.filter(t => t.transaction_type === 'Deposit').reduce((s, t) => s + parseFloat(t.amount || 0), 0) || 0
    const withdrawals = txs?.filter(t => t.transaction_type === 'Withdrawal').reduce((s, t) => s + parseFloat(t.amount || 0), 0) || 0

    return parseFloat(openingBalance || 0) + deposits - withdrawals
  } catch (err) {
    return parseFloat(openingBalance || 0)
  }
}

// Get all bank & cash accounts (excluding owner capital accounts by default)
router.get('/accounts', asyncHandler(async (req, res) => {
  const { include_all } = req.query
  let query = supabase
    .from('bank_accounts')
    .select('*')
    .eq('status', true)

  if (!include_all) {
    query = query.neq('account_type', 'Owner')
  }

  const { data, error } = await query
  if (error) throw error

  // Compute live balance for Cash in Hand / Cash accounts
  const processed = await Promise.all((data || []).map(async (acc) => {
    if (acc.account_type === 'Cash' || acc.account_name.toLowerCase().includes('cash in hand')) {
      const liveBal = await getLiveCashInHand(acc.id, acc.opening_balance)
      return { ...acc, current_balance: liveBal }
    }
    return acc
  }))

  // Sort so that 'Cash in Hand' / Cash accounts appear first
  const sorted = [...processed].sort((a, b) => {
    if (a.account_type === 'Cash' || a.account_name.toLowerCase().includes('cash')) return -1
    if (b.account_type === 'Cash' || b.account_name.toLowerCase().includes('cash')) return 1
    return a.account_name.localeCompare(b.account_name)
  })

  res.json(sorted)
}))

// Get bank account by ID
router.get('/account/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) throw error
  res.json(data)
}))

// Create bank account
router.post('/account', verifyToken, asyncHandler(async (req, res) => {
  const { account_name, bank_name, account_number, account_type, opening_balance } = req.body

  if (!account_name || !bank_name || !account_number) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert([{
      account_name,
      bank_name,
      account_number,
      account_type,
      opening_balance: parseFloat(opening_balance || 0),
      current_balance: parseFloat(opening_balance || 0)
    }])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Delete bank account
router.delete('/account/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .update({ status: false, updated_at: new Date() })
    .eq('id', req.params.id)
    .select()

  if (error) throw error

  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Bank account not found' })
  }

  res.json({ message: 'Bank account deleted', account: data[0] })
}))

// Get bank transactions
router.get('/transactions', asyncHandler(async (req, res) => {
  const { bank_account_id, start_date, end_date } = req.query
  
  let query = supabase
    .from('bank_transactions')
    .select(`
      *,
      bank_accounts(account_name, bank_name)
    `)
  
  if (bank_account_id) query = query.eq('bank_account_id', bank_account_id)
  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query.order('transaction_date', { ascending: false })

  if (error) throw error
  res.json(data)
}))

// Record bank deposit/withdrawal
router.post('/transaction', verifyToken, asyncHandler(async (req, res) => {
  const { bank_account_id, transaction_type, amount, transaction_date, description, reference_no, cheque_no } = req.body

  if (!bank_account_id || !transaction_type || !amount || !transaction_date) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  if (!['Deposit', 'Withdrawal'].includes(transaction_type)) {
    return res.status(400).json({ error: 'Invalid transaction type. Must be Deposit or Withdrawal' })
  }

  // Get account details
  const { data: account, error: accountError } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', bank_account_id)
    .single()

  if (accountError) throw accountError

  const isCashAccount = account.account_type === 'Cash' || account.account_name.toLowerCase().includes('cash in hand')
  const amountNum = parseFloat(amount)

  let baseBalance = parseFloat(account.current_balance || 0)
  if (isCashAccount) {
    baseBalance = await getLiveCashInHand(account.id, account.opening_balance)
  }

  const newBalance = transaction_type === 'Deposit' 
    ? baseBalance + amountNum
    : baseBalance - amountNum

  if (transaction_type === 'Withdrawal' && !isCashAccount && newBalance < 0) {
    return res.status(400).json({ error: 'Insufficient balance for withdrawal' })
  }

  if (transaction_type === 'Withdrawal' && isCashAccount && baseBalance < amountNum && (amountNum - baseBalance) > 0.01) {
    return res.status(400).json({
      error: `Insufficient cash in hand. Available cash: ₨ ${baseBalance.toLocaleString()} (Requested: ₨ ${amountNum.toLocaleString()})`
    })
  }

  // Record transaction
  const { data, error } = await supabase
    .from('bank_transactions')
    .insert([{
      bank_account_id,
      transaction_type,
      amount: amountNum,
      transaction_date,
      description,
      reference_no,
      cheque_no,
      created_by: req.user.id
    }])
    .select()

  if (error) throw error

  // Update account balance
  await supabase
    .from('bank_accounts')
    .update({ current_balance: newBalance, updated_at: new Date() })
    .eq('id', bank_account_id)

  res.status(201).json(data[0])
}))

// Update bank transaction
router.put('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { amount, description, reference_no, transaction_date, cheque_no } = req.body

  const { data, error } = await supabase
    .from('bank_transactions')
    .update({
      amount: amount ? parseFloat(amount) : undefined,
      description,
      reference_no,
      transaction_date,
      cheque_no,
      updated_at: new Date()
    })
    .eq('id', req.params.id)
    .select()

  if (error) throw error
  res.json(data[0])
}))

// Delete bank transaction
router.delete('/transaction/:id', verifyToken, asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('bank_transactions')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Bank transaction deleted' })
}))

// Get bank summary
router.get('/summary', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  let query = supabase
    .from('bank_transactions')
    .select('amount, transaction_type')

  if (start_date) query = query.gte('transaction_date', start_date)
  if (end_date) query = query.lte('transaction_date', end_date)

  const { data, error } = await query

  if (error) throw error

  const summary = {
    total_deposits: 0,
    total_withdrawals: 0,
    net_flow: 0
  }

  data?.forEach(tx => {
    const amount = parseFloat(tx.amount)
    if (tx.transaction_type === 'Deposit') {
      summary.total_deposits += amount
    } else if (tx.transaction_type === 'Withdrawal') {
      summary.total_withdrawals += amount
    }
  })

  summary.net_flow = summary.total_deposits - summary.total_withdrawals

  res.json(summary)
}))

export default router
