import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginPage } from '@/pages/auth/LoginPage'
import { renderWithProviders, testSession } from '@/test/utils'
import { ApiErrorCode, type ApiError } from '@/types/api'

/**
 * Sign-in form. (CLAUDE.md §25, §63, §74)
 *
 * The API layer is mocked rather than the mock service being exercised — a form
 * test should fail when the *form* is wrong, not when fixture data changes.
 */

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const login = vi.fn()
vi.mock('@/api/auth', () => ({ authApi: { login: (...args: unknown[]) => login(...args) } }))

function renderLogin() {
  return renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })
}

beforeEach(() => {
  navigate.mockReset()
  login.mockReset()
})

describe('LoginPage', () => {
  describe('structure', () => {
    it('is a properly-titled page, not a floating card', () => {
      renderLogin()
      expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument()
      expect(screen.getByRole('main')).toBeInTheDocument()
    })

    it('labels every field and offers the password reset route', () => {
      renderLogin()

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
        'href',
        '/forgot-password',
      )
    })

    it('offers a password reveal toggle that reports its state', async () => {
      const { user } = renderLogin()
      const password = screen.getByLabelText(/^password/i)
      expect(password).toHaveAttribute('type', 'password')

      await user.click(screen.getByRole('button', { name: /show password/i }))

      expect(password).toHaveAttribute('type', 'text')
      expect(screen.getByRole('button', { name: /hide password/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })

  describe('validation', () => {
    it('does not submit an invalid email, and says why', async () => {
      const { user } = renderLogin()

      await user.type(screen.getByLabelText(/email/i), 'not-an-email')
      await user.type(screen.getByLabelText(/^password/i), 'whatever')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      expect(await screen.findByText(/valid email address/i)).toBeInTheDocument()
      expect(login).not.toHaveBeenCalled()
    })

    it('marks the failing field invalid for assistive tech', async () => {
      const { user } = renderLogin()

      await user.type(screen.getByLabelText(/email/i), 'not-an-email')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true'))
    })

    it('clears the error as soon as the user corrects it', async () => {
      const { user } = renderLogin()
      const email = screen.getByLabelText(/email/i)

      await user.type(email, 'not-an-email')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))
      expect(await screen.findByText(/valid email address/i)).toBeInTheDocument()

      await user.clear(email)
      await user.type(email, 'raj@evertech.io')

      await waitFor(() => expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument())
    })
  })

  describe('submission', () => {
    it('signs in and redirects to the dashboard', async () => {
      login.mockResolvedValue(testSession)
      const { user } = renderLogin()

      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'streamsync')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() =>
        expect(login).toHaveBeenCalledWith({
          email: 'raj@evertech.io',
          password: 'streamsync',
          rememberMe: true,
        }),
      )
      expect(navigate).toHaveBeenCalledWith('/app/dashboard', { replace: true })
    })

    it('passes rememberMe through when the user unchecks it', async () => {
      login.mockResolvedValue(testSession)
      const { user } = renderLogin()

      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'streamsync')
      await user.click(screen.getByLabelText(/remember me/i))
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() =>
        expect(login).toHaveBeenCalledWith(expect.objectContaining({ rememberMe: false })),
      )
    })

    it('shows a busy state while the request is in flight', async () => {
      let resolve: (value: unknown) => void = () => undefined
      login.mockImplementation(() => new Promise((r) => { resolve = r }))

      const { user } = renderLogin()
      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'streamsync')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      const submit = await screen.findByRole('button', { name: /sign in/i })
      await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'))
      expect(submit).toBeDisabled()

      resolve(testSession)
    })
  })

  describe('server errors', () => {
    it('surfaces a rejected sign-in without navigating away', async () => {
      const error: ApiError = {
        status: 401,
        code: ApiErrorCode.Unauthorized,
        message: "That email and password don't match. Please try again.",
        retryable: false,
      }
      login.mockRejectedValue(error)

      const { user } = renderLogin()
      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'wrong')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/don't match/i)
      expect(navigate).not.toHaveBeenCalled()
    })

    it('places a field-scoped server error under its own field', async () => {
      login.mockRejectedValue({
        status: 400,
        code: ApiErrorCode.Validation,
        message: 'Validation failed.',
        fieldErrors: { email: ['That account has been disabled.'] },
        retryable: false,
      } satisfies ApiError)

      const { user } = renderLogin()
      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'streamsync')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      const message = await screen.findByText(/account has been disabled/i)
      // Wired via aria-describedby, so a screen reader reads it with the field.
      expect(screen.getByLabelText(/email/i)).toHaveAttribute(
        'aria-describedby',
        expect.stringContaining(message.id),
      )
    })

    it('recovers on a second, successful attempt', async () => {
      login
        .mockRejectedValueOnce({
          status: 401,
          code: ApiErrorCode.Unauthorized,
          message: 'Nope.',
          retryable: false,
        } satisfies ApiError)
        .mockResolvedValueOnce(testSession)

      const { user } = renderLogin()
      await user.type(screen.getByLabelText(/email/i), 'raj@evertech.io')
      await user.type(screen.getByLabelText(/^password/i), 'wrong')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))
      await screen.findByRole('alert')

      await user.clear(screen.getByLabelText(/^password/i))
      await user.type(screen.getByLabelText(/^password/i), 'streamsync')
      await user.click(screen.getByRole('button', { name: /^sign in$/i }))

      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app/dashboard', { replace: true }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
