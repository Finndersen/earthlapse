import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EventTagLegend } from '@/events'

import stubManifest from '../../public/stub/manifest.json'

import { CreditsList } from './CreditsList'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
  it('leads with the artistic-reconstruction disclosure (VISUAL_SPEC §9)', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(stubManifest.credits[0]!.title)).toBeTruthy())
    const disclaimer = screen.getByText(/artistic reconstruction/i)
    // It's the very first thing in the wrap, ahead of the intro paragraph and the list.
    expect(disclaimer.previousElementSibling).toBeNull()
  })

  it('renders every credit once the manifest loads', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])
    render(<CreditsList />)
    for (const credit of stubManifest.credits) {
      await waitFor(() => expect(screen.getByText(credit.title)).toBeTruthy())
      expect(screen.getByText(credit.citation)).toBeTruthy()
    }
  })

  it('shows a stub-data notice when the primary manifest is missing', async () => {
    mockFetchSequence([
      { url: '/media/manifest.json', status: 404 },
      { url: '/stub/manifest.json', status: 200, body: stubManifest },
    ])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(/stub credits/i)).toBeTruthy())
  })

  it('shows a loud error on a real load failure, not a blank or stub-looking panel', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 500 }])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(/failed to load credits/i)).toBeTruthy())
  })

  it('renders a caller-supplied event colour legend (W-followup item 11), so the "?" popover this replaced needs no permanent space', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])
    render(<CreditsList eventLegend={<EventTagLegend />} />)
    await waitFor(() => expect(screen.getByText(/event colours/i)).toBeTruthy())
    expect(screen.getByText('Catastrophe')).toBeTruthy()
    expect(screen.getByText('Science & technology')).toBeTruthy()
  })

  it('shows no "Event colours" section when no legend is supplied (re-review fix, 2026-09-15 — shell no longer imports @/events itself)', async () => {
    mockFetchSequence([{ url: '/media/manifest.json', status: 200, body: stubManifest }])
    render(<CreditsList />)
    await waitFor(() => expect(screen.getByText(stubManifest.credits[0]!.title)).toBeTruthy())
    expect(screen.queryByText(/event colours/i)).toBeNull()
  })
})
