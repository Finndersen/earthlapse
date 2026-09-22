import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { preload } from 'react-dom'

import './globals.css'

export const metadata: Metadata = {
  title: 'Earthlapse',
  description: "An interactive visualisation of Earth's history.",
}

/** `shell/manifest.ts`'s `MANIFEST_URL`. Preloaded from the static HTML so the fetch starts while
 *  the scripts are still downloading, rather than once they have run. */
const MANIFEST_URL = `${process.env.NEXT_PUBLIC_MEDIA_BASE ?? '/media'}/manifest.json`

export default function RootLayout({ children }: { children: ReactNode }) {
  preload(MANIFEST_URL, { as: 'fetch', crossOrigin: 'anonymous' })
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
