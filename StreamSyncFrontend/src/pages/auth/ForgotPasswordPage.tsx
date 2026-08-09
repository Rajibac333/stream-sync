import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useState } from 'react'

import { AuthLayout } from '@/components/auth/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { routes } from '@/constants/routes'
import { useRequestPasswordReset } from '@/hooks/useAuth'
import { forgotPasswordSchema } from '@/schemas/auth'
import { isApiError } from '@/types/api'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Password reset request. (CLAUDE.md §25)
 *
 * The confirmation is deliberately non-committal — "if an account exists" —
 * and is shown for *every* submitted address. Saying "no account found" would
 * turn this form into a way to test which email addresses are registered.
 */
export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset()
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      await requestReset.mutateAsync(values)
      setSubmittedEmail(values.email)
    } catch (error) {
      const handled = applyFieldErrors(error, setError, ['email'])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : 'We couldn’t send that email. Please try again.',
        )
      }
    }
  })

  const backToSignIn = (
    <Link
      to={routes.auth.login}
      className="inline-flex items-center gap-1.5 rounded-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Back to sign in
    </Link>
  )

  /* ---------------------------------------------------------------------
     Confirmation
     --------------------------------------------------------------------- */
  if (submittedEmail !== null) {
    return (
      <AuthLayout title="Check your email" footer={backToSignIn}>
        <div className="flex flex-col gap-5">
          <div className="flex size-11 items-center justify-center rounded-lg bg-success-subtle text-success">
            <MailCheck className="size-5" aria-hidden="true" />
          </div>

          {/* role="status" so the change of screen is announced — a keyboard or
              screen-reader user gets no other signal that submitting worked. */}
          <p role="status" className="text-body text-foreground-muted">
            If an account exists for{' '}
            <span className="font-medium text-foreground">{submittedEmail}</span>, we’ve sent a link
            to reset the password. It expires in one hour.
          </p>

          <Alert variant="info">
            Nothing arrived? Check your spam folder, then try again — the address may be different
            from the one on the account.
          </Alert>

          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              setSubmittedEmail(null)
              setFormError(null)
            }}
          >
            Use a different email
          </Button>
        </div>
      </AuthLayout>
    )
  }

  /* ---------------------------------------------------------------------
     Request form
     --------------------------------------------------------------------- */
  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email on your account and we’ll send you a reset link."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          autoFocus
          required
          defaultValue={getValues('email')}
          error={errors.email?.message}
          {...register('email')}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingLabel="Sending reset link"
          className="mt-1"
        >
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}
