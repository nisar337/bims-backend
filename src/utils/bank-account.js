import supabase from '../config/supabase.js'

export const isCashAccount = (account) => {
  if (!account) return false
  const name = String(account.account_name || '').toLowerCase()
  return account.account_type === 'Cash' || name.includes('cash in hand')
}

export const getDefaultCashAccount = async () => {
  const { data: cashAccounts } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('status', true)
    .or('account_type.eq.Cash,account_name.ilike.%Cash in Hand%')

  return cashAccounts?.[0] || null
}

export const getBankAccountById = async (accountId) => {
  if (!accountId) return null

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('status', true)
    .single()

  if (error) return null
  return data
}
