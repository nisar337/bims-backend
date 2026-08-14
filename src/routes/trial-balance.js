import express from 'express'
import { asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get Trial Balance with Opening Balance, Period Activity (Debit/Credit), Closing Balance, Receivables and Payables
router.get('/', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query

  // 1. Fetch bank accounts and transactions
  const { data: bankAccounts, error: bankAccErr } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('status', true)

  if (bankAccErr) throw bankAccErr

  // All bank transactions to compute opening balance and period activity
  const { data: bankTransactions, error: bankTxErr } = await supabase
    .from('bank_transactions')
    .select('*')

  if (bankTxErr) throw bankTxErr

  // 2. Fetch income heads and income transactions
  const { data: incomeHeads, error: incHeadErr } = await supabase
    .from('income_heads')
    .select('*')

  if (incHeadErr) throw incHeadErr

  const { data: incomeTransactions, error: incTxErr } = await supabase
    .from('income_transactions')
    .select('*')

  if (incTxErr) throw incTxErr

  // 3. Fetch expense heads and expense transactions
  const { data: expenseHeads, error: expHeadErr } = await supabase
    .from('expense_heads')
    .select('*')

  if (expHeadErr) throw expHeadErr

  const { data: expenseTransactions, error: expTxErr } = await supabase
    .from('expense_transactions')
    .select('*')

  if (expTxErr) throw expTxErr

  // 4. Fetch owner expense heads and transactions
  const { data: ownerExpenseHeads } = await supabase
    .from('owner_expense_heads')
    .select('*')

  const { data: ownerExpenseTransactions } = await supabase
    .from('owner_expense_transactions')
    .select('*')

  // 5. Fetch student fees (if table exists) for receivables
  let studentFees = []
  try {
    const { data: feeData } = await supabase
      .from('student_fees')
      .select('*')
    studentFees = feeData || []
  } catch (err) {
    studentFees = []
  }

  // --- COMPILATION OF TRIAL BALANCE ROWS ---
  const rows = [];

  // 1. Bank, Cash & Owner Accounts
  const safeBankAccounts = bankAccounts || [];
  const safeBankTxs = bankTransactions || [];

  safeBankAccounts.forEach(account => {
    const accountTxs = safeBankTxs.filter(tx => tx.bank_account_id === account.id);

    // Calculate prior activity (before start_date)
    let priorDebits = 0;
    let priorCredits = 0;
    let periodDebits = 0;
    let periodCredits = 0;

    accountTxs.forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      const txDate = tx.transaction_date;

      if (start_date && txDate < start_date) {
        if (tx.transaction_type === 'Deposit') priorDebits += amt;
        else if (tx.transaction_type === 'Withdrawal') priorCredits += amt;
      } else if (!end_date || txDate <= end_date) {
        if (tx.transaction_type === 'Deposit') periodDebits += amt;
        else if (tx.transaction_type === 'Withdrawal') periodCredits += amt;
      }
    });

    const isOwnerAccount = account.account_type === 'Owner' || (account.bank_name && account.bank_name.toLowerCase().includes('owner'));
    const isCashAccount = account.account_type === 'Cash' || account.account_name.toLowerCase().includes('cash in hand');

    const initialOpening = parseFloat(account.opening_balance) || 0;
    const calculatedOpening = initialOpening + priorDebits - priorCredits;
    const closingBalance = calculatedOpening + periodDebits - periodCredits;

    let receivableAmount = 0;
    let payableAmount = 0;

    if (isOwnerAccount) {
      if (closingBalance < 0) {
        // Owner has taken/drawn funds -> Business has a receivable from the owner
        receivableAmount = Math.abs(closingBalance);
      } else if (closingBalance > 0) {
        // Owner has positive equity/capital balance -> Capital payable to owner
        payableAmount = closingBalance;
      }
    } else if (isCashAccount || account.account_type === 'Current' || account.account_type === 'Saving') {
      if (closingBalance < 0) {
        // Overdrawn bank/cash account
        payableAmount = Math.abs(closingBalance);
      }
    }

    rows.push({
      id: `bank-${account.id}`,
      account_name: isOwnerAccount ? `${account.account_name} (Owner)` : `${account.account_name} (${account.bank_name || 'Cash'})`,
      account_number: account.account_number || '',
      category: isOwnerAccount ? 'Owner / Capital' : isCashAccount ? 'Asset / Cash in Hand' : 'Asset / Bank Account',
      account_type: isOwnerAccount ? 'Owner' : 'Asset',
      opening_balance: calculatedOpening,
      debit_activity: periodDebits,
      credit_activity: periodCredits,
      net_activity: periodDebits - periodCredits,
      closing_balance: closingBalance,
      receivable_amount: receivableAmount,
      payable_amount: payableAmount,
      normal_balance: isOwnerAccount ? 'Credit' : 'Debit'
    });
  });

  // 2. Student Fees Receivable (Current Asset)
  let totalFeeReceivable = 0
  let periodFeeBilled = 0
  let periodFeeCollected = 0

  studentFees.forEach(fee => {
    const totalAmount = parseFloat(fee.total_amount || fee.amount || 0)
    const paidAmount = parseFloat(fee.amount_paid || fee.paid || 0)
    const pendingAmount = parseFloat(fee.amount_pending || (totalAmount - paidAmount) || 0)

    totalFeeReceivable += pendingAmount
    periodFeeBilled += totalAmount
    periodFeeCollected += paidAmount
  })

  if (studentFees.length > 0 || totalFeeReceivable > 0) {
    rows.push({
      id: 'receivable-students',
      account_name: 'Student Fees Receivable',
      account_number: 'AR-1001',
      category: 'Current Asset / Receivable',
      account_type: 'Receivable',
      opening_balance: 0,
      debit_activity: periodFeeBilled,
      credit_activity: periodFeeCollected,
      net_activity: periodFeeBilled - periodFeeCollected,
      closing_balance: totalFeeReceivable,
      receivable_amount: totalFeeReceivable,
      payable_amount: 0,
      normal_balance: 'Debit'
    })
  }

  // 3. Income Heads (Revenues)
  const safeIncomeHeads = incomeHeads || [];
  const safeIncomeTxs = incomeTransactions || [];

  safeIncomeHeads.forEach(head => {
    const headTxs = safeIncomeTxs.filter(tx => tx.income_head_id === head.id);

    let priorIncome = 0;
    let periodIncome = 0;

    headTxs.forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      const txDate = tx.transaction_date;

      if (start_date && txDate < start_date) {
        priorIncome += amt;
      } else if (!end_date || txDate <= end_date) {
        periodIncome += amt;
      }
    });

    rows.push({
      id: `income-${head.id}`,
      account_name: head.head_name,
      account_number: `INC-${head.id.slice(0, 4).toUpperCase()}`,
      category: 'Revenue / Income',
      account_type: 'Income',
      opening_balance: priorIncome,
      debit_activity: 0,
      credit_activity: periodIncome,
      net_activity: -periodIncome,
      closing_balance: priorIncome + periodIncome,
      receivable_amount: 0,
      payable_amount: 0,
      normal_balance: 'Credit'
    });
  });

  // 4. Expense Heads (Operating Expenses)
  const safeExpenseHeads = expenseHeads || [];
  const safeExpenseTxs = expenseTransactions || [];

  safeExpenseHeads.forEach(head => {
    const headTxs = safeExpenseTxs.filter(tx => tx.expense_head_id === head.id);

    let priorExpense = 0;
    let periodExpense = 0;

    headTxs.forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      const txDate = tx.transaction_date;

      if (start_date && txDate < start_date) {
        priorExpense += amt;
      } else if (!end_date || txDate <= end_date) {
        periodExpense += amt;
      }
    });

    rows.push({
      id: `expense-${head.id}`,
      account_name: head.head_name,
      account_number: `EXP-${head.id.slice(0, 4).toUpperCase()}`,
      category: 'Operating Expense',
      account_type: 'Expense',
      opening_balance: priorExpense,
      debit_activity: periodExpense,
      credit_activity: 0,
      net_activity: periodExpense,
      closing_balance: priorExpense + periodExpense,
      receivable_amount: 0,
      payable_amount: 0,
      normal_balance: 'Debit'
    });
  });

  // 5. Owner Expense Heads (Drawings / Equity)
  const safeOwnerHeads = ownerExpenseHeads || [];
  const safeOwnerTxs = ownerExpenseTransactions || [];

  safeOwnerHeads.forEach(head => {
    const headTxs = safeOwnerTxs.filter(tx => tx.owner_expense_head_id === head.id);

    let priorDrawings = 0;
    let periodDrawings = 0;

    headTxs.forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      const txDate = tx.transaction_date;

      if (start_date && txDate < start_date) {
        priorDrawings += amt;
      } else if (!end_date || txDate <= end_date) {
        periodDrawings += amt;
      }
    });

    rows.push({
      id: `owner-exp-${head.id}`,
      account_name: head.head_name,
      account_number: `OWN-${head.id.slice(0, 4).toUpperCase()}`,
      category: 'Owner Drawings / Equity',
      account_type: 'Equity',
      opening_balance: priorDrawings,
      debit_activity: periodDrawings,
      credit_activity: 0,
      net_activity: periodDrawings,
      closing_balance: priorDrawings + periodDrawings,
      receivable_amount: 0,
      payable_amount: 0,
      normal_balance: 'Debit'
    });
  });

  // Calculations for Totals
  let totalOpeningDebit = 0
  let totalOpeningCredit = 0
  let totalPeriodDebit = 0
  let totalPeriodCredit = 0
  let totalClosingDebit = 0
  let totalClosingCredit = 0
  let totalReceivables = 0
  let totalPayables = 0

  rows.forEach(row => {
    totalPeriodDebit += row.debit_activity
    totalPeriodCredit += row.credit_activity
    totalReceivables += row.receivable_amount
    totalPayables += row.payable_amount

    if (row.normal_balance === 'Debit') {
      totalOpeningDebit += row.opening_balance
      totalClosingDebit += row.closing_balance
    } else {
      totalOpeningCredit += row.opening_balance
      totalClosingCredit += row.closing_balance
    }
  })

  res.json({
    period: {
      start_date: start_date || 'All Time',
      end_date: end_date || new Date().toISOString().split('T')[0]
    },
    accounts: rows,
    summary: {
      total_opening_debit: totalOpeningDebit,
      total_opening_credit: totalOpeningCredit,
      total_period_debit: totalPeriodDebit,
      total_period_credit: totalPeriodCredit,
      total_closing_debit: totalClosingDebit,
      total_closing_credit: totalClosingCredit,
      total_receivables: totalReceivables,
      total_payables: totalPayables,
      is_balanced: Math.abs(totalPeriodDebit - totalPeriodCredit) < 0.01,
      debit_credit_difference: Math.abs(totalPeriodDebit - totalPeriodCredit)
    }
  })
}))

export default router
