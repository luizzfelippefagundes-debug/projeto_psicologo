import { Sidebar } from "@/components/Sidebar";
import { getMe } from "@/lib/api";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profissional = await getMe();

  return (
    <div className="flex h-dvh flex-1 overflow-hidden">
      <Sidebar profissional={profissional} />
      <main className="h-full flex-1 overflow-y-auto px-6 py-8 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
