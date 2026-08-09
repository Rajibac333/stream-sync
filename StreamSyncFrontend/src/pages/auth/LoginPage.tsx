import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'

import { config } from '@/app/config'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthDivider, GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { PasswordField } from '@/components/auth/PasswordField'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { routes } from '@/constants/routes'
import { useLogin } from '@/hooks/useAuth'
import { loginSchema } from '@/schemas/auth'
import { isApiError } from '@/types/api'
import { applyFieldErrors } from '@/utils/formErrors'
import { resolveRedirectTarget } from '@/utils/redirect'

/**
 * Sign in. (CLAUDE.md §25)
 *
 * Validation runs on submit and then re-runs on change once a field has been
 * touched by a failure — so nobody is told their email is invalid while they
 * are still halfway through typing it, but corrections clear immediately.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()

  // Server-level failure ("that email and password don't match"), as opposed to
  // per-field validation. Held separately so a retry clears it cleanly.
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '', rememberMe: true },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      await login.mutateAsync(values)
      // `replace` so Back from the app doesn't land on the login screen again.
      navigate(resolveRedirectTarget(location), { replace: true })
    } catch (error) {
      const handled = applyFieldErrors(error, setError, ['email', 'password'])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : 'We couldn’t sign you in. Please try again.',
        )
      }
    }
  })

  return (
    <AuthLayout
      title="Sign in to StreamSync"
      description="Pick up where your team left off."
      footer={
        <>
          New to StreamSync?{' '}
          <Link
            to={routes.auth.register}
            className="rounded-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          // The first field of the page the user came here to fill in.
          autoFocus
          required
          error={errors.email?.message}
          {...register('email')}
        />

        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex items-center justify-between gap-4">
          <Checkbox label="Remember me" {...register('rememberMe')} />

          <Link
            to={routes.auth.forgotPassword}
            className="rounded-xs text-small font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingLabel="Signing you in"
          className="mt-1"
        >
          Sign in
        </Button>
      </form>

      {config.google.clientId ? (
        <div className="mt-5 flex flex-col gap-5">
          <AuthDivider />
          <GoogleSignInButton
            onSuccess={() => navigate(resolveRedirectTarget(location), { replace: true })}
          />
        </div>
      ) : null}
    </AuthLayout>
  )
}
