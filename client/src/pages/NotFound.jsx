import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-4xl font-bold text-white mb-2">404</h1>
      <p className="text-gray-400 mb-4">Page not found</p>
      <Link href="/">
        <span className="text-[#e50914] hover:underline text-sm cursor-pointer">Back to Dashboard</span>
      </Link>
    </div>
  );
}
