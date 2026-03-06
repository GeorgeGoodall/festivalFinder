import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link href="/admin" className="font-bold text-lg">Admin</Link>
          <Link href="/admin/festivals" className="text-gray-700 hover:text-gray-900">Festivals</Link>
          <Link href="/admin/artists" className="text-gray-700 hover:text-gray-900">Artists</Link>
          <Link href="/admin/submissions" className="text-gray-700 hover:text-gray-900">Submissions</Link>
          <Link href="/admin/usage" className="text-gray-700 hover:text-gray-900">Usage</Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
