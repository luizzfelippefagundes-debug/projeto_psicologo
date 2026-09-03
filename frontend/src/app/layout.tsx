import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations";
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
        <ClerkProvider
          localization={ptBR}
          appearance={{
            variables: {
              colorPrimary: "#a8768a",
              colorBackground: "#ffffff",
              colorForeground: "#3a2f2f",
              colorMutedForeground: "#8a7873",
              colorInput: "#ffffff",
              colorInputForeground: "#3a2f2f",
              colorBorder: "#ddd0c9",
              colorDanger: "#dc2626",
              borderRadius: "14px",
              fontFamily: "var(--font-inter), sans-serif",
            },
            elements: {
              card: "border border-[#ddd0c9] shadow-md",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
            },
          }}
        >
          <PwaRegister />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}