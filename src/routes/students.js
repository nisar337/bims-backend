import express from 'express'
import { verifyToken, asyncHandler } from '../middleware/auth.js'
import supabase from '../config/supabase.js'

const router = express.Router()

// Get all students
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*')

  if (error) throw error
  res.json(data)
}))

// Get student by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) throw error
  res.json(data)
}))

// Create new student
router.post('/', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .insert([req.body])
    .select()

  if (error) throw error
  res.status(201).json(data[0])
}))

// Update student
router.put('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .update(req.body)
    .eq('id', req.params.id)
    .select()

  if (error) throw error
  res.json(data[0])
}))

// Delete student
router.delete('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .delete()
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ message: 'Student deleted successfully' })
}))

export default router
