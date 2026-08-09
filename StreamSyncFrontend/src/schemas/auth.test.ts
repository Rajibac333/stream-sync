import { describe, expect, it } from 'vitest'

import {
  forgotPasswordSchema,
  loginSchema,
  passwordRules,
  registerSchema,
  PASSWORD_MIN_LENGTH,
} from '@/schemas/auth'

/** CLAUDE.md §63 — form validation is a contract, so it gets tested like one. */

describe('loginSchema', () => {
  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x', rememberMe: true }).success).toBe(
      false,
    )
  })

  it('normalises the email so casing never blocks a sign-in', () => {
    const parsed = loginSchema.parse({
      email: '  RAJ@EverTech.io  ',
      password: 'anything',
      rememberMe: false,
    })
    expect(parsed.email).toBe('raj@evertech.io')
  })

  it('accepts any non-empty password', () => {
    // Deliberate: applying the strength policy here would tell an existing user
    // their own working password is invalid the day the policy tightens.
    expect(
      loginSchema.safeParse({ email: 'a@b.co', password: 'short', rememberMe: true }).success,
    ).toBe(true)
  })

  it('requires a password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.co', password: '', rememberMe: true })
    expect(result.success).toBe(false)
  })
})

describe('registerSchema', () => {
  const base = { name: 'Raj Mehta', email: 'raj@evertech.io' }
  const withPassword = (password: string) => ({
    ...base,
    password,
    confirmPassword: password,
  })

  it('accepts a password meeting every rule', () => {
    expect(registerSchema.safeParse(withPassword('CorrectHorse1')).success).toBe(true)
  })

  it.each([
    ['too short', 'Short1A'],
    ['no uppercase', 'alllowercase1'],
    ['no lowercase', 'ALLUPPERCASE1'],
    ['no number', 'NoNumbersHere'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(registerSchema.safeParse(withPassword(password)).success).toBe(false)
  })

  it('attaches a mismatch to confirmPassword, not to password', () => {
    const result = registerSchema.safeParse({
      ...base,
      password: 'CorrectHorse1',
      confirmPassword: 'CorrectHorse2',
    })

    expect(result.success).toBe(false)
    // The message has to land under the field the user must actually fix.
    expect(result.error?.issues.at(-1)?.path).toEqual(['confirmPassword'])
  })

  it('requires a real name', () => {
    expect(registerSchema.safeParse({ ...withPassword('CorrectHorse1'), name: 'R' }).success).toBe(
      false,
    )
  })

  it('trims the name so whitespace is not a valid one', () => {
    expect(
      registerSchema.safeParse({ ...withPassword('CorrectHorse1'), name: '   ' }).success,
    ).toBe(false)
  })
})

describe('passwordRules', () => {
  it('agrees with the schema — the checklist cannot promise a password the schema rejects', () => {
    const accepted = 'CorrectHorse1'
    expect(passwordRules.every((rule) => rule.test(accepted))).toBe(true)
    expect(
      registerSchema.safeParse({
        name: 'Raj Mehta',
        email: 'raj@evertech.io',
        password: accepted,
        confirmPassword: accepted,
      }).success,
    ).toBe(true)
  })

  it('shows nothing satisfied for a weak password', () => {
    expect(passwordRules.filter((rule) => rule.test('abc')).length).toBe(0)
  })

  it('states the same minimum length the schema enforces', () => {
    const lengthRule = passwordRules.find((rule) => rule.id === 'length')
    expect(lengthRule?.label).toContain(String(PASSWORD_MIN_LENGTH))
    expect(lengthRule?.test('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true)
    expect(lengthRule?.test('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false)
  })
})

describe('forgotPasswordSchema', () => {
  it('validates the email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(forgotPasswordSchema.safeParse({ email: 'raj@evertech.io' }).success).toBe(true)
  })
})
