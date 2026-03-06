import Link from "next/link";

export function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-gray-900">
          Festival Finder
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/festivals" className="text-gray-700 hover:text-gray-900">
            Find Festivals
          </Link>
          <Link href="/submit" className="text-gray-700 hover:text-gray-900">
            Submit
          </Link>
        </div>
      </div>
    </nav>
  );
}
