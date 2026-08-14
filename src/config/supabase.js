import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase credentials in environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const checkSupabaseConnection = async () => {
  try {
    const { data, error } = await supabase.from('income_heads').select('id').limit(1)
    if (error) {
      console.error('Supabase connection check failed:', error.message)
      return false
    }

    console.log('✅ Database connected successfully to Supabase')
    return true
  } catch (err) {
    console.error('Supabase connection check error:', err.message)
    return false
  }
}

export default supabase
