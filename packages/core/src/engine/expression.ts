import jsep from 'jsep'

/**
 * Safe evaluator for tile templates. Parses with jsep and walks the AST against a
 * whitelist: no eval, no Function, no prototype access, only the helpers below.
 */

export class ExpressionError extends Error {}

const MAX_LENGTH = 500
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const num = (v: unknown) => Number(v)
const str = (v: unknown) => toText(v)

const helpers: Record<string, (...args: unknown[]) => unknown> = {
  upper: (s) => str(s).toUpperCase(),
  lower: (s) => str(s).toLowerCase(),
  trim: (s) => str(s).trim(),
  len: (v) => (Array.isArray(v) ? v.length : str(v).length),
  round: (n, digits = 0) => {
    const f = 10 ** num(digits)
    return Math.round(num(n) * f) / f
  },
  floor: (n) => Math.floor(num(n)),
  ceil: (n) => Math.ceil(num(n)),
  abs: (n) => Math.abs(num(n)),
  min: (...n) => Math.min(...n.map(num)),
  max: (...n) => Math.max(...n.map(num)),
  num,
  str,
  pad: (v, width = 2, fill = '0') => str(v).padStart(num(width), str(fill)),
}

export type Scope = Record<string, unknown>

const cache = new Map<string, jsep.Expression>()

function parse(source: string): jsep.Expression {
  let ast = cache.get(source)
  if (ast) return ast
  if (source.length > MAX_LENGTH) throw new ExpressionError('Expression is too long')
  try {
    ast = jsep(source)
  } catch (err) {
    throw new ExpressionError(`Can't read "${source}": ${(err as Error).message}`)
  }
  if (cache.size > 500) cache.clear()
  cache.set(source, ast)
  return ast
}

export function evaluate(source: string, scope: Scope): unknown {
  return evalNode(parse(source), scope)
}

/** Loose equality that treats '18' and 18 as equal but avoids JS == surprises. */
export function looseEqual(a: unknown, b: unknown): boolean {
  if (isNumeric(a) && isNumeric(b)) return Number(a) === Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b)
  return a === b || toText(a) === toText(b)
}

export function compareValues(a: unknown, b: unknown): number {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b)
  return toText(a).localeCompare(toText(b))
}

export function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
}

export function toBool(v: unknown): boolean {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return !(s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off')
  }
  return Boolean(v)
}

export function toText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function member(object: unknown, key: unknown): unknown {
  if (object === null || object === undefined) return undefined
  const k = String(key)
  if (BLOCKED_KEYS.has(k)) throw new ExpressionError(`"${k}" is not allowed`)
  if (typeof object === 'string') return k === 'length' ? object.length : object[Number(k)]
  if (typeof object !== 'object') return undefined
  return Object.hasOwn(object, k) ? (object as Record<string, unknown>)[k] : undefined
}

function evalNode(node: jsep.Expression, scope: Scope): unknown {
  switch (node.type) {
    case 'Literal':
      return (node as jsep.Literal).value
    case 'Identifier': {
      const { name } = node as jsep.Identifier
      return member(scope, name)
    }
    case 'MemberExpression': {
      const m = node as jsep.MemberExpression
      const object = evalNode(m.object, scope)
      const key = m.computed ? evalNode(m.property, scope) : (m.property as jsep.Identifier).name
      return member(object, key)
    }
    case 'UnaryExpression': {
      const u = node as jsep.UnaryExpression
      const v = evalNode(u.argument, scope)
      if (u.operator === '!') return !toBool(v)
      if (u.operator === '-') return -Number(v)
      if (u.operator === '+') return Number(v)
      throw new ExpressionError(`Operator "${u.operator}" is not supported`)
    }
    case 'BinaryExpression':
      return binary(node as jsep.BinaryExpression, scope)
    case 'ConditionalExpression': {
      const c = node as jsep.ConditionalExpression
      return toBool(evalNode(c.test, scope))
        ? evalNode(c.consequent, scope)
        : evalNode(c.alternate, scope)
    }
    case 'ArrayExpression':
      return (node as jsep.ArrayExpression).elements.map((e) =>
        e ? evalNode(e, scope) : undefined,
      )
    case 'CallExpression': {
      const call = node as jsep.CallExpression
      if (call.callee.type !== 'Identifier')
        throw new ExpressionError('Only helper functions can be called')
      const name = (call.callee as jsep.Identifier).name
      const fn = Object.hasOwn(helpers, name) ? helpers[name] : undefined
      if (!fn) throw new ExpressionError(`Unknown function "${name}"`)
      return fn(...call.arguments.map((a) => evalNode(a, scope)))
    }
    default:
      throw new ExpressionError(`"${node.type}" is not allowed in expressions`)
  }
}

function binary(b: jsep.BinaryExpression, scope: Scope): unknown {
  const left = () => evalNode(b.left, scope)
  const right = () => evalNode(b.right, scope)
  switch (b.operator) {
    case '&&': {
      const l = left()
      return toBool(l) ? right() : l
    }
    case '||': {
      const l = left()
      return toBool(l) ? l : right()
    }
    case '??': {
      const l = left()
      return l ?? right()
    }
  }
  const l = left()
  const r = right()
  switch (b.operator) {
    case '+':
      return typeof l === 'number' && typeof r === 'number' ? l + r : toText(l) + toText(r)
    case '-':
      return Number(l) - Number(r)
    case '*':
      return Number(l) * Number(r)
    case '/':
      return Number(l) / Number(r)
    case '%':
      return Number(l) % Number(r)
    case '==':
    case '===':
      return looseEqual(l, r)
    case '!=':
    case '!==':
      return !looseEqual(l, r)
    case '<':
      return compareValues(l, r) < 0
    case '<=':
      return compareValues(l, r) <= 0
    case '>':
      return compareValues(l, r) > 0
    case '>=':
      return compareValues(l, r) >= 0
    default:
      throw new ExpressionError(`Operator "${b.operator}" is not supported`)
  }
}

const PLACEHOLDER = /\{\{([\s\S]+?)\}\}/g

export const hasTemplate = (s: string) => s.includes('{{')

/**
 * Renders '{{ expr }}' placeholders. A string that is exactly one placeholder keeps the
 * value's type, so '{{var.count}}' can feed a number param.
 */
export function renderTemplate(template: string, scope: Scope): unknown {
  const whole = /^\s*\{\{([\s\S]+?)\}\}\s*$/.exec(template)
  if (whole?.[1] && !whole[1].includes('}}')) return evaluate(whole[1].trim(), scope)
  return template.replace(PLACEHOLDER, (_, expr: string) => toText(evaluate(expr.trim(), scope)))
}

/** Renders every template string inside params, leaving other values alone. */
export function renderParams(value: unknown, scope: Scope): unknown {
  if (typeof value === 'string') return hasTemplate(value) ? renderTemplate(value, scope) : value
  if (Array.isArray(value)) return value.map((v) => renderParams(v, scope))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderParams(v, scope)]))
  }
  return value
}
