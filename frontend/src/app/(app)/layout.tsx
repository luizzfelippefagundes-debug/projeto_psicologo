import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <main className="min-h-full flex-1 px-6 py-8 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
