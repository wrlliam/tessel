import { describe, expect, it } from 'vitest'
import { evaluate, renderParams, renderTemplate } from '../src/index.ts'

const scope = { var: { mood: 'calm', count: 3 }, input: { value: 18 }, local: {} }

describe('evaluate', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['var.count > 2 && var.mood == "calm"', true],
    ['input.value >= 18 ? "evening" : "day"', 'evening'],
    ['"18" == 18', true],
    ['var.missing ?? "fallback"', 'fallback'],
    ['upper(var.mood)', 'CALM'],
    ['round(10 / 3, 2)', 3.33],
    ['pad(5)', '05'],
    ['!false', true],
    ['var.mood.length', 4],
    ['[1, 2][1]', 2],
  ])('%s', (src, expected) => {
    expect(evaluate(src, scope)).toEqual(expected)
  })

  it.each([
    'constructor',
    'var.constructor',
    'var["__proto__"]',
    'var.mood.constructor.constructor("return process")()',
    'toString()',
    'var.mood.toUpperCase()',
    'this',
  ])('refuses %s', (src) => {
    expect(() => evaluate(src, scope)).toThrow()
  })

  it('does not reach inherited properties', () => {
    expect(evaluate('var.hasOwnProperty', scope)).toBeUndefined()
  })

  it('rejects very long expressions', () => {
    expect(() => evaluate('1+'.repeat(400) + '1', scope)).toThrow(/too long/)
  })
})

describe('renderTemplate', () => {
  it('keeps the type of a single placeholder', () => {
    expect(renderTemplate('{{var.count}}', scope)).toBe(3)
  })

  it('interpolates text', () => {
    expect(renderTemplate('Feeling {{var.mood}} x{{var.count}}', scope)).toBe('Feeling calm x3')
  })

  it('renders missing values as empty text', () => {
    expect(renderTemplate('[{{var.nope}}]', scope)).toBe('[]')
  })

  it('renders nested params', () => {
    expect(
      renderParams({ a: ['{{input.value}}'], b: { c: 'x{{var.count}}' }, d: 5 }, scope),
    ).toEqual({
      a: [18],
      b: { c: 'x3' },
      d: 5,
    })
  })
})
