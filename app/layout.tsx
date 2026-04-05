import type { Metadata, Viewport } from 'next'
import { Noto_Serif_TC, Space_Mono } from 'next/font/google'
import './globals.css'

const noto = Noto_Serif_TC({
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-noto',
  display: 'swap',
})

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '?? 少年存股??,
  description: '?�股?��?追蹤 ??讓�?一?�錢?�發??,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '存股??,
  },
  icons: { apple: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#0d1018',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className={`${noto.variable} ${mono.variable}`} data-theme="dark">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="grain-overlay">{children}</body>
    </html>
  )
}
