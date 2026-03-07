import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center text-center px-4">
      <div>
        <h1 className="text-4xl font-bold mb-4">Page not found</h1>
        <p className="text-gray-600 mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800">Go home</Link>
      </div>
    </div>
  );
}
