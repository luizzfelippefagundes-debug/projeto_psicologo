import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-dvh flex-1 overflow-hidden">
      <Sidebar />
      <main className="h-full flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
