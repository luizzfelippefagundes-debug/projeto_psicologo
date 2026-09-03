import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Consultório",
  description: "Painel de agendamento e gestão do consultório",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Consultório",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#a8768a",
};

const themeInitScript = `
(function () {
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.classList.toggle('dark', isDark);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex antialiased" suppressHydrationWarning>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
