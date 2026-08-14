import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all fees
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('fees')
    .select('*')

  if (error) throw error
  res.json(data)
}))

// Get fees for specific student
router.get('/student/:student_id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('student_id', req.params.student_id)

  if (error) throw error
  res.json(data)
}))

// Record fee payment
router.post('/payment', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('fees')
    .insert([req.body])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Get fee statistics
router.get('/stats/summary', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('fees')
    .select('*')

  if (error) throw error

  const stats = {
    total_collected: data?.reduce((sum, fee) => sum + (fee.amount_paid || 0), 0) || 0,
    total_pending: data?.reduce((sum, fee) => sum + (fee.amount_pending || 0), 0) || 0,
    payment_count: data?.length || 0
  }

  res.json(stats)
}))

// Update fee record
router.put('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('fees')
    .update(req.body)
    .eq('id', req.params.id)
    .select()

  if (error) throw error
  res.json(data[0])
}))

export default router
