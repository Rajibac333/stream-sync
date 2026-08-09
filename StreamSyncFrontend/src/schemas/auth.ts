import { z } from 'zod'

/**
 * Authentication form schemas.
 *
 * Zod is the single source of truth for both the validation rules and the form
 * types: `LoginFormValues` is *derived* from the schema, so a rule and its type
 * can never disagree. (CLAUDE.md §63)
 *
 * These validate shape and intent, not identity. Whether an email exists and
 * whether a password is correct are answered by the server — the client cannot
 * know, and pretending otherwise leaks who has an account.
 */

const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .pipe(z.email('Enter a valid email address.'))
  .transform((value) => value.toLowerCase())

/* -----------------------------------------------------------------------------
 * Password policy
 *
 * Length carries most of the strength, so the floor is 10 rather than the
 * customary 8, with a small amount of required variety. The rules are exported
 * as data so the signup form can *show* them and tick them off live rather than
 * ambushing the user with one failure at a time. (CLAUDE.md §25)
 * -------------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128

export interface PasswordRule {
  id: string
  label: string
  test: (value: string) => boolean
}

export const passwordRules: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'case',
    label: 'Upper and lowercase letters',
    test: (value) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  },
  {
    id: 'number',
    label: 'At least one number',
    test: (value) => /\d/.test(value),
  },
]

const password = z
  .string()
  .min(1, 'Enter a password.')
  .max(PASSWORD_MAX_LENGTH, `Passwords cannot exceed ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => value.length >= PASSWORD_MIN_LENGTH, {
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value), {
    message: 'Include both uppercase and lowercase letters.',
  })
  .refine((value) => /\d/.test(value), {
    message: 'Include at least one number.',
  })

/* -----------------------------------------------------------------------------
 * Schemas
 * -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  email,
  // Sign-in only checks that *something* was entered. Applying the strength
  // rules here would tell an existing user their own working password is
  // invalid the day the policy changes.
  password: z.string().min(1, 'Enter your password.'),
  rememberMe: z.boolean(),
})

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Enter your name.')
      .max(80, 'That name is too long.'),
    email,
    password,
    confirmPassword: z.string().min(1, 'Re-enter your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match.",
    // Attach to the field the user has to fix, so the message lands beside it.
    path: ['confirmPassword'],
  })

export const forgotPasswordSchema = z.object({ email })

export type LoginFormValues = z.infer<typeof loginSchema>
export type RegisterFormValues = z.infer<typeof registerSchema>
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>
