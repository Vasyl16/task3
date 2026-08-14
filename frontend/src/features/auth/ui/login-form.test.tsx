import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api';
import { renderWithAuth, stubAuth } from '../../../test/render-with-auth';
import { LoginForm } from './login-form';

function renderForm(login: () => Promise<void>, onSuccess = vi.fn()) {
  renderWithAuth(<LoginForm onSuccess={onSuccess} />, stubAuth({ login }));
  return { onSuccess };
}

describe('LoginForm', () => {
  it('blocks submission and shows field errors for invalid input', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.resolve());
    renderForm(login);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Enter a valid email address'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    // The point of client-side validation: no pointless round trip.
    expect(login).not.toHaveBeenCalled();
  });

  it('submits valid credentials and reports success', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.resolve());
    const { onSuccess } = renderForm(login);

    await user.type(screen.getByLabelText('Email'), 'buyer@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: 'buyer@example.com',
        password: 'correct-horse',
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("surfaces the backend's rejection without navigating away", async () => {
    const user = userEvent.setup();
    const login = vi.fn(() =>
      Promise.reject(new ApiError(401, ['Invalid email or password'])),
    );
    const { onSuccess } = renderForm(login);

    await user.type(screen.getByLabelText('Email'), 'buyer@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password',
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('marks the email field invalid for assistive technology', async () => {
    const user = userEvent.setup();
    renderForm(vi.fn(() => Promise.resolve()));

    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // A red border alone tells a screen-reader user nothing.
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });
  });
});
