import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventTagLegend } from '@/events'

import stubManifest from '../../public/stub/manifest.json'

import { CreditsList } from './CreditsList'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function mockFetchSequence(responses: Array<{ url: string; status: number; body?: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = responses.find((r) => r.url === url)
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: match.status >= 200 && match.status < 300,
      status: match.status,
      json: async () => match.body,
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('CreditsList', () => {
  const ok = () => mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])

  it('leads with the disclosure and shows controls at once, then every credit once loaded', async () => {
    ok()
    render(<CreditsList />)
    expect(screen.getByRole('heading', { name: /controls & shortcuts/i })).toBeTruthy()
    for (const credit of stubManifest.credits) {
      await waitFor(() => expect(screen.getByText(credit.title)).toBeTruthy())
      expect(screen.getByText(credit.citation)).toBeTruthy()
    }
    expect(screen.getByText(/artistic reconstruction/i).previousElementSibling).toBeNull()
    expect(screen.queryByText(/event colours/i)).toBeNull()
  })

  it('flags stub credits, and fails loudly on a real load error', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 200, body: stubManifest },
    ])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(/stub credits/i)).toBeTruthy())
    cleanup()
    mockFetchSequence([{ url: '/media/manifest.json', status: 500 }])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(/failed to load credits/i)).toBeTruthy())
  })

  it('renders supplied legend and feedback link slots alongside the repository and version links', async () => {
    ok()
    const commit = '9500113c0ffee0000000000000000000000000ab'
    vi.stubEnv('NEXT_PUBLIC_EARTHLAPSE_VERSION', '2026.09.24')
    vi.stubEnv('NEXT_PUBLIC_EARTHLAPSE_COMMIT', commit)
    render(<CreditsList eventLegend={<EventTagLegend />} feedbackLink={<a href="https://example.com/issues/new">Report a bug or give feedback</a>} />)
    await waitFor(() => expect(screen.getByText(/event colours/i)).toBeTruthy())
    expect(screen.getByRole('link', { name: /report a bug or give feedback/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /view source on github/i }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Version 2026.09.24 · 9500113' }).getAttribute('href')).toBe(
      `https://github.com/Finndersen/earthlapse/commit/${commit}`,
    )
  })
})
