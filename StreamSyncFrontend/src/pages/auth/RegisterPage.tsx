import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { useId, useState } from 'react'

import { config } from '@/app/config'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthDivider, GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { PasswordField, PasswordRequirements } from '@/components/auth/PasswordField'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { routes } from '@/constants/routes'
import { useRegister } from '@/hooks/useAuth'
import { registerSchema } from '@/schemas/auth'
import { isApiError } from '@/types/api'
import { toast } from '@/store/toastStore'
import { applyFieldErrors } from '@/utils/formErrors'

/**
 * Create account. (CLAUDE.md §25)
 *
 * The password policy is shown as a live checklist rather than enforced by
 * surprise on submit, so the requirements are visible while the user is
 * choosing rather than after they have failed.
 */
export function RegisterPage() {
  const navigate = useNavigate()
  const registerAccount = useRegister()
  const requirementsId = useId()

  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  })

  // Subscribed rather than read from a ref: the checklist has to re-render on
  // every keystroke, which is the one place in this form where that is wanted.
  const password = watch('password')

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    try {
      await registerAccount.mutateAsync({
        name: values.name,
        email: values.email,
        password: values.password,
      })

      toast.success({
        title: 'Welcome to StreamSync',
        description: 'Your account is ready.',
      })
      navigate(routes.app.dashboard, { replace: true })
    } catch (error) {
      const handled = applyFieldErrors(error, setError, [
        'name',
        'email',
        'password',
        'confirmPassword',
      ])
      if (!handled) {
        setFormError(
          isApiError(error) ? error.message : 'We couldn’t create your account. Please try again.',
        )
      }
    }
  })

  return (
    <AuthLayout
      title="Create your account"
      description="Start collaborating with your team in minutes."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={routes.auth.login}
            className="rounded-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert variant="danger">{formError}</Alert> : null}

        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Maria Gonzalez"
          autoFocus
          required
          error={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          error={errors.email?.message}
          {...register('email')}
        />

        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            autoComplete="new-password"
            placeholder="Create a password"
            required
            // Points at the checklist below, so the policy is discoverable from
            // the field itself rather than only visually adjacent to it.
            aria-describedby={requirementsId}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordRequirements id={requirementsId} value={password} className="pl-0.5" />
        </div>

        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingLabel="Creating your account"
          className="mt-1"
        >
          Create account
        </Button>

        <p className="text-center text-caption text-foreground-subtle">
          By creating an account you agree to the Terms of Service and Privacy Policy.
        </p>
      </form>

      {config.google.clientId ? (
        <div className="mt-5 flex flex-col gap-5">
          <AuthDivider />
          {/* Same endpoint as the login screen's button: Google sign-in has no
              separate "register" step — a first-time credential creates the
              account, so both pages point at the identical component. */}
          <GoogleSignInButton
            onSuccess={() => navigate(routes.app.dashboard, { replace: true })}
          />
        </div>
      ) : null}
    </AuthLayout>
  )
}
