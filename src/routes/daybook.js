import express from 'express'
import { asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// GET /api/daybook?date=YYYY-MM-DD
router.get('/', asyncHandler(async (req, res) => {
  const targetDate = req.query.date || new Date().toISOString().split('T')[0]

  // 1. Fetch Income transactions for the day
  const { data: incomeData, error: incomeErr } = await supabase
    .from('income_transactions')
    .select(`
      id,
      amount,
      transaction_date,
      description,
      reference_no,
      created_at,
      income_heads(head_name)
    `)
    .eq('transaction_date', targetDate)
    .order('created_at', { ascending: true })

  if (incomeErr) throw incomeErr

  // 2. Fetch Expense transactions for the day
  const { data: expenseData, error: expenseErr } = await supabase
    .from('expense_transactions')
    .select(`
      id,
      amount,
      transaction_date,
      description,
      reference_no,
      vendor_name,
      created_at,
      expense_heads(head_name)
    `)
    .eq('transaction_date', targetDate)
    .order('created_at', { ascending: true })

  if (expenseErr) throw expenseErr

  // 3. Fetch Bank / Cash / Owner transactions for the day
  const { data: bankData, error: bankErr } = await supabase
    .from('bank_transactions')
    .select(`
      id,
      amount,
      transaction_type,
      transaction_date,
      description,
      reference_no,
      cheque_no,
      created_at,
      bank_accounts(account_name, bank_name, account_type)
    `)
    .eq('transaction_date', targetDate)
    .order('created_at', { ascending: true })

  if (bankErr) throw bankErr

  // 4. Calculate Opening Cash in Hand prior to target date
  const { data: priorBankTxs } = await supabase
    .from('bank_transactions')
    .select('amount, transaction_type, bank_accounts(account_type, account_name)')
    .lt('transaction_date', targetDate)

  let priorCashOpening = 0
  priorBankTxs?.forEach((tx) => {
    const isCash = tx.bank_accounts?.account_type === 'Cash' || tx.bank_accounts?.account_name?.toLowerCase().includes('cash in hand')
    if (isCash) {
      const amt = parseFloat(tx.amount || 0)
      if (tx.transaction_type === 'Deposit') priorCashOpening += amt
      else if (tx.transaction_type === 'Withdrawal') priorCashOpening -= amt
    }
  })

  // Format and consolidate entries
  const entries = []

  // Add income receipts
  incomeData?.forEach((inc) => {
    entries.push({
      id: `inc-${inc.id}`,
      type: 'INCOME',
      type_label: 'Income',
      voucher_no: inc.reference_no || `INC-${inc.id.slice(0, 4).toUpperCase()}`,
      account_name: inc.income_heads?.head_name || 'Income',
      description: inc.description || 'Income Received (Cash Inflow)',
      inflow: parseFloat(inc.amount || 0),
      outflow: 0,
      mode: 'Cash / Direct',
      time: inc.created_at
    })
  })

  // Add expense payments
  expenseData?.forEach((exp) => {
    entries.push({
      id: `exp-${exp.id}`,
      type: 'EXPENSE',
      type_label: 'Expense',
      voucher_no: exp.reference_no || `EXP-${exp.id.slice(0, 4).toUpperCase()}`,
      account_name: exp.expense_heads?.head_name || 'Expense',
      description: exp.description || exp.vendor_name || 'Expense Paid',
      inflow: 0,
      outflow: parseFloat(exp.amount || 0),
      mode: 'Cash / Direct',
      time: exp.created_at
    })
  })

  // Process Bank and Ledger/Person transactions
  // We identify non-CashInHand accounts to show clean single entries without duplication
  bankData?.forEach((btx) => {
    const accType = btx.bank_accounts?.account_type
    const accName = btx.bank_accounts?.account_name || 'Account'
    const isCashAccount = accType === 'Cash' || accName.toLowerCase().includes('cash in hand')
    const isOwnerOrPerson = accType === 'Owner'
    const amt = parseFloat(btx.amount || 0)

    // Skip auto-created internal cash mirrors for Income and Expense
    const isIncomeTwin = btx.description?.includes('Income Received') || btx.reference_no?.startsWith('INC-')
    const isExpenseTwin = btx.description?.startsWith('Expense:') || btx.reference_no?.startsWith('EXP-')
    if (isIncomeTwin || isExpenseTwin) return

    // If this transaction is on a Person/Owner ledger account (e.g. Fazal saab):
    if (isOwnerOrPerson) {
      if (btx.transaction_type === 'Withdrawal') {
        // Payment made to person (Drawing/Debit/Loan) -> Cash Outflow
        entries.push({
          id: `btx-${btx.id}`,
          type: 'ACCOUNT_PAYMENT',
          type_label: 'Account Payment',
          voucher_no: btx.reference_no || btx.cheque_no || `ACC-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: accName,
          description: btx.description || `Payment to ${accName}`,
          inflow: 0,
          outflow: amt,
          mode: 'Cash Payment',
          time: btx.created_at
        })
      } else {
        // Receipt from person (Capital/Credit/Repayment) -> Cash Inflow
        entries.push({
          id: `btx-${btx.id}`,
          type: 'ACCOUNT_RECEIPT',
          type_label: 'Account Receipt',
          voucher_no: btx.reference_no || btx.cheque_no || `ACC-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: accName,
          description: btx.description || `Receipt from ${accName}`,
          inflow: amt,
          outflow: 0,
          mode: 'Cash Received',
          time: btx.created_at
        })
      }
      return
    }

    // If this transaction is on a standard Bank account (e.g. HBL, Soneri):
    if (!isCashAccount) {
      if (btx.transaction_type === 'Deposit') {
        // Cash transferred from cash counter to bank -> Cash Outflow
        entries.push({
          id: `btx-${btx.id}`,
          type: 'BANK_DEPOSIT',
          type_label: 'Bank Transfer (Out)',
          voucher_no: btx.reference_no || btx.cheque_no || `BNK-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: `${accName} (${btx.bank_accounts?.bank_name || 'Bank'})`,
          description: btx.description || `Transfer to ${accName}`,
          inflow: 0,
          outflow: amt,
          mode: 'Bank Transfer',
          time: btx.created_at
        })
      } else {
        // Cash withdrawn from bank into cash counter -> Cash Inflow
        entries.push({
          id: `btx-${btx.id}`,
          type: 'BANK_WITHDRAWAL',
          type_label: 'Bank Transfer (In)',
          voucher_no: btx.reference_no || btx.cheque_no || `BNK-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: `${accName} (${btx.bank_accounts?.bank_name || 'Bank'})`,
          description: btx.description || `Withdrawn from ${accName}`,
          inflow: amt,
          outflow: 0,
          mode: 'Bank Transfer',
          time: btx.created_at
        })
      }
      return
    }

    // Direct transaction standalone on Cash in Hand (if not paired with another account)
    // Check if there is already a corresponding peer account entry with same amount and description
    const hasPeerEntry = bankData.some((other) =>
      other.id !== btx.id &&
      other.amount === btx.amount &&
      other.transaction_date === btx.transaction_date &&
      other.description === btx.description &&
      other.bank_accounts?.account_type !== 'Cash'
    )

    if (!hasPeerEntry) {
      if (btx.transaction_type === 'Deposit') {
        entries.push({
          id: `btx-${btx.id}`,
          type: 'CASH_INFLOW',
          type_label: 'Cash Inflow',
          voucher_no: btx.reference_no || `CSH-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: 'Cash in Hand',
          description: btx.description || 'Cash Inflow Recorded',
          inflow: amt,
          outflow: 0,
          mode: 'Cash',
          time: btx.created_at
        })
      } else {
        entries.push({
          id: `btx-${btx.id}`,
          type: 'CASH_OUTFLOW',
          type_label: 'Cash Outflow',
          voucher_no: btx.reference_no || `CSH-${btx.id.slice(0, 4).toUpperCase()}`,
          account_name: 'Cash in Hand',
          description: btx.description || 'Cash Outflow Recorded',
          inflow: 0,
          outflow: amt,
          mode: 'Cash',
          time: btx.created_at
        })
      }
    }
  })

  // Sort chronological
  entries.sort((a, b) => new Date(a.time) - new Date(b.time))

  // Compute Day Summary
  const totalIncome = incomeData?.reduce((s, t) => s + parseFloat(t.amount || 0), 0) || 0
  const totalExpense = expenseData?.reduce((s, t) => s + parseFloat(t.amount || 0), 0) || 0
  const totalInflows = entries.reduce((s, t) => s + t.inflow, 0)
  const totalOutflows = entries.reduce((s, t) => s + t.outflow, 0)
  const netDayCashFlow = totalInflows - totalOutflows
  const closingCashInHand = priorCashOpening + netDayCashFlow

  res.json({
    date: targetDate,
    summary: {
      opening_cash_in_hand: priorCashOpening,
      total_income: totalIncome,
      total_expense: totalExpense,
      total_inflows: totalInflows,
      total_outflows: totalOutflows,
      net_day_change: netDayCashFlow,
      closing_cash_in_hand: closingCashInHand,
      total_entries_count: entries.length
    },
    entries
  })
}))

export default router
