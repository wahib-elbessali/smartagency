import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { AsyncBoundary } from './AsyncBoundary'
import { ApiError } from '@/api/errors'

/**
 * These three states are the ones that ship broken. Worth pinning down before
 * six screens depend on them.
 */
describe('AsyncBoundary', () => {
  it('announces loading without rendering children', () => {
    render(
      <AsyncBoundary isPending error={null}>
        <p>the data</p>
      </AsyncBoundary>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('the data')).not.toBeInTheDocument()
  })

  it('shows a human sentence for an ApiError, not the raw message', () => {
    render(
      <AsyncBoundary
        isPending={false}
        error={new ApiError('timeout', 'AbortError: signal timed out')}
      >
        <p>the data</p>
      </AsyncBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('took too long')
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument()
  })

  it('calls onRetry when the retry button is used', async () => {
    const onRetry = vi.fn()
    render(
      <AsyncBoundary isPending={false} error={new ApiError('network', 'nope')} onRetry={onRetry}>
        <p>the data</p>
      </AsyncBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('treats empty as a real answer, distinct from an error', () => {
    render(
      <AsyncBoundary isPending={false} error={null} isEmpty emptyMessage="No visitors waiting">
        <p>the data</p>
      </AsyncBoundary>,
    )

    expect(screen.getByText('No visitors waiting')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders children once loaded and non-empty', () => {
    render(
      <AsyncBoundary isPending={false} error={null}>
        <p>the data</p>
      </AsyncBoundary>,
    )

    expect(screen.getByText('the data')).toBeInTheDocument()
  })
})
