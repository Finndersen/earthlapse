import type { Metadata } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import "./globals.css";

const DESCRIPTION =
  "Scrub through 4.6 billion years of Earth's history, from a molten planet and the first life to the dinosaurs, our ancestors and modern cities.";

/** Link previews use `opengraph-image.jpg` beside this file; `metadataBase` makes its URL absolute,
 *  which the crawlers that read Open Graph tags require. */
export const metadata: Metadata = {
  metadataBase: new URL("https://earthlapse.net"),
  title: "Earthlapse",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Earthlapse",
    title: "Earthlapse",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Earthlapse",
    description: DESCRIPTION,
  },
};

/** `shell/manifest.ts`'s `MANIFEST_URL`. Preloaded from the static HTML so the fetch starts while
 *  the scripts are still downloading, rather than once they have run. */
const MANIFEST_URL = `${process.env.NEXT_PUBLIC_MEDIA_BASE ?? "/media"}/manifest.json`;

export default function RootLayout({ children }: { children: ReactNode }) {
  preload(MANIFEST_URL, { as: "fetch", crossOrigin: "anonymous" });
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
