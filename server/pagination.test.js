import { describe, it, expect } from 'vitest'
import { parsePagination } from './pagination.js'

describe('parsePagination', () => {
  it('defaults to limit 20, offset 0 when nothing is provided', () => {
    expect(parsePagination({})).toEqual({ limit: 20, offset: 0 })
  })

  it('honors a valid limit and offset', () => {
    expect(parsePagination({ limit: '5', offset: '10' })).toEqual({ limit: 5, offset: 10 })
  })

  it('clamps a limit above maxLimit down to maxLimit', () => {
    expect(parsePagination({ limit: '9999' })).toEqual({ limit: 100, offset: 0 })
  })

  it('falls back to the default limit for zero, negative, or non-numeric values', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(20)
    expect(parsePagination({ limit: '-5' }).limit).toBe(20)
    expect(parsePagination({ limit: 'abc' }).limit).toBe(20)
  })

  it('falls back to offset 0 for negative or non-numeric values', () => {
    expect(parsePagination({ offset: '-5' }).offset).toBe(0)
    expect(parsePagination({ offset: 'abc' }).offset).toBe(0)
  })

  it('respects custom defaultLimit/maxLimit options', () => {
    expect(parsePagination({}, { defaultLimit: 10, maxLimit: 15 })).toEqual({ limit: 10, offset: 0 })
    expect(parsePagination({ limit: '50' }, { defaultLimit: 10, maxLimit: 15 })).toEqual({ limit: 15, offset: 0 })
  })
})
